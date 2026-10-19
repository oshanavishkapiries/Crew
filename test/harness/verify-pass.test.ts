import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('The pass path to merge-queue (Milestone 3 Bullet 3)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      startVerifier: true,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('runs diff and command gates, skips review when no reviewer agent, and reaches merge-queue in order', async () => {
    const taskId = 'task-pass-to-merge-queue';

    // Configure 2 passing verify commands
    harness.setVerifyCommands([
      {
        name: 'lint',
        command: 'node -e "console.log(\'Lint clean\')"',
      },
      {
        name: 'test-suite',
        command: 'node -e "console.log(\'Tests passed: 5/5\')"',
      },
    ]);

    // Track verification_step events in order
    const stepEvents: Array<{ step: string; passed: boolean }> = [];
    const unsubscribeSteps = harness.eventBus.subscribeBoardEvents(harness.boardId, (event) => {
      if (event.type === 'verification_step') {
        const data = event.data as any;
        if (data?.taskId === taskId) {
          stepEvents.push({
            step: data.step,
            passed: data.passed,
          });
        }
      }
    });

    // Track status transitions
    const statusEvents: string[] = [];
    const unsubscribeStatus = harness.eventBus.subscribeBoardEvents(harness.boardId, (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as any;
        if (data?.taskId === taskId) {
          statusEvents.push(`${data.from}->${data.to}`);
        }
      }
    });

    await harness.createTask({
      id: taskId,
      title: 'Successful Task',
      description: 'Tests complete pass path to merge-queue',
    });

    // Run agent with file change and crew done
    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Implementing feature' },
      { type: 'edit_file', filePath: 'feature.ts', content: 'export const feature = true;\n' },
      { type: 'done', result: 'Feature complete' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for task to reach 'merge-queue'
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue', 15000);
    expect(finalTask.status).toBe('merge-queue');
    expect(finalTask.retries).toBe(0);

    unsubscribeSteps();
    unsubscribeStatus();

    // Verify verification_results in DB
    const vrResults = harness.getVerificationResults(taskId);
    expect(vrResults).toHaveLength(4);

    expect(vrResults[0].step).toBe('diff');
    expect(vrResults[0].passed).toBe(true);
    expect(vrResults[0].output).toContain('Diff gate passed');

    expect(vrResults[1].step).toBe('lint');
    expect(vrResults[1].passed).toBe(true);
    expect(vrResults[1].output).toContain('Lint clean');

    expect(vrResults[2].step).toBe('test-suite');
    expect(vrResults[2].passed).toBe(true);
    expect(vrResults[2].output).toContain('Tests passed: 5/5');

    expect(vrResults[3].step).toBe('review');
    expect(vrResults[3].passed).toBe(true);
    expect(vrResults[3].output).toBe('skipped: no reviewer agent');

    // Verify verification_step events were published in exact order
    expect(stepEvents).toEqual([
      { step: 'diff', passed: true },
      { step: 'lint', passed: true },
      { step: 'test-suite', passed: true },
      { step: 'review', passed: true },
    ]);

    // Verify status transition sequence
    expect(statusEvents).toEqual([
      'todo->ready',
      'ready->doing',
      'doing->verifying',
      'verifying->review',
      'review->merge-queue',
    ]);
  });
});
