import { sql, eq, asc, desc } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import type { Runner } from '../runner/index.js';
import type { Scheduler } from './index.js';
import { getCrewHome } from '../config.js';

export interface DispatcherOptions {
  db: CrewDatabase;
  scheduler: Scheduler;
  runner: Runner;
  eventBus: EventBus;
  maxParallelAgents?: number; // default 3
  tickIntervalMs?: number; // default 5000 ms
  crewHome?: string;
}

export class Dispatcher {
  private db: CrewDatabase;
  private scheduler: Scheduler;
  private runner: Runner;
  private eventBus: EventBus;
  public readonly maxParallelAgents: number;
  private explicitParallelLimit?: number;
  private tickIntervalMs: number;
  private crewHome: string;

  private started = false;
  private stopped = false;
  private isDispatching = false;
  private dispatchScheduled = false;
  private tickTimer: any = null;
  private unsubscribeBoard?: () => void;
  private onRunEndedBound?: (result: any) => void;

  constructor(options: DispatcherOptions) {
    this.db = options.db;
    this.scheduler = options.scheduler;
    this.runner = options.runner;
    this.eventBus = options.eventBus;
    this.maxParallelAgents = options.maxParallelAgents ?? 3;
    this.explicitParallelLimit = options.maxParallelAgents;
    this.tickIntervalMs = options.tickIntervalMs ?? 5000;
    this.crewHome = options.crewHome || getCrewHome();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Triggered by task_status_changed events
    this.unsubscribeBoard = this.eventBus.subscribeBoardEvents('*', (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as { to?: string };
        if (data?.to === 'ready' || data?.to === 'todo' || data?.to === 'doing') {
          this.scheduleDispatch();
        }
      } else if (event.type === 'rate_limit_cleared') {
        this.scheduleDispatch();
      }
    });

    // Triggered by run-exit events
    this.onRunEndedBound = () => {
      this.scheduleDispatch();
    };
    this.runner.on('run_ended', this.onRunEndedBound);
    this.runner.on('rate_limit_cleared', () => this.scheduleDispatch());

    // Slow safety tick (e.g. every 5 seconds)
    this.tickTimer = setInterval(() => {
      this.scheduleDispatch();
    }, this.tickIntervalMs);

