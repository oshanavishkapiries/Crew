import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { CrewEvent, EventBus } from '../events/index.js';

import { WorktreeSetupError, type WorktreeManager } from '../worktree/index.js';

export type TaskStatus =
  | 'todo'
  | 'ready'
  | 'doing'
  | 'verifying'
  | 'review'
  | 'merge-queue'
  | 'merged'
  | 'blocked'
  | 'escalated'
  | 'cancelled';

export type Task = typeof schema.tasks.$inferSelect;

export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Task not found: ${taskId}`);
    this.name = 'TaskNotFoundError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly from: string,
    public readonly to: string,
    message?: string,
  ) {
    super(message || `Invalid task transition for ${taskId}: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export class DependencyCycleError extends Error {
  constructor(public readonly taskId: string, public readonly blockedByTaskId: string) {
    super(`Cannot add dependency: cycle detected between ${taskId} and ${blockedByTaskId}`);
    this.name = 'DependencyCycleError';
  }
}

export interface SchedulerOptions {
  maxRetries?: number;
  worktreeManager?: WorktreeManager;
}

export interface TransitionContext {
  reason?: string;
  errorSummary?: string;
  incrementRetries?: boolean;
  /**
   * Extra writes (e.g. the agent's message) that must commit or roll back together with
   * this transition. Runs after the transition is validated, inside the same transaction.
   */
  alongside?: () => void;
}

type PendingEvent = { boardId: string; event: Omit<CrewEvent, 'timestamp'> };

export class Scheduler {
  private maxRetries: number;
  public readonly worktreeManager?: WorktreeManager;

  constructor(
    private db: CrewDatabase,
    private eventBus?: EventBus,
    options: SchedulerOptions = {},
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.worktreeManager = options.worktreeManager;
  }

  /**
   * Check if a direct transition is allowed by the state machine
   */
  isValidTransition(from: TaskStatus, to: TaskStatus, kind: 'work' | 'phase' = 'work'): boolean {
    if (from === to) return true;
    if (from === 'doing' && to === 'merged' && kind === 'phase') return true;
    if (kind === 'phase' && to === 'verifying') return false;

    // Terminal states cannot transition to anything
    if (from === 'merged' || from === 'cancelled') {
      return false;
    }

    // Cancel is allowed from any non-terminal state
    if (to === 'cancelled') {
      return true;
    }

    // Escalated can happen from active working/review states when retries exceed limit
    if (to === 'escalated') {
      return from === 'doing' || from === 'verifying' || from === 'review' || from === 'merge-queue';
    }

    switch (from) {
      case 'todo':
        return to === 'ready';
      case 'ready':
        return to === 'doing';
      case 'doing':
        return to === 'verifying' || to === 'blocked';
      case 'blocked':
        return to === 'doing';
      case 'verifying':
        return to === 'review' || to === 'doing';
      case 'review':
        return to === 'merge-queue' || to === 'doing';
      case 'merge-queue':
        return to === 'merged' || to === 'doing';
      case 'escalated':
        return false;
      default:
        return false;
    }
  }

  /**
   * Check whether all blockers for a task are in 'merged' status
   */
  async areDependenciesSatisfied(taskId: string): Promise<boolean> {
    return this.dependenciesMerged(taskId);
  }

  /**
   * Add a dependency with cycle detection
   */
  async addDependency(taskId: string, blockedByTaskId: string): Promise<void> {
    this.inTransaction(() => this.insertDependency(taskId, blockedByTaskId));
  }

  /**
   * Transition task status. The scheduler is the only writer of task status.
   * Events are published only after the transaction commits.
   */
  async transitionTask(
    taskId: string,
    requestedStatus: TaskStatus,
    context: TransitionContext = {},
  ): Promise<Task> {
    return this.transition(taskId, requestedStatus, context, false);
  }

