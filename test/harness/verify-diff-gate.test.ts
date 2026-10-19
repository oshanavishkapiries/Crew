import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, desc } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Diff gate and failure loop (Milestone 3 Bullet 0)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      startVerifier: true,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('fails diff gate when agent changes nothing, transitions verifying -> doing with retries = 1, and appends feedback to next prompt', async () => {
    const taskId = 'task-diff-gate-fail';
    await harness.createTask({
      id: taskId,
      title: 'Empty Diff Task',
      description: 'Test diff gate failure on empty changes',
    });

    // 1. First run: fake agent makes no changes and calls done
    const firstRun = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Starting task with no changes' },
      { type: 'done', result: 'Finished with empty diff' },
    ]);

    expect(firstRun.exitCode).toBe(0);
    expect(firstRun.exitReason).toBe('done');

    // Wait for verification_step event or task to return to doing
    await harness.waitForTaskStatus(taskId, 'doing', 10000);

    const taskAfterFail = harness.getTask(taskId)!;
    expect(taskAfterFail.status).toBe('doing');
    expect(taskAfterFail.retries).toBe(1);

    // Check verification_results row
    const vrResults = harness.getVerificationResults(taskId);
    expect(vrResults.length).toBeGreaterThanOrEqual(1);
    const diffVr = vrResults.find((r) => r.step === 'diff')!;
    expect(diffVr).toBeDefined();
    expect(diffVr.passed).toBe(false);
    expect(diffVr.output).toContain('no changes against main');

    // Check feedback message in messages table
    const messages = harness.getMessages(taskId);
    const feedbackMsg = messages.find((m) => m.type === 'feedback');
    expect(feedbackMsg).toBeDefined();
    expect(feedbackMsg!.body).toContain('no changes against main');

    // 2. Second run: check that the new run's prompt contains the feedback
    const secondRun = await harness.runner.runTask(taskId);
    expect(secondRun.exitCode).toBe(0);

    const runRow = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.id, secondRun.runId))
      .get()!;

    expect(runRow.prompt).toContain('Latest verification feedback:');
    expect(runRow.prompt).toContain('no changes against main');
  });

  it('auto-commits uncommitted files left in worktree and passes diff gate (D30)', async () => {
    const taskId = 'task-diff-gate-autocommit';
    await harness.createTask({
      id: taskId,
      title: 'Auto Commit Task',
      description: 'Test auto-commit of leftover changes',
    });

    // Run agent that writes a file without git commit, then calls done
    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Writing file but not committing' },
      { type: 'edit_file', filePath: 'autocommit.txt', content: 'hello from verifier\n' },
      { type: 'done', result: 'Work completed without commit' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for diff verification step
    const stepEvent = await harness.waitForVerificationStep(taskId, 'diff', 10000);
    expect(stepEvent.passed).toBe(true);

    const vrResults = harness.getVerificationResults(taskId);
    const diffVr = vrResults.find((r) => r.step === 'diff')!;
    expect(diffVr).toBeDefined();
    expect(diffVr.passed).toBe(true);
    expect(diffVr.output).toContain('Diff gate passed');

    // Verify task worktree has clean git status now (was committed)
    const task = harness.getTask(taskId)!;
    const worktreePath = task.worktreePath!;
    const statusRes = await fs.promises.readdir(worktreePath);
    expect(statusRes).toContain('autocommit.txt');
  });

  it('fails diff gate when a symlink points outside worktree (D31)', async () => {
    const taskId = 'task-diff-symlink-escape';
    await harness.createTask({
      id: taskId,
      title: 'Symlink Escape Task',
      description: 'Test out-of-worktree symlink detection',
    });

    // Run agent that creates a symlink pointing outside worktree
    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Creating escaping symlink' },
      {
        type: 'symlink',
        filePath: 'bad_link',
        targetPath: '/etc/hosts',
      },
      { type: 'done', result: 'Escaping symlink created' },
    ]);

    expect(runResult.exitCode).toBe(0);

    await harness.waitForTaskStatus(taskId, 'doing', 10000);

    const vrResults = harness.getVerificationResults(taskId);
    const diffVr = vrResults.find((r) => r.step === 'diff')!;
    expect(diffVr).toBeDefined();
    expect(diffVr.passed).toBe(false);
    expect(diffVr.output).toContain('points outside worktree');
  });

  it('fails diff gate when main checkout is modified during run (D31)', async () => {
    const taskId = 'task-diff-main-checkout-modified';
    await harness.createTask({
      id: taskId,
      title: 'Main Checkout Modified Task',
      description: 'Test main checkout change detection',
    });

    const repoDir = harness.repoDir;

    // Run agent that modifies the main checkout directly and calls done
    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Sneakily modifying main checkout' },
      {
        type: 'edit_file',
        filePath: path.join(repoDir, 'sneaky.txt'),
        content: 'escape!\n',
      },
      {
        type: 'edit_file',
        filePath: 'worktree_valid.txt',
        content: 'valid worktree edit\n',
      },
      { type: 'done', result: 'Modified main checkout' },
    ]);

    expect(runResult.exitCode).toBe(0);

    await harness.waitForTaskStatus(taskId, 'doing', 10000);

    const vrResults = harness.getVerificationResults(taskId);
    const diffVr = vrResults.find((r) => r.step === 'diff')!;
    expect(diffVr).toBeDefined();
    expect(diffVr.passed).toBe(false);
    expect(diffVr.output).toContain('Out-of-worktree changes detected in main checkout');
  });
});