    // Initial dispatch loop
    this.scheduleDispatch();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.unsubscribeBoard) {
      this.unsubscribeBoard();
      this.unsubscribeBoard = undefined;
    }
    if (this.onRunEndedBound) {
      this.runner.off('run_ended', this.onRunEndedBound);
      this.onRunEndedBound = undefined;
    }
  }

  isStopped(): boolean {
    if (this.stopped) return true;
    const stoppedFile = path.join(this.crewHome, 'stopped');
    return fs.existsSync(stoppedFile);
  }

  setStopped(stopped: boolean): void {
    this.stopped = stopped;
    const stoppedFile = path.join(this.crewHome, 'stopped');
    if (stopped) {
      try {
        if (!fs.existsSync(this.crewHome)) {
          fs.mkdirSync(this.crewHome, { recursive: true });
        }
        fs.writeFileSync(stoppedFile, new Date().toISOString(), 'utf-8');
      } catch {
        // ignore write error
      }
    } else {
      try {
        if (fs.existsSync(stoppedFile)) {
          fs.unlinkSync(stoppedFile);
        }
      } catch {
        // ignore unlink error
      }
    }
  }

  scheduleDispatch(): void {
    if (!this.started || this.isStopped()) return;

    if (this.isDispatching) {
      this.dispatchScheduled = true;
      return;
    }

    this.runDispatchLoop().catch(() => {});
  }

  private async runDispatchLoop(): Promise<void> {
    this.isDispatching = true;
    try {
      do {
        this.dispatchScheduled = false;
        await this.dispatchOnce();
      } while (this.dispatchScheduled && this.started && !this.isStopped());
    } finally {
      this.isDispatching = false;
    }
  }

  async dispatchOnce(): Promise<void> {
    if (this.isStopped()) {
      return;
    }

    const liveRuns = this.runner.getLiveRuns();
    const liveTaskIds = new Set(liveRuns.map((r) => r.taskId));
    const liveAgentIds = new Set(liveRuns.map((r) => r.agentId));
    const capacity = this.explicitParallelLimit ?? this.db.db.select().from(schema.workspaces).all()
      .reduce((total, workspace) => total + (typeof workspace.config?.maxParallelAgents === 'number' ? workspace.config.maxParallelAgents : this.maxParallelAgents), 0);
    let availableSlots = capacity - liveRuns.length;

    if (availableSlots <= 0) {
      return;
    }

    // 1. Re-dispatch orphan 'doing' tasks (e.g. from crash or restart) without using a retry
    const doingTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'doing'))
      .orderBy(asc(schema.tasks.createdAt))
      .all();

    for (const task of doingTasks) {
      if (availableSlots <= 0) break;
      if (liveTaskIds.has(task.id) || this.runner.isCancelling(task.id)) continue;

      const agent = this.resolveAgentForTask(task, liveAgentIds);
      if (!agent) continue;

      liveTaskIds.add(task.id);
      liveAgentIds.add(agent.id);
      availableSlots--;

      this.db.db
        .update(schema.agents)
        .set({ status: 'busy' })
        .where(eq(schema.agents.id, agent.id))
        .run();

      try {
        const lastRun = this.db.db
          .select()
          .from(schema.runs)
          .where(eq(schema.runs.taskId, task.id))
          .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`))
          .get();

        if (lastRun?.sessionId && lastRun?.exitReason === 'rate-limited') {
          await this.runner.resumeTask(task.id, 'Resume task after rate limit pause');
        } else {
          await this.runner.startRun({ taskId: task.id, agentId: agent.id });
        }
      } catch {
        this.db.db
          .update(schema.agents)
          .set({ status: 'idle' })
          .where(eq(schema.agents.id, agent.id))
          .run();
        liveTaskIds.delete(task.id);
        liveAgentIds.delete(agent.id);
        availableSlots++;
      }
    }

    if (availableSlots <= 0) {
      return;
    }

    // 2. Pick 'ready' tasks, oldest first
    const readyTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'ready'))
      .orderBy(asc(schema.tasks.createdAt))
      .all();

    for (const task of readyTasks) {
      if (availableSlots <= 0) break;
      if (liveTaskIds.has(task.id)) continue;

      const agent = this.resolveAgentForTask(task, liveAgentIds);
      if (!agent) continue;

      liveTaskIds.add(task.id);
      liveAgentIds.add(agent.id);
      availableSlots--;

      // Assign agent to task if not already set
      if (task.assigneeAgentId !== agent.id) {
        this.db.db
          .update(schema.tasks)
          .set({ assigneeAgentId: agent.id, updatedAt: new Date() })
          .where(eq(schema.tasks.id, task.id))
          .run();
      }

      this.db.db
        .update(schema.agents)
        .set({ status: 'busy' })
        .where(eq(schema.agents.id, agent.id))
        .run();

      try {
        // Move task ready -> doing (creates worktree and branch)
        const startedTask = await this.scheduler.transitionTask(task.id, 'doing', {
          reason: `Dispatched to agent ${agent.name}`,
        });
        if (startedTask.status !== 'doing' || this.isStopped() || this.runner.isCancelling(task.id)) {
          this.db.db.update(schema.agents).set({ status: 'idle' }).where(eq(schema.agents.id, agent.id)).run();
          continue;
        }
        await this.runner.startRun({ taskId: task.id, agentId: agent.id });
      } catch {
        this.db.db
          .update(schema.agents)
          .set({ status: 'idle' })
          .where(eq(schema.agents.id, agent.id))
          .run();
        liveTaskIds.delete(task.id);
        liveAgentIds.delete(agent.id);
        availableSlots++;
      }
    }
  }

  private resolveAgentForTask(
    task: typeof schema.tasks.$inferSelect,
    liveAgentIds: Set<string>,
  ): typeof schema.agents.$inferSelect | undefined {
    const board = this.db.db
      .select()
      .from(schema.boards)
      .where(eq(schema.boards.id, task.boardId))
      .get();
    if (!board) return undefined;

    const workspace = this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get();
    const limit = typeof workspace?.config?.maxParallelAgents === 'number' ? workspace.config.maxParallelAgents : this.maxParallelAgents;
    const workspaceAgents = this.db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, board.workspaceId)).all();
    if (workspaceAgents.filter((agent) => liveAgentIds.has(agent.id)).length >= limit) return undefined;

    // If task already has an assignee
    if (task.assigneeAgentId) {
      const agent = this.db.db
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, task.assigneeAgentId))
        .get();
      if (!agent) return undefined;
      if (agent.status === 'rate-limited' || agent.status === 'stopped') return undefined;
      if (liveAgentIds.has(agent.id)) return undefined;

      const toolRateLimited = this.isToolRateLimited(board.workspaceId, agent.cliType);
      if (toolRateLimited) return undefined;

      return agent;
    }

    // Task has no assignee: assign an idle agent of the matching role (or any in workspace if no roleId)
    const agentsInWs = this.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, board.workspaceId))
      .orderBy(asc(schema.agents.createdAt))
      .all();

    for (const agent of agentsInWs) {
      if (task.roleId && agent.roleId !== task.roleId) continue;
      if (agent.status !== 'idle') continue;
      if (liveAgentIds.has(agent.id)) continue;
      if (this.isToolRateLimited(board.workspaceId, agent.cliType)) continue;
      return agent;
    }

    return undefined;
  }

  private isToolRateLimited(workspaceId: string, cliType: string): boolean {
    const agents = this.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.workspaceId, workspaceId))
      .all();
    return agents.some((a) => a.cliType === cliType && a.status === 'rate-limited');
  }
}
