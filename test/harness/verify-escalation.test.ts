import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Verification escalation (Milestone 3 Bullet 1)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      maxRetries: 2,
      startDispatcher: true,
      startVerifier: true,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('escalates after maxRetries when agent repeatedly fails diff gate, recording all results and events', async () => {
    const taskId = 'task-verify-escalate-1';
    // SQLite timestamps have second precision. Force the tie that previously lost an attempt.
    harness.runner.on('run_started', run => {
      harness.db.db.update(schema.runs).set({ startedAt: new Date('2020-01-01T00:00:00Z') }).where(eq(schema.runs.id, run.id)).run();
    });

    // The fake script makes no changes and calls crew done every run
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Failing run with empty diff' },
      { type: 'done', result: 'Called done with empty diff' },
    ]);

    // Track status change events
    const statusEvents: Array<{ from: string; to: string; retries?: number }> = [];
    const unsubscribeStatus = harness.eventBus.subscribeBoardEvents(harness.boardId, (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as any;
        if (data?.taskId === taskId) {
          statusEvents.push({
            from: data.from,
            to: data.to,
            retries: data.retries,
          });
        }
      }
    });

    // Track verification_step events
    const verifyEvents: Array<{ step: string; passed: boolean }> = [];
    const unsubscribeVerify = harness.eventBus.subscribeBoardEvents(harness.boardId, (event) => {
      if (event.type === 'verification_step') {
        const data = event.data as any;
        if (data?.taskId === taskId) {
          verifyEvents.push({
            step: data.step,
            passed: data.passed,
          });
        }
      }
    });

    // Create task in ready state
    await harness.createTask({
      id: taskId,
      title: 'Persistent Diff Gate Fail Task',
      description: 'Test escalation after repeated diff gate failures',
    });

    // Wait for task to reach terminal 'escalated' state
    const finalTask = await harness.waitForTaskStatus(taskId, 'escalated', 25000);
    expect(finalTask.status).toBe('escalated');
    expect(finalTask.retries).toBe(3); // 0 -> 1 -> 2 -> 3 (> maxRetries 2)

    // Wait for live runs to clear
    await harness.waitForLiveRuns(0, 5000);

    unsubscribeStatus();
    unsubscribeVerify();

    // Verify verification results in DB
    const vrResults = harness.getVerificationResults(taskId);
    // Should have 3 failed diff results (one per attempt)
    expect(vrResults).toHaveLength(3);
    for (const vr of vrResults) {
      expect(vr.step).toBe('diff');
      expect(vr.passed).toBe(false);
      expect(vr.output).toContain('no changes against main');
    }

    // Verify verification_step events (3 diff failures)
    expect(verifyEvents).toHaveLength(3);
    for (const ev of verifyEvents) {
      expect(ev.step).toBe('diff');
      expect(ev.passed).toBe(false);
    }

    // Verify task status sequence
    // ready -> doing (retries: 0)
    // doing -> verifying (run 1 done)
    // verifying -> doing (run 1 diff fail, retries: 1)
    // doing -> verifying (run 2 done)
    // verifying -> doing (run 2 diff fail, retries: 2)
    // doing -> verifying (run 3 done)
    // verifying -> escalated (run 3 diff fail, retries: 3 > maxRetries 2)
    const transitions = statusEvents.map((e) => `${e.from}->${e.to}`);
    expect(transitions).toEqual([
      'todo->ready',
      'ready->doing',
      'doing->verifying',
      'verifying->doing',
      'doing->verifying',
      'verifying->doing',
      'doing->verifying',
      'verifying->escalated',
    ]);

    // Check that feedback messages were created for the failures
    const messages = harness.getMessages(taskId);
    const feedbackMessages = messages.filter((m) => m.type === 'feedback');
    expect(feedbackMessages).toHaveLength(3);

    // Verify no further runs are dispatched for the escalated task
    const initialRunCount = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all().length;
    expect(initialRunCount).toBe(3);

    // A real dispatch pass must leave the escalated task alone.
    await harness.dispatcher.dispatchOnce();
    const postRunCount = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all().length;
    expect(postRunCount).toBe(3);
  });
});
