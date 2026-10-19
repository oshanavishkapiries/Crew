import * as fs from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Dispatcher (PRD Milestone 2 Bullet 4)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      maxParallelAgents: 3,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('dispatches 5 ready tasks with max 3 parallel: never more than 3 live runs, all 5 reach verifying', async () => {
    // We already have harness.agentId ('agent-fake-1'). Add two more agents for role-backend.
    harness.addAgent('agent-fake-2');
    harness.addAgent('agent-fake-3');

    // Configure fake script: sleep 200ms then call crew done
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Starting dispatcher test task' },
      { type: 'sleep', durationMs: 200 },
      { type: 'done', result: 'Task finished by dispatcher' },
    ]);

    // Create 5 tasks without assignee
    const taskIds = [
      'task-parallel-1',
      'task-parallel-2',
      'task-parallel-3',
      'task-parallel-4',
      'task-parallel-5',
    ];

    for (let i = 0; i < taskIds.length; i++) {
      const id = taskIds[i];
      await harness.createTask({
        id,
        title: `Parallel Task ${i + 1}`,
        description: `Description for parallel task ${i + 1}`,
        assigneeAgentId: undefined,
      });
    }

    let maxLiveRunsSeen = 0;
    let limitExceeded = false;

    const trackLiveRuns = () => {
      const count = harness.runner.getLiveRuns().length;
      if (count > maxLiveRunsSeen) {
        maxLiveRunsSeen = count;
      }
      if (count > 3) {
        limitExceeded = true;
      }
    };

    harness.runner.on('run_started', trackLiveRuns);
    harness.runner.on('run_ended', trackLiveRuns);

    // Start the dispatcher
    harness.dispatcher.start();

    // Wait for all 5 tasks to reach 'verifying'
    await harness.waitForTasksStatus(taskIds, 'verifying', 15000);
    // Wait for all runner processes to finish exiting
    await harness.waitForLiveRuns(0, 10000);

    harness.runner.off('run_started', trackLiveRuns);
    harness.runner.off('run_ended', trackLiveRuns);

    // Verify concurrency limits were respected
    expect(limitExceeded).toBe(false);
    expect(maxLiveRunsSeen).toBe(3);
    expect(harness.runner.getLiveRuns()).toHaveLength(0);

    // Verify all 5 tasks reached verifying and have worktrees/runs
    for (const taskId of taskIds) {
      const task = harness.getTask(taskId);
      expect(task).toBeDefined();
      expect(task!.status).toBe('verifying');
      expect(task!.worktreePath).toBeDefined();
      expect(fs.existsSync(task!.worktreePath!)).toBe(true);
      expect(task!.branch).toMatch(/^crew\/task-parallel-\d+/);
      expect(task!.assigneeAgentId).toMatch(/^agent-fake-[123]$/);

      const runs = harness.db.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.taskId, taskId))
        .all();
      expect(runs.length).toBeGreaterThanOrEqual(1);
      expect(runs[0].exitReason).toBe('done');
    }
  });

  it('re-dispatches orphan doing tasks on startup without using a retry', async () => {
    // Stop dispatcher to simulate offline server state
    harness.dispatcher.stop();

    const orphanTaskId = 'task-orphan-doing-1';
    await harness.createTask({
      id: orphanTaskId,
      title: 'Orphan Doing Task',
      description: 'Task left in doing status with no active runner process',
      assigneeAgentId: harness.agentId,
    });

    // Move to doing while offline
    await harness.scheduler.transitionTask(orphanTaskId, 'doing', {
      reason: 'Started before crash',
    });

    const taskBefore = harness.getTask(orphanTaskId)!;
    expect(taskBefore.status).toBe('doing');
    expect(taskBefore.retries).toBe(0);
    expect(harness.runner.getLiveRunByTaskId(orphanTaskId)).toBeUndefined();

    // Start dispatcher (simulating server start)
    harness.dispatcher.start();

    // Wait for task to finish
    await harness.waitForTaskStatus(orphanTaskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    const taskAfter = harness.getTask(orphanTaskId)!;
    expect(taskAfter.status).toBe('verifying');
    expect(taskAfter.retries).toBe(0); // Retry was NOT incremented
  });

  it('assigns an idle agent of the matching role when task has no assignee', async () => {
    // Add frontend role and frontend agent
    const frontendRoleId = 'role-frontend';
    const frontendAgentId = 'agent-frontend-1';

    harness.db.db
      .insert(schema.roles)
      .values({
        id: frontendRoleId,
        name: 'frontend',
        defaultPrompt: 'You are a frontend agent.',
        permissionProfile: { allowBash: true },
        isBuiltin: false,
        createdAt: new Date(),
      })
      .run();

    harness.addAgent(frontendAgentId, frontendRoleId);

    const taskId = 'task-role-match-1';
    await harness.createTask({
      id: taskId,
      title: 'Frontend Component Task',
      description: 'Must be assigned to frontend agent',
      roleId: frontendRoleId,
      assigneeAgentId: undefined,
    });

    harness.dispatcher.scheduleDispatch();

    await harness.waitForTaskStatus(taskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    const task = harness.getTask(taskId)!;
    expect(task.status).toBe('verifying');
    expect(task.assigneeAgentId).toBe(frontendAgentId);
  });
});
