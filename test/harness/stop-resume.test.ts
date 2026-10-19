import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { Dispatcher } from '../../src/server/scheduler/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Stop-all and resume (PRD Milestone 2 Bullet 6)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      startDispatcher: false,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('stop-all kills live runs with stopped exitReason, marks agents stopped, prevents dispatch without retries, and resume restores execution', async () => {
    const taskId1 = 'task-stop-resume-1';
    await harness.createTask({
      id: taskId1,
      title: 'Long running task 1',
      description: 'Will be interrupted by stop-all',
      assigneeAgentId: harness.agentId,
    });

    // Fake agent sleeps for a long time
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Working on task 1' },
      { type: 'sleep', durationMs: 10000 },
      { type: 'done', result: 'Completed task 1' },
    ]);

    // Start dispatcher to dispatch task 1
    harness.dispatcher.start();

    // Wait until run is live
    await harness.waitForLiveRuns(1, 5000);
    const liveRuns = harness.runner.getLiveRuns();
    expect(liveRuns).toHaveLength(1);
    expect(liveRuns[0].taskId).toBe(taskId1);

    // Human CLI invokes crew stop-all
    const stopResult = await harness.runCrew(['stop-all']);
    expect(stopResult.exitCode).toBe(0);
    expect(stopResult.stdout).toMatch(/Stopped 1 live runs/);

    // Verify live runs are killed
    expect(harness.runner.getLiveRuns()).toHaveLength(0);

    // Verify DB run recorded with exitReason: 'stopped'
    const runs1 = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId1))
      .orderBy(asc(schema.runs.startedAt))
      .all();
    expect(runs1).toHaveLength(1);
    expect(runs1[0].exitReason).toBe('stopped');

    // Verify task 1 remains in 'doing' and retries was NOT incremented
    const task1AfterStop = harness.getTask(taskId1)!;
    expect(task1AfterStop.status).toBe('doing');
    expect(task1AfterStop.retries).toBe(0);

    // Verify agent is marked 'stopped'
    const agentAfterStop = harness.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, harness.agentId))
      .get()!;
    expect(agentAfterStop.status).toBe('stopped');

    // Verify persistence marker file exists in crewHome (D23)
    const stoppedMarkerPath = path.join(harness.crewHomeDir, 'stopped');
    expect(fs.existsSync(stoppedMarkerPath)).toBe(true);

    // Create a second task that becomes 'ready'
    const taskId2 = 'task-stop-resume-2';
    await harness.createTask({
      id: taskId2,
      title: 'Task 2 during stopped state',
      description: 'Should not be dispatched while stopped',
    });

    // Trigger dispatch explicitly to prove it does not dispatch while stopped
    harness.dispatcher.scheduleDispatch();
    await new Promise((r) => setTimeout(r, 200));

    expect(harness.runner.getLiveRuns()).toHaveLength(0);
    const task2BeforeResume = harness.getTask(taskId2)!;
    expect(task2BeforeResume.status).toBe('ready');

    // Verify D23: simulate server restart by creating a new Dispatcher instance
    const restartedDispatcher = new Dispatcher({
      db: harness.db,
      scheduler: harness.scheduler,
      runner: harness.runner,
      eventBus: harness.eventBus,
      crewHome: harness.crewHomeDir,
    });
    expect(restartedDispatcher.isStopped()).toBe(true);

    // Configure fake script for fast completion on resume
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Resumed run progress' },
      { type: 'done', result: 'Completed after resume' },
    ]);

    // Human CLI invokes crew resume
    const resumeResult = await harness.runCrew(['resume']);
    expect(resumeResult.exitCode).toBe(0);
    expect(resumeResult.stdout).toMatch(/Dispatch resumed/);

    // Verify stopped marker file was removed
    expect(fs.existsSync(stoppedMarkerPath)).toBe(false);

    // Wait for both tasks to finish and reach 'verifying'
    await harness.waitForTasksStatus([taskId1, taskId2], 'verifying', 15000);
    await harness.waitForLiveRuns(0, 10000);

    // Verify final states
    const task1Final = harness.getTask(taskId1)!;
    expect(task1Final.status).toBe('verifying');
    expect(task1Final.retries).toBe(0); // Still 0 retries used!

    const task2Final = harness.getTask(taskId2)!;
    expect(task2Final.status).toBe('verifying');
    expect(task2Final.retries).toBe(0);

    // Verify runs for task 1: run 1 stopped, run 2 done
    const task1Runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId1))
      .orderBy(asc(schema.runs.startedAt))
      .all();
    expect(task1Runs).toHaveLength(2);
    expect(task1Runs[0].exitReason).toBe('stopped');
    expect(task1Runs[1].exitReason).toBe('done');
  });
});
