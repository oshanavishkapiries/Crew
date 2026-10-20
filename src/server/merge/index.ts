import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql, and, desc, eq } from 'drizzle-orm';
import { execa } from 'execa';
import picomatch from 'picomatch';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import type { Scheduler, Task } from '../scheduler/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import { getCrewHome } from '../config.js';
import { CommandRunner, type VerifyCommand } from '../verify/command-runner.js';

type Item = typeof schema.mergeQueueItems.$inferSelect;
type Workspace = typeof schema.workspaces.$inferSelect;
export interface MergeHooks {
  beforeRefUpdate?: (task: Task, commitSha: string) => Promise<void>;
}
export interface MergeQueueOptions {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  worktreeManager: WorktreeManager;
  crewHome?: string;
}

/** One serial lane per workspace; task status is always written by the Scheduler. */
export class MergeQueue {
  private readonly home: string;
  private started = false;
  private paused = false;
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private active = new Map<string, Promise<void>>();
  private commands = new CommandRunner();
  readonly warnings = new Map<string, string>();
  readonly hooks: MergeHooks = {};

  constructor(private options: MergeQueueOptions) {
    this.home = options.crewHome ?? getCrewHome();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.options.eventBus.subscribeBoardEvents('*', e => {
      if (e.type === 'task_status_changed') {
        const data = e.data as { taskId: string; to: string };
        if (data.to === 'merge-queue') {
          // Only a new pipeline approval can reopen a failed attempt; safety ticks cannot retry it.
          const item = this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, data.taskId)).get();
          const task = this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, data.taskId)).get();
          if (item?.status === 'failed' && task) {
            const position = Math.max(0, ...this.options.db.db.select().from(schema.mergeQueueItems).all().map(i => i.position)) + 1;
            this.change(item, task, { status: 'queued', position, commitSha: null, output: null });
          }
        }
        this.reconcileParent(data.taskId, data.to).catch(error => console.error('Conflict parent transition failed:', error));
        this.tick();
      }
    });
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    await this.commands.stopAll();
    await Promise.all(this.active.values());
  }

  async stopAll(): Promise<void> {
    this.paused = true;
    await this.commands.stopAll();
    await Promise.all(this.active.values());
  }

  resume(): void { this.paused = false; this.tick(); }
  private isStopped(): boolean {
    return !this.started || this.paused || fs.existsSync(path.join(this.home, 'stopped'));
  }

  tick(): void {
    if (this.isStopped()) return;
    const { db } = this.options;
    const waiting = db.db.select().from(schema.tasks).where(eq(schema.tasks.status, 'merge-queue')).all();
    for (const task of waiting) {
      const existing = db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, task.id)).all();
      if (existing.length) continue;
      const position = Math.max(0, ...db.db.select().from(schema.mergeQueueItems).all().map(i => i.position)) + 1;
      const item = { id: randomUUID(), taskId: task.id, position, status: 'queued', createdAt: new Date() };
      db.db.insert(schema.mergeQueueItems).values(item).run();
      this.emit(task, db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
    }
    for (const workspace of db.db.select().from(schema.workspaces).all()) {
      if (this.active.has(workspace.id)) continue;
      const job = this.drain(workspace).catch(error => {
        if (!this.isStopped()) console.error('Merge queue error:', error);
      }).finally(() => { this.active.delete(workspace.id); });
      this.active.set(workspace.id, job);
    }
  }

  private async drain(workspace: Workspace): Promise<void> {
    const { db } = this.options;
    while (!this.isStopped()) {
      const next = db.db.select({ item: schema.mergeQueueItems, task: schema.tasks })
        .from(schema.mergeQueueItems).innerJoin(schema.tasks, eq(schema.tasks.id, schema.mergeQueueItems.taskId))
        .innerJoin(schema.boards, eq(schema.boards.id, schema.tasks.boardId))
        .where(and(eq(schema.boards.workspaceId, workspace.id), eq(schema.mergeQueueItems.status, 'queued'), eq(schema.tasks.status, 'merge-queue')))
        .all().sort((a, b) => a.item.position - b.item.position)[0];
      if (!next) return;
      try {
        if (!await this.merge(next.item, next.task, workspace)) return;
      } catch (error) {
        this.change(next.item, next.task, { status: 'failed', output: String(error).slice(-65536) });
      }
    }
  }

  private async git(cwd: string, ...args: string[]): Promise<string> {
    return (await execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true' },
    })).stdout;
  }

  private live(task: Task): boolean {
    return !this.isStopped() && this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()?.status === 'merge-queue';
  }

  private async checkoutBlocked(workspace: Workspace): Promise<boolean> {
    const branch = await this.git(workspace.repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    const dirty = branch === workspace.defaultBranch && !!await this.git(workspace.repoPath, 'status', '--porcelain=v1', '--untracked-files=all');
    if (dirty) {
      this.warnings.set(workspace.id, `Merge queue paused: ${workspace.defaultBranch} checkout has uncommitted changes`);
      return true;
    }
    this.warnings.delete(workspace.id);
    return false;
  }

  private async merge(item: Item, task: Task, workspace: Workspace): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.mergeAttempt(item, task, workspace);
      if (result !== 'retry') return result;
    }
    this.change(item, task, { status: 'failed', output: 'Default branch moved during merge three times; retry required' });
    return true;
  }

  private async mergeAttempt(item: Item, task: Task, workspace: Workspace): Promise<boolean | 'retry'> {
    if (await this.checkoutBlocked(workspace)) {
      this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
      return false;
    }
    if (!task.branch) throw new Error('Merge task has no branch');
    const repo = workspace.repoPath;
    const ref = `refs/heads/${workspace.defaultBranch}`;
    const old = await this.git(repo, 'rev-parse', ref);
    const integration = path.join(this.home, 'integration', workspace.id);
    if (!fs.existsSync(integration)) {
      fs.mkdirSync(path.dirname(integration), { recursive: true });
      await this.git(repo, 'worktree', 'add', '--detach', integration, old);
    }
    try {
      await this.options.worktreeManager.setupWorktree(integration, workspace.config, `merge:${task.id}`);
    } catch (error) {
      if (!this.live(task)) return false;
      await this.feedback(item, task, `Integration worktree setup failed: ${String(error)}`, false);
      return true;
    }
    if (!this.live(task)) return false;
    this.change(item, task, { status: 'rebasing' });
    await this.git(integration, 'switch', '--detach', task.branch);
    const userName = await this.git(repo, 'config', 'user.name').catch(() => 'Crew');
    const userEmail = await this.git(repo, 'config', 'user.email').catch(() => 'crew@localhost');
    try {
      await this.git(integration, '-c', `user.name=${userName || 'Crew'}`, '-c', `user.email=${userEmail || 'crew@localhost'}`, 'rebase', old);
    } catch (error) {
      const files = (await this.git(integration, 'diff', '--name-only', '--diff-filter=U', '-z')).split('\0').filter(Boolean);
      await this.git(integration, 'rebase', '--abort');
      if (files.length) {
        await this.conflict(item, task, workspace, files);
        return true;
      }
      throw error;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    this.change(item, task, { status: 'verifying' });
    const changed = (await this.git(integration, 'diff', '--name-only', '-z', `${old}..HEAD`)).split('\0').filter(Boolean);
    const run = this.options.db.db.select().from(schema.runs)
      .where(and(eq(schema.runs.taskId, task.id), eq(schema.runs.kind, 'work')))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`)).get();
    if (!run) throw new Error('Merge task has no author run');
    const config = workspace.config ?? {};
    const commands = (Array.isArray(config.verifyCommands) ? config.verifyCommands : []) as VerifyCommand[];
    const failures: string[] = [];
    for (const cmd of commands) {
      if (!cmd.name || !cmd.command || (cmd.paths?.length && !changed.some(file => picomatch(cmd.paths!)(file)))) continue;
      if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
      const result = await this.commands.execute(cmd, integration, task.id);
      if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
      this.options.db.db.insert(schema.verificationResults).values({
        id: randomUUID(), runId: run.id, step: `merge:${cmd.name}`, passed: result.passed,
        output: result.output.slice(-65536), createdAt: new Date(),
      }).run();
      this.options.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step', data: { taskId: task.id, step: `merge:${cmd.name}`, passed: result.passed },
      });
      if (!result.passed) failures.push(`Merge verification '${cmd.name}' failed:\n${result.output.slice(-4096)}`);
    }
    if (failures.length) {
      await this.feedback(item, task, failures.join('\n\n'), true);
      return true;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    this.change(item, task, { status: 'merging' });
    if (config.mergeStrategy !== 'rebase') {
      const agent = this.options.db.db.select().from(schema.agents).where(eq(schema.agents.id, run.agentId)).get();
      await this.git(integration, 'reset', '--soft', old);
      await this.git(integration, '-c', `user.name=${userName || 'Crew'}`, '-c', `user.email=${userEmail || 'crew@localhost'}`,
        'commit', `--author=${agent?.name ?? 'Crew'} <agent@crew.local>`, '-m', `${task.title}\n\nCrew-Task: ${task.id}`);
    }
    const commitSha = await this.git(integration, 'rev-parse', 'HEAD');
    // Persist before moving the ref: recovery can recognize a merge that landed before a crash.
    this.change(item, task, { commitSha });
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    await this.hooks.beforeRefUpdate?.(task, commitSha);
    if (await this.checkoutBlocked(workspace)) {
      this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
      return false;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    try {
      const branch = await this.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
      if (branch === workspace.defaultBranch) {
        // ff-only refuses a diverged tip, preserving the user's competing commit.
        if (await this.git(repo, 'rev-parse', ref) !== old) {
          this.change(item, task, { status: 'queued', commitSha: null, output: 'Default branch moved; rebasing again' });
          return 'retry';
        }
        await this.git(repo, 'merge', '--ff-only', commitSha);
      } else {
        await this.git(repo, 'update-ref', ref, commitSha, old);
      }
    } catch (error) {
      if (await this.git(repo, 'rev-parse', ref) === old) throw error;
      this.change(item, task, { status: 'queued', commitSha: null, output: 'Default branch moved; rebasing again' });
      return 'retry';
    }
    await this.options.scheduler.transitionTask(task.id, 'merged', {
      reason: `Merged ${commitSha}`,
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'merged', commitSha, output: `Merged ${commitSha}` }).where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    await this.options.worktreeManager.removeWorktree(task);
    await this.git(repo, 'branch', '-D', task.branch);
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
    return true;
  }

  private async conflict(item: Item, task: Task, workspace: Workspace, files: string[]): Promise<void> {
    if (!this.live(task)) return;
    const maxDepth = typeof workspace.config?.maxDepth === 'number' ? workspace.config.maxDepth : 3;
    if (task.depth + 1 > maxDepth) {
      await this.feedback(item, task, `Conflict exceeds maximum task depth ${maxDepth}: ${files.join(', ')}`, false);
      return;
    }
    // Git forbids checking a branch out in two worktrees: remove first, then publish the child.
    await this.options.worktreeManager.removeWorktree(task);
    if (!this.live(task)) return;
    const childId = randomUUID();
    const description = [
      `Rebase + resolve for task ${task.id}: ${task.title}`,
      task.description,
      `Conflicting files: ${files.join(', ')}`,
      `Continue branch ${task.branch}. Rebase onto ${workspace.defaultBranch}, resolve every conflict, run the project's checks, then call crew done.`,
      'Preserve the original task acceptance criteria and the changes already on the default branch.',
    ].join('\n\n');
    await this.options.scheduler.createTask({
      id: childId, boardId: task.boardId, title: `Rebase + resolve: ${task.title}`,
      description, acceptanceCriteria: task.acceptanceCriteria, roleId: task.roleId ?? undefined,
      assigneeAgentId: task.assigneeAgentId ?? undefined, parentTaskId: task.id, depth: task.depth + 1,
      branch: task.branch!, createdBy: 'merge-queue',
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'conflict', conflictTaskId: childId, output: `Conflicts: ${files.join(', ')}` })
        .where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private async reconcileParent(childId: string, status: string): Promise<void> {
    if (!['merged', 'escalated', 'cancelled'].includes(status)) return;
    const item = this.options.db.db.select().from(schema.mergeQueueItems)
      .where(and(eq(schema.mergeQueueItems.conflictTaskId, childId), eq(schema.mergeQueueItems.status, 'conflict'))).get();
    if (!item) return;
    const parent = this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, item.taskId)).get();
    if (!parent || parent.status !== 'merge-queue') return;
    if (status !== 'merged') {
      await this.feedback(item, parent, `Conflict sub-task ${childId} was ${status}`, false);
      return;
    }
    const childItem = this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, childId)).get();
    await this.options.scheduler.transitionTask(parent.id, 'merged', {
      reason: `merged via ${childId}`,
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'merged', commitSha: childItem?.commitSha, output: `merged via ${childId}` })
        .where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    this.emit(parent, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private async feedback(item: Item, task: Task, body: string, retry: boolean): Promise<void> {
    await this.options.scheduler.transitionTask(task.id, retry ? 'doing' : 'escalated', {
      reason: body,
      incrementRetries: retry,
      alongside: () => {
        this.options.db.db.insert(schema.messages).values({
          id: randomUUID(), taskId: task.id, fromAgentId: null, type: 'feedback', body, createdAt: new Date(),
        }).run();
        this.options.db.db.update(schema.mergeQueueItems).set({ status: 'failed', output: body.slice(-65536), commitSha: null })
          .where(eq(schema.mergeQueueItems.id, item.id)).run();
      },
    });
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private change(item: Item, task: Task, values: Partial<Item>): void {
    this.options.db.db.update(schema.mergeQueueItems).set(values).where(eq(schema.mergeQueueItems.id, item.id)).run();
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private emit(task: Task, item: Item): void {
    this.options.eventBus.publishBoardEvent(task.boardId, { type: 'merge_item_changed', data: item });
  }
}
