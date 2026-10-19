import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { eq } from 'drizzle-orm';
import { Verifier } from '../../src/server/verify/index.js';

describe('Verification interruptions and recovery (milestone 3 bullet 5, D7, D23, D35, D37)', () => {
  let harness: PipelineHarness;

  beforeEach(async () => {
    harness = await createPipelineHarness();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('re-verifies tasks on server restart and replaces uncompleted results without duplication (PRD §4.6)', async () => {
    const taskId = 'task-restart-verifying';
    await harness.createTask({
      id: taskId,
      title: 'Restart Verifying Task',
      description: 'Check recovery on restart',
    });

    // Make an edit and done
    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'restart_file.txt',
        content: 'content for restart',
      },
      { type: 'done' as const, result: 'done' },
    ];
    await harness.runTaskWithAgent(taskId, authorScript);
    expect(harness.getTask(taskId)!.status).toBe('verifying');

    // Simulate an incomplete/interrupted verification run by inserting a partial result
    const lastRun = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .get()!;

    harness.db.db
      .insert(schema.verificationResults)
      .values({
        id: 'vr-partial-1',
        runId: lastRun.id,
        step: 'diff',
        passed: true,
        output: 'partial previous run output',
        createdAt: new Date(),
      })
      .run();

    expect(harness.getVerificationResults(taskId)).toHaveLength(1);

    // Start a new Verifier instance (simulating server restart)
    const newVerifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
    });
    newVerifier.start();

    // The task should be re-verified and transition to merge-queue (no reviewer agent)
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');

    // Verification results should be clean and not contain the old partial result
    const vrResults = harness.getVerificationResults(taskId);
    expect(vrResults.map((r) => r.id)).not.toContain('vr-partial-1');
    expect(vrResults.find((r) => r.step === 'diff')?.passed).toBe(true);
    expect(vrResults.find((r) => r.step === 'review')?.passed).toBe(true);

    newVerifier.stop();
  });

  it('re-runs review on server restart if task was in review with no live run (PRD §4.6)', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-restart-reviewer';
    harness.addAgent(reviewerAgentId, reviewerRoleId);

    const taskId = 'task-restart-review';
    await harness.createTask({
      id: taskId,
      title: 'Restart Review Task',
      description: 'Check review step recovery on restart',
    });

    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'review_recovery.txt',
        content: 'content',
      },
      { type: 'done' as const, result: 'done' },
    ];
    await harness.runTaskWithAgent(taskId, authorScript);

    // Transition task to review
    await harness.scheduler.transitionTask(taskId, 'review');

    // Reviewer script to run on recovery
    const reviewerScript = [
      { type: 'review' as const, action: 'approve' as const },
    ];
    harness.fakeAdapter.setScript(reviewerScript);

    // Start a new Verifier instance
    const newVerifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
    });
    newVerifier.start();

    // Task should be picked up in review and reach merge-queue
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');

    newVerifier.stop();
  });

  it('stop-all kills running verify commands, keeps tasks in verifying, and resume restarts without retries (D23)', async () => {
    // Configure verify command that takes some time
    harness.setVerifyCommands([
      {
        name: 'slow-test',
        command: 'node -e "setTimeout(() => {}, 10000)"',
      },
    ]);

    const verifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
    });
    verifier.start();

    const taskId = 'task-stop-resume-verify';
    await harness.createTask({
      id: taskId,
      title: 'Stop Resume Verify Task',
      description: 'Verify stop-all kills command and resume continues',
    });

    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'test.txt',
        content: 'changes',
      },
      { type: 'done' as const, result: 'done' },
    ];
    await harness.runTaskWithAgent(taskId, authorScript);
    expect(harness.getTask(taskId)!.status).toBe('verifying');

    // Wait briefly for verify command to be executing
    await new Promise((r) => setTimeout(r, 400));

    // Call stop-all
    const stopRes = await harness.runCrew(['stop-all']);
    expect(stopRes.exitCode).toBe(0);

    // Task should still be in verifying and retries should be 0
    const taskAfterStop = harness.getTask(taskId);
    expect(taskAfterStop?.status).toBe('verifying');
    expect(taskAfterStop?.retries).toBe(0);

    // Now change verify command to pass quickly for resume
    harness.setVerifyCommands([
      {
        name: 'fast-test',
        command: 'node -e "process.exit(0)"',
      },
    ]);

    // Call resume
    const resumeRes = await harness.runCrew(['resume']);
    expect(resumeRes.exitCode).toBe(0);

    // Task should complete verification and reach merge-queue without retries
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');
    expect(finalTask.retries).toBe(0);

    verifier.stop();
  });

  it('cancel kills in-flight verification command first before removing worktree', async () => {
    // Configure long-running verify command
    harness.setVerifyCommands([
      {
        name: 'hanging-test',
        command: 'node -e "setTimeout(() => {}, 30000)"',
      },
    ]);

    const verifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
    });
    verifier.start();

    const taskId = 'task-cancel-verify';
    await harness.createTask({
      id: taskId,
      title: 'Cancel Verify Task',
      description: 'Check cancel kills verify pipeline',
    });

    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'cancel_file.txt',
        content: 'cancel testing',
      },
      { type: 'done' as const, result: 'done' },
    ];
    await harness.runTaskWithAgent(taskId, authorScript);
    expect(harness.getTask(taskId)!.status).toBe('verifying');

    // Wait briefly for verify command to start
    await new Promise((r) => setTimeout(r, 400));

    // Cancel task
    const cancelRes = await harness.runCrew(['cancel', taskId]);
    expect(cancelRes.exitCode).toBe(0);

    const taskAfterCancel = harness.getTask(taskId);
    expect(taskAfterCancel?.status).toBe('cancelled');

    verifier.stop();
  });

  it('enforces parallel verification limit of maxParallelVerifications (PRD Decision D37)', async () => {
    // Set 2 max parallel verifications
    const verifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
      maxParallelVerifications: 2,
    });
    verifier.start();

    // Verify command that takes 800ms
    harness.setVerifyCommands([
      {
        name: 'timed-cmd',
        command: 'node -e "setTimeout(() => {}, 800)"',
      },
    ]);

    const taskIds = ['task-pv-1', 'task-pv-2', 'task-pv-3'];

    for (const id of taskIds) {
      await harness.createTask({
        id,
        title: id,
        description: 'Testing concurrency',
      });
      const script = [
        {
          type: 'edit_file' as const,
          filePath: `${id}.txt`,
          content: 'data',
        },
        { type: 'done' as const, result: 'done' },
      ];
      await harness.runTaskWithAgent(id, script);
    }

    // All 3 should eventually reach merge-queue
    await harness.waitForTasksStatus(taskIds, 'merge-queue', 20000);

    for (const id of taskIds) {
      expect(harness.getTask(id)!.status).toBe('merge-queue');
    }

    verifier.stop();
  });

  it('pauses a rate-limited Reviewer without using a retry or the 2-run allowance (PRD D7, D35)', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-reviewer-ratelimit';
    harness.addAgent(reviewerAgentId, reviewerRoleId, 'codex');

    const verifier = new Verifier({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      worktreeManager: harness.worktreeManager,
      runner: harness.runner,
    });
    verifier.start();

    const taskId = 'task-reviewer-ratelimit';
    await harness.createTask({
      id: taskId,
      title: 'Reviewer Rate Limit Task',
      description: 'Check rate-limited reviewer pause and retry without using allowance',
    });

    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'rl_test.txt',
        content: 'content',
      },
      { type: 'done' as const, result: 'done' },
    ];

    // Reviewer Run 1: hits a rate limit
    const reviewerScript1 = [
      { type: 'rate_limit' as const },
    ];

    // Reviewer Run 2: approves after rate limit clears
    const reviewerScript2 = [
      { type: 'review' as const, action: 'approve' as const },
    ];

    harness.fakeAdapter.setRunScripts([
      authorScript,
      reviewerScript1,
      reviewerScript2,
    ]);

    await harness.runTaskWithAgent(taskId, authorScript);

    // Wait for the tool to become rate-limited
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (harness.runner.getRateLimitStatus('codex').isPaused) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    // Check that tool is paused
    expect(harness.runner.getRateLimitStatus('codex').isPaused).toBe(true);

    // While paused, the Verifier must not start the Reviewer again (D7). Wait longer than its
    // one second poll, then check that only the rate-limited run exists.
    await new Promise((r) => setTimeout(r, 1500));
    const reviewRunsWhilePaused = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all()
      .filter((r) => r.kind === 'review');
    expect(reviewRunsWhilePaused).toHaveLength(1);
    expect(harness.runner.getLiveRuns()).toHaveLength(0);

    // Clear rate limit manually (simulating backoff timer expiring)
    await harness.runner.resumeRateLimitedTool('codex');

    // The Reviewer should re-run and approve, reaching merge-queue!
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');

    await harness.waitForLiveRuns(0);

    // Task retries should be 0 (rate limit did not charge a retry)
    expect(finalTask.retries).toBe(0);

    // Review runs in DB: 2 runs recorded (first was rate-limited, second was done)
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    const reviewRuns = runs.filter((r) => r.kind === 'review');
    expect(reviewRuns).toHaveLength(2);
    expect(reviewRuns[0].exitReason).toBe('rate-limited');
    expect(reviewRuns[1].exitReason).toBe('done');

    verifier.stop();
  });
});
