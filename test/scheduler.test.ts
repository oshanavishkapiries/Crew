import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';
import { EventBus } from '../src/server/events/index.js';
import {
  DependencyCycleError,
  InvalidTransitionError,
  Scheduler,
} from '../src/server/scheduler/index.js';

describe('Task State Machine and Dependencies (PRD lines 308-332)', () => {
  let db: CrewDatabase;
  let eventBus: EventBus;
  let scheduler: Scheduler;

  beforeEach(() => {
    db = createCrewDatabase({ inMemory: true });
    eventBus = new EventBus();
    scheduler = new Scheduler(db, eventBus, { maxRetries: 3 });

    // Seed workspace and board
    const now = new Date();
    db.db
      .insert(schema.workspaces)
      .values({
        id: 'ws-1',
        name: 'Workspace 1',
        repoPath: '/tmp/repo',
        createdAt: now,
      })
      .run();

    db.db
      .insert(schema.boards)
      .values({
        id: 'board-1',
        workspaceId: 'ws-1',
        createdAt: now,
      })
      .run();
  });

  it('drives a task through the happy path: todo -> ready -> doing -> verifying -> review -> merge-queue -> merged', async () => {
    const task = await scheduler.createTask({
      id: 'task-1',
      boardId: 'board-1',
      title: 'Happy path task',
      description: 'Test all transitions',
    });

    // Created with no blockers -> automatically becomes ready
    expect(task.status).toBe('ready');

    const doing = await scheduler.transitionTask('task-1', 'doing');
    expect(doing.status).toBe('doing');

    const verifying = await scheduler.transitionTask('task-1', 'verifying');
    expect(verifying.status).toBe('verifying');

    const review = await scheduler.transitionTask('task-1', 'review');
    expect(review.status).toBe('review');

    const mq = await scheduler.transitionTask('task-1', 'merge-queue');
    expect(mq.status).toBe('merge-queue');

    const merged = await scheduler.transitionTask('task-1', 'merged');
    expect(merged.status).toBe('merged');
  });

  it('rejects invalid state transitions', async () => {
    await scheduler.createTask({
      id: 'task-invalid',
      boardId: 'board-1',
      title: 'Invalid transitions',
      description: 'Check guards',
    });

    // Current is ready. Cannot jump directly to merged
    await expect(scheduler.transitionTask('task-invalid', 'merged')).rejects.toThrow(
      InvalidTransitionError,
    );

    // Transition to doing
    await scheduler.transitionTask('task-invalid', 'doing');

    // Cannot jump from doing to review directly
    await expect(scheduler.transitionTask('task-invalid', 'review')).rejects.toThrow(
      InvalidTransitionError,
    );

    // Cancel task
    await scheduler.transitionTask('task-invalid', 'cancelled');

    // Terminal state: cannot transition out of cancelled
    await expect(scheduler.transitionTask('task-invalid', 'ready')).rejects.toThrow(
      InvalidTransitionError,
    );
  });

  it('handles blocked and resumed flow (crew ask / answer)', async () => {
    await scheduler.createTask({
      id: 'task-ask',
      boardId: 'board-1',
      title: 'Task needing clarification',
      description: 'Blocks on question',
    });

    await scheduler.transitionTask('task-ask', 'doing');

    // Agent calls crew ask -> status becomes blocked
    const blocked = await scheduler.transitionTask('task-ask', 'blocked');
    expect(blocked.status).toBe('blocked');

    // Human answers question -> resumes to doing
    const resumed = await scheduler.transitionTask('task-ask', 'doing');
    expect(resumed.status).toBe('doing');
  });

  it('increments retries and escalates when max retries exceeded', async () => {
    await scheduler.createTask({
      id: 'task-retry',
      boardId: 'board-1',
      title: 'Flaky task',
      description: 'Fails verification repeatedly',
    });

    await scheduler.transitionTask('task-retry', 'doing');
    await scheduler.transitionTask('task-retry', 'verifying');

    // Retry 1: verifying -> doing
    let t = await scheduler.transitionTask('task-retry', 'doing');
    expect(t.status).toBe('doing');
    expect(t.retries).toBe(1);

    // Retry 2
    await scheduler.transitionTask('task-retry', 'verifying');
    t = await scheduler.transitionTask('task-retry', 'doing');
    expect(t.status).toBe('doing');
    expect(t.retries).toBe(2);

    // Retry 3
    await scheduler.transitionTask('task-retry', 'verifying');
    t = await scheduler.transitionTask('task-retry', 'doing');
    expect(t.status).toBe('doing');
    expect(t.retries).toBe(3);

    // Retry 4: exceeds maxRetries (3) -> escalated
    await scheduler.transitionTask('task-retry', 'verifying');
    t = await scheduler.transitionTask('task-retry', 'doing');
    expect(t.status).toBe('escalated');
    expect(t.retries).toBe(4);
  });

  it('enforces dependencies: task stays in todo until blocker is merged', async () => {
    // Task A (blocker)
    const taskA = await scheduler.createTask({
      id: 'task-a',
      boardId: 'board-1',
      title: 'Foundation',
      description: 'Must merge first',
    });
    expect(taskA.status).toBe('ready');

    // Task B (blocked by Task A)
    const taskB = await scheduler.createTask({
      id: 'task-b',
      boardId: 'board-1',
      title: 'Feature',
      description: 'Depends on Foundation',
      blockedByIds: ['task-a'],
    });

    // Task B has unmerged blocker -> status must be todo
    expect(taskB.status).toBe('todo');

    // Attempting to force task-b to ready before task-a merges must fail
    await expect(scheduler.transitionTask('task-b', 'ready')).rejects.toThrow(
      InvalidTransitionError,
    );

    // Progress Task A to doing -> verifying -> review -> merge-queue -> merged
    await scheduler.transitionTask('task-a', 'doing');
    await scheduler.transitionTask('task-a', 'verifying');
    await scheduler.transitionTask('task-a', 'review');
    await scheduler.transitionTask('task-a', 'merge-queue');
    await scheduler.transitionTask('task-a', 'merged');

    // Upon Task A merging, Task B is automatically promoted to ready!
    const taskBUpdated = db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, 'task-b'))
      .get()!;

    expect(taskBUpdated.status).toBe('ready');
  });

  it('detects cyclic dependencies and throws DependencyCycleError', async () => {
    await scheduler.createTask({
      id: 'cycle-1',
      boardId: 'board-1',
      title: 'Task 1',
      description: 'Desc',
    });

    await scheduler.createTask({
      id: 'cycle-2',
      boardId: 'board-1',
      title: 'Task 2',
      description: 'Desc',
    });

    // Self dependency
    await expect(scheduler.addDependency('cycle-1', 'cycle-1')).rejects.toThrow(
      DependencyCycleError,
    );

    // 1 depends on 2
    await scheduler.addDependency('cycle-1', 'cycle-2');

    // 2 depends on 1 -> cycle!
    await expect(scheduler.addDependency('cycle-2', 'cycle-1')).rejects.toThrow(
      DependencyCycleError,
    );
  });
});
