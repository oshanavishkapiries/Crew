import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Human CLI for verification (Milestone 3 Bullet 7)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({ maxRetries: 2 });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('crew results prints verification steps with pass/fail and failure output', async () => {
    const taskId = 'task-results-cli-test';
    await harness.createTask({
      id: taskId,
      title: 'Results CLI test task',
      description: 'Task with passing and failing steps',
    });

    const agentToken = harness.addAgent('agent-results-test');
    await harness.scheduler.transitionTask(taskId, 'doing', {
      reason: 'Start task',
      alongside: () => {
        harness.db.db
          .update(schema.tasks)
          .set({ assigneeAgentId: 'agent-results-test' })
          .where(eq(schema.tasks.id, taskId))
          .run();
      },
    });

    // Create a run and insert verification results
    const runId = 'run-results-1';
    harness.db.db
      .insert(schema.runs)
      .values({
        id: runId,
        taskId,
        agentId: 'agent-results-test',
        adapter: 'fake',
        startedAt: new Date(),
        kind: 'work',
        logPath: path.join(harness.crewHomeDir, 'logs', `${runId}.jsonl`),
        prompt: 'Prompt for results test',
      })
      .run();

    harness.db.db
      .insert(schema.verificationResults)
      .values([
        {
          id: 'vr-1',
          runId,
          step: 'diff',
          passed: true,
          output: 'Diff gate passed',
          createdAt: new Date(Date.now() - 2000),
        },
        {
          id: 'vr-2',
          runId,
          step: 'typecheck',
          passed: true,
          output: 'Found 0 errors',
          createdAt: new Date(Date.now() - 1000),
        },
        {
          id: 'vr-3',
          runId,
          step: 'unit-tests',
          passed: false,
          output: 'FAIL src/math.test.ts\n  ✕ adds numbers correctly\nExpected: 42\nReceived: 0',
          createdAt: new Date(),
        },
      ])
      .run();

    const res = await harness.runCrew(['results', taskId]);
    expect(res.exitCode).toBe(0);

    expect(res.stdout).toContain(`Verification results for task ${taskId}:`);
    expect(res.stdout).toContain('[pass] diff');
    expect(res.stdout).toContain('[pass] typecheck');
    expect(res.stdout).toContain('[fail] unit-tests');
    expect(res.stdout).toContain('Failed step output:');
    expect(res.stdout).toContain('--- unit-tests ---');
    expect(res.stdout).toContain('FAIL src/math.test.ts');
    expect(res.stdout).toContain('Expected: 42');
  });

  it('crew results reports when no verification results exist for task', async () => {
    const taskId = 'task-no-results';
    await harness.createTask({
      id: taskId,
      title: 'Task with no results',
      description: 'Never ran verification',
    });

    const res = await harness.runCrew(['results', taskId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(`No verification results for task ${taskId}.`);
  });

  it('crew status shows tasks currently being verified or reviewed', async () => {
    const verifyingTaskId = 'task-status-verifying';
    await harness.createTask({
      id: verifyingTaskId,
      title: 'Verifying Task Display Test',
      description: 'Being verified',
    });

    const reviewTaskId = 'task-status-review';
    await harness.createTask({
      id: reviewTaskId,
      title: 'Review Task Display Test',
      description: 'Under review',
    });

    // Move first task to verifying
    await harness.scheduler.transitionTask(verifyingTaskId, 'doing', { reason: 'start' });
    await harness.scheduler.transitionTask(verifyingTaskId, 'verifying', { reason: 'submitted' });

    // Move second task to review with reviewer assigned
    const reviewerId = harness.addAgent('agent-status-reviewer');
    await harness.scheduler.transitionTask(reviewTaskId, 'doing', { reason: 'start' });
    await harness.scheduler.transitionTask(reviewTaskId, 'verifying', { reason: 'submitted' });
    await harness.scheduler.transitionTask(reviewTaskId, 'review', {
      reason: 'diff passed',
      alongside: () => {
        harness.db.db
          .update(schema.tasks)
          .set({ reviewerAgentId: 'agent-status-reviewer' })
          .where(eq(schema.tasks.id, reviewTaskId))
          .run();
      },
    });

    const res = await harness.runCrew(['status']);
    expect(res.exitCode).toBe(0);

    expect(res.stdout).toContain('=== Crew Status ===');
    expect(res.stdout).toContain('Verifying Tasks (1):');
    expect(res.stdout).toContain(`Task ${verifyingTaskId}: Verifying Task Display Test`);

    expect(res.stdout).toContain('Review Tasks (1):');
    expect(res.stdout).toContain(`Task ${reviewTaskId}: Review Task Display Test (Reviewer: agent-status-reviewer)`);
  });
});