  /** D44: only the human-authenticated retry endpoint calls this entry point. */
  async retryTaskByHuman(taskId: string, note?: string): Promise<Task> {
    const task = this.getTaskOrThrow(taskId);
    if (task.status !== 'escalated') throw new InvalidTransitionError(taskId, task.status, 'doing', 'Only escalated tasks can be retried');
    let owner = task;
    let child: Task | undefined;
    const seen = new Set<string>([taskId]);
    // Conflict chains share one branch; the deepest inactive descendant owns it.
    while (true) {
      const conflict = this.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, owner.id)).get();
      if (!conflict?.conflictTaskId || seen.has(conflict.conflictTaskId)) break;
      const descendant = this.getTaskOrThrow(conflict.conflictTaskId);
      if (descendant.branch !== task.branch || !['escalated', 'cancelled'].includes(descendant.status)) break;
      seen.add(descendant.id);
      child = descendant;
      owner = descendant;
    }
    const transferred = child && child.branch === task.branch && ['escalated', 'cancelled'].includes(child.status) &&
      await this.worktreeManager?.transferWorktree(child, task);
    try {
      return await this.transition(taskId, 'doing', {
        reason: 'Retried by human',
        alongside: () => {
          if (transferred && child) this.db.db.update(schema.tasks).set({ worktreePath: null }).where(eq(schema.tasks.id, child.id)).run();
          if (note !== undefined) this.db.db.insert(schema.messages).values({
            id: randomUUID(), taskId, fromAgentId: null, type: 'feedback', body: note, createdAt: new Date(),
          }).run();
        },
      }, true);
    } catch (error) {
      if (transferred && child) await this.worktreeManager?.transferWorktree(task, child);
      throw error;
    }
  }

  private async transition(taskId: string, requestedStatus: TaskStatus, context: TransitionContext, humanRetry: boolean): Promise<Task> {
    const task = this.getTaskOrThrow(taskId);
    const currentStatus = task.status as TaskStatus;

    if (humanRetry ? currentStatus !== 'escalated' || requestedStatus !== 'doing' : !this.isValidTransition(currentStatus, requestedStatus, task.kind)) {
      throw new InvalidTransitionError(taskId, currentStatus, requestedStatus);
    }

    let createdWorktree: { worktreePath: string; branch: string } | null = null;
    let setupFailure: WorktreeSetupError | undefined;
    if (requestedStatus === 'doing' && this.worktreeManager) {
      try {
        createdWorktree = await this.worktreeManager.ensureWorktree(task);
      } catch (error) {
        if (!(error instanceof WorktreeSetupError)) throw error;
        setupFailure = error;
        createdWorktree = error.worktree;
      }
    }

    const pending: PendingEvent[] = [];
    try {
      const updatedTask = this.inTransaction(() => {
        const updated = this.applyTransition(taskId, requestedStatus, context, pending, createdWorktree, humanRetry);
        if (!setupFailure) return updated;
        const failure = setupFailure;
        // Setup is an environment failure, not an agent retry (D45).
        return this.applyTransition(taskId, 'escalated', {
          reason: failure.message,
          alongside: () => {
            this.db.db.insert(schema.messages).values({
              id: randomUUID(), taskId, fromAgentId: null, type: 'feedback',
              body: failure.message, createdAt: new Date(),
            }).run();
          },
        }, pending);
      });
      this.publish(pending);

      if (requestedStatus === 'cancelled' && this.worktreeManager) {
        await this.worktreeManager.removeWorktree(task);
      }

      return updatedTask;
    } catch (err) {
      if (createdWorktree && currentStatus === 'ready' && this.worktreeManager) {
        await this.worktreeManager.removeWorktree(task).catch(() => {});
      }
      throw err;
    }
  }

  /**
   * Create a task and set its initial state (ready if no blockers, todo if blockers exist).
   * All-or-nothing: a bad blocker or a cycle leaves no task behind.
   */
  async createTask(params: {
    id: string;
    boardId: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    roleId?: string;
    assigneeAgentId?: string;
    createdBy?: string;
    parentTaskId?: string;
    depth?: number;
    blockedByIds?: string[];
    kind?: 'work' | 'phase';
    creationPhase?: string;
    branch?: string;
    alongside?: () => void;
  }): Promise<Task> {
    const pending: PendingEvent[] = [];

    const task = this.inTransaction(() => {
      const now = new Date();

      this.db.db
        .insert(schema.tasks)
        .values({
          id: params.id,
          kind: params.kind ?? 'work',
          creationPhase: params.creationPhase,
          boardId: params.boardId,
          title: params.title,
          description: params.description,
          acceptanceCriteria: params.acceptanceCriteria || '',
          status: 'todo',
          roleId: params.roleId,
          assigneeAgentId: params.assigneeAgentId,
          createdBy: params.createdBy || 'human',
          parentTaskId: params.parentTaskId,
          depth: params.depth || 0,
          branch: params.branch,
          retries: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      for (const blockerId of params.blockedByIds ?? []) {
        this.insertDependency(params.id, blockerId);
      }

      params.alongside?.();

      if (this.dependenciesMerged(params.id)) {
        return this.applyTransition(params.id, 'ready', { reason: 'No unmerged blockers' }, pending);
      }
      return this.getTaskOrThrow(params.id);
    });

    this.publish(pending);
    return task;
  }

  private inTransaction<T>(fn: () => T): T {
    return this.db.sqlite.transaction(fn)();
  }

  private publish(pending: PendingEvent[]): void {
    if (!this.eventBus) return;
    for (const { boardId, event } of pending) {
      this.eventBus.publishBoardEvent(boardId, event);
    }
  }

  private getTaskOrThrow(taskId: string): Task {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task) {
      throw new TaskNotFoundError(taskId);
    }
    return task;
  }

  private dependenciesMerged(taskId: string): boolean {
    const deps = this.db.db
      .select({ blockedByTaskId: schema.taskDependencies.blockedByTaskId })
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.taskId, taskId))
      .all();

    if (deps.length === 0) {
      return true;
    }

    const blockerIds = deps.map((d) => d.blockedByTaskId);
    const blockers = this.db.db
      .select({ id: schema.tasks.id, status: schema.tasks.status })
      .from(schema.tasks)
      .where(inArray(schema.tasks.id, blockerIds))
      .all();

    return blockers.every((b) => b.status === 'merged');
  }

  private insertDependency(taskId: string, blockedByTaskId: string): void {
    if (taskId === blockedByTaskId) {
      throw new DependencyCycleError(taskId, blockedByTaskId);
    }

    this.getTaskOrThrow(taskId);
    this.getTaskOrThrow(blockedByTaskId);

    // Check for direct or indirect cycle: does taskId already block blockedByTaskId?
    const hasPath = (current: string, target: string, visited = new Set<string>()): boolean => {
      if (current === target) return true;
      if (visited.has(current)) return false;
      visited.add(current);

      const upstream = this.db.db
        .select({ blockedByTaskId: schema.taskDependencies.blockedByTaskId })
        .from(schema.taskDependencies)
        .where(eq(schema.taskDependencies.taskId, current))
        .all();

      for (const edge of upstream) {
        if (hasPath(edge.blockedByTaskId, target, visited)) {
          return true;
        }
      }
      return false;
    };

    if (hasPath(blockedByTaskId, taskId)) {
      throw new DependencyCycleError(taskId, blockedByTaskId);
    }

    this.db.db
      .insert(schema.taskDependencies)
      .values({
        taskId,
        blockedByTaskId,
      })
      .run();
  }

  private applyTransition(
    taskId: string,
    requestedStatus: TaskStatus,
    context: TransitionContext,
    pending: PendingEvent[],
    createdWorktree?: { worktreePath: string; branch: string } | null,
    humanRetry = false,
  ): Task {
    const task = this.getTaskOrThrow(taskId);
    const currentStatus = task.status as TaskStatus;

    if (humanRetry ? currentStatus !== 'escalated' || requestedStatus !== 'doing' : !this.isValidTransition(currentStatus, requestedStatus, task.kind)) {
      throw new InvalidTransitionError(taskId, currentStatus, requestedStatus);
    }

    // Special rule: todo -> ready requires all dependencies to be merged
    if (requestedStatus === 'ready' && !this.dependenciesMerged(taskId)) {
      throw new InvalidTransitionError(
        taskId,
        currentStatus,
        requestedStatus,
        `Cannot transition task ${taskId} to ready: unfinished dependencies exist.`,
      );
    }

    context.alongside?.();

    let finalStatus = requestedStatus;
    let newRetries = humanRetry ? 0 : task.retries;

    // Retry handling when moving back to 'doing' from verification or review failure
    if (
      requestedStatus === 'doing' &&
      (currentStatus === 'verifying' || currentStatus === 'review' || context.incrementRetries)
    ) {
      newRetries += 1;
      const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
      const workspace = board && this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get();
      const maxRetries = typeof workspace?.config?.maxRetries === 'number' ? workspace.config.maxRetries : this.maxRetries;
      if (newRetries > maxRetries) {
        finalStatus = 'escalated';
      }
    }

    this.db.db
      .update(schema.tasks)
      .set({
        status: finalStatus,
        retries: newRetries,
        ...(createdWorktree
          ? {
              branch: createdWorktree.branch,
              worktreePath: createdWorktree.worktreePath,
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .run();

    pending.push({
      boardId: task.boardId,
      event: {
        type: 'task_status_changed',
        data: {
          taskId,
          from: currentStatus,
          to: finalStatus,
          retries: newRetries,
          reason: context.reason,
        },
      },
    });

    // When a task is merged, unblock any downstream tasks whose blockers are now all merged
    if (finalStatus === 'merged') {
      this.promoteReadyDependents(taskId, pending);
    }

    return this.getTaskOrThrow(taskId);
  }

  /**
   * Checks downstream tasks that were blocked by this task; promotes them to 'ready' if all blockers merged.
   */
  private promoteReadyDependents(mergedTaskId: string, pending: PendingEvent[]): void {
    const dependentEdges = this.db.db
      .select({ taskId: schema.taskDependencies.taskId })
      .from(schema.taskDependencies)
      .where(eq(schema.taskDependencies.blockedByTaskId, mergedTaskId))
      .all();

    for (const edge of dependentEdges) {
      const dependentTask = this.db.db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, edge.taskId))
        .get();

      if (dependentTask && dependentTask.status === 'todo' && this.dependenciesMerged(dependentTask.id)) {
        this.applyTransition(
          dependentTask.id,
          'ready',
          { reason: `All dependencies merged (last: ${mergedTaskId})` },
          pending,
        );
      }
    }
  }
}

export * from './dispatcher.js';
