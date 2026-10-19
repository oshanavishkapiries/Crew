import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { eq } from 'drizzle-orm';

describe('Reviewer gate (milestone 3 bullet 4, D8, D13, D34, D35)', () => {
  let harness: PipelineHarness;

  beforeEach(async () => {
    harness = await createPipelineHarness({ startVerifier: true });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  it('runs reviewer on passing gates, approves via crew review approve, and moves to merge-queue', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-reviewer-1';
    harness.addAgent(reviewerAgentId, reviewerRoleId);

    const taskId = 'task-review-approve';
    await harness.createTask({
      id: taskId,
      title: 'Review Approve Task',
      description: 'Implement secure login feature',
      acceptanceCriteria: 'Login endpoint with bcrypt password hashing',
    });

    // Author script: writes code and calls done
    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'auth.ts',
        content: 'export function hashPassword(p: string) { return "hashed-" + p; }',
      },
      { type: 'done' as const, result: 'Implemented password hashing' },
    ];

    // Reviewer script: calls crew review approve
    const reviewerScript = [
      { type: 'review' as const, action: 'approve' as const },
    ];

    harness.fakeAdapter.setRunScripts([authorScript, reviewerScript]);

    await harness.runTaskWithAgent(taskId, authorScript);

    // Wait for task to reach merge-queue
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');
    expect(finalTask.reviewerAgentId).toBeNull();

    await harness.waitForLiveRuns(0);

    // Reviewer agent status should be idle
    const reviewerRow = harness.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, reviewerAgentId))
      .get();
    expect(reviewerRow?.status).toBe('idle');

    // Verification results should include passed review step
    const vrResults = harness.getVerificationResults(taskId);
    const reviewResult = vrResults.find((vr) => vr.step === 'review');
    expect(reviewResult).toBeDefined();
    expect(reviewResult?.passed).toBe(true);
    expect(reviewResult?.output).toBe('Approved');

    // Review run should have kind='review' and exitReason='done'
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    const reviewRun = runs.find((r) => r.kind === 'review');
    expect(reviewRun).toBeDefined();
    expect(reviewRun?.agentId).toBe(reviewerAgentId);
    expect(reviewRun?.exitReason).toBe('done');
    expect(reviewRun?.prompt).toContain('Review Approve Task');
    expect(reviewRun?.prompt).toContain('Login endpoint with bcrypt password hashing');
    expect(reviewRun?.prompt).toContain('Git diff against main:');
    expect(reviewRun?.prompt).toContain('auth.ts');
  });

  it('handles changes requested: moves review -> doing with retries incremented and feedback in next prompt', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-reviewer-changes';
    harness.addAgent(reviewerAgentId, reviewerRoleId);

    const taskId = 'task-review-changes';
    await harness.createTask({
      id: taskId,
      title: 'Review Changes Task',
      description: 'Implement user endpoint',
      acceptanceCriteria: 'Input validation for username',
    });

    // Run 1: Author submits without validation
    const authorScript1 = [
      {
        type: 'edit_file' as const,
        filePath: 'user.ts',
        content: 'export function getUser() { return {}; }',
      },
      { type: 'done' as const, result: 'Added getUser' },
    ];

    // Run 2: Reviewer requests changes
    const reviewerScript = [
      {
        type: 'review' as const,
        action: 'changes' as const,
        feedback: 'Please add username input validation before proceeding',
      },
    ];

    // Run 3: Author addresses feedback and calls done
    const authorScript2 = [
      {
        type: 'edit_file' as const,
        filePath: 'user.ts',
        content: 'export function getUser(u: string) { if (!u) throw new Error("bad user"); return { u }; }',
      },
      { type: 'done' as const, result: 'Added validation' },
    ];

    // Run 4: Reviewer approves
    const reviewerScript2 = [
      { type: 'review' as const, action: 'approve' as const },
    ];

    harness.fakeAdapter.setRunScripts([
      authorScript1,
      reviewerScript,
      authorScript2,
      reviewerScript2,
    ]);

    await harness.runTaskWithAgent(taskId, authorScript1);

    // Wait for task to return to 'doing' after review changes
    const taskAfterReview = await harness.waitForTaskStatus(taskId, 'doing');
    expect(taskAfterReview.status).toBe('doing');
    expect(taskAfterReview.retries).toBe(1);
    expect(taskAfterReview.reviewerAgentId).toBeNull();

    // Verify feedback message exists
    const msgs = harness.getMessages(taskId);
    const feedbackMsg = msgs.find((m) => m.type === 'feedback');
    expect(feedbackMsg).toBeDefined();
    expect(feedbackMsg?.body).toBe('Please add username input validation before proceeding');

    // Run author's second attempt
    await harness.runTaskWithAgent(taskId, authorScript2);

    // Verify task reached merge-queue
    const finalTask = await harness.waitForTaskStatus(taskId, 'merge-queue');
    expect(finalTask.status).toBe('merge-queue');

    // Verify prompt of second author run contained the reviewer's feedback
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    const workRuns = runs.filter((r) => r.kind === 'work');
    expect(workRuns).toHaveLength(2);
    expect(workRuns[1].prompt).toContain('Please add username input validation before proceeding');
  });

  it('prefers a reviewer with different cliType than the author (PRD Decision D8)', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');

    // Author agent has cliType: 'fake'
    // Reviewer 1 has cliType: 'fake' (same as author)
    harness.addAgent('rev-same-tool', reviewerRoleId, 'fake');
    // Reviewer 2 has cliType: 'codex' (different from author)
    harness.addAgent('rev-diff-tool', reviewerRoleId, 'codex');

    const taskId = 'task-review-diff-tool';
    await harness.createTask({
      id: taskId,
      title: 'Different Tool Preference Task',
      description: 'Check reviewer selection logic',
    });

    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'diff_tool.txt',
        content: 'content',
      },
      { type: 'done' as const, result: 'done' },
    ];
    const reviewerScript = [
      { type: 'review' as const, action: 'approve' as const },
    ];

    harness.fakeAdapter.setRunScripts([authorScript, reviewerScript]);

    await harness.runTaskWithAgent(taskId, authorScript);

    await harness.waitForTaskStatus(taskId, 'merge-queue');

    // Check which reviewer was selected
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    const reviewRun = runs.find((r) => r.kind === 'review');
    expect(reviewRun).toBeDefined();
    expect(reviewRun?.agentId).toBe('rev-diff-tool');
  });

  it('re-runs a crashed Reviewer up to 2 times, then escalates without charging author a retry (PRD Decision D35)', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-reviewer-crasher';
    harness.addAgent(reviewerAgentId, reviewerRoleId);

    const taskId = 'task-reviewer-crash';
    await harness.createTask({
      id: taskId,
      title: 'Reviewer Crash Task',
      description: 'Test crash recovery for reviewer',
    });

    // Author script
    const authorScript = [
      {
        type: 'edit_file' as const,
        filePath: 'crash_test.txt',
        content: 'valid changes',
      },
      { type: 'done' as const, result: 'done' },
    ];

    // Reviewer attempt 1: crashes without verdict
    const reviewerCrash1 = [
      { type: 'exit' as const, exitCode: 1 },
    ];

    // Reviewer attempt 2: crashes without verdict
    const reviewerCrash2 = [
      { type: 'exit' as const, exitCode: 1 },
    ];

    harness.fakeAdapter.setRunScripts([
      authorScript,
      reviewerCrash1,
      reviewerCrash2,
    ]);

    await harness.runTaskWithAgent(taskId, authorScript);

    // Task must be escalated after 2 reviewer crashes
    const finalTask = await harness.waitForTaskStatus(taskId, 'escalated');
    expect(finalTask.status).toBe('escalated');
    // Author pays no retry!
    expect(finalTask.retries).toBe(0);
    expect(finalTask.reviewerAgentId).toBeNull();

    // Reviewer agent status should be idle
    const reviewerRow = harness.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.id, reviewerAgentId))
      .get();
    expect(reviewerRow?.status).toBe('idle');

    // Exactly 2 review runs should be recorded
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    const reviewRuns = runs.filter((r) => r.kind === 'review');
    expect(reviewRuns).toHaveLength(2);
    expect(reviewRuns[0].exitReason).toBe('exited');
    expect(reviewRuns[1].exitReason).toBe('exited');
  });

  it('enforces reviewer auth rules: rejects author on review endpoint and rejects reviewer on author endpoints (D13, D34)', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    const reviewerAgentId = 'agent-reviewer-auth';
    const reviewerToken = harness.addAgent(reviewerAgentId, reviewerRoleId);

    const taskId = 'task-auth-check';
    await harness.createTask({
      id: taskId,
      title: 'Auth Check Task',
      description: 'Verify security boundaries',
    });

    // Stop verifier to test auth rules independently of automatic verification pipeline
    harness.verifier.stop();

    // Author transitions to doing
    await harness.scheduler.transitionTask(taskId, 'doing');

    // 1. Reviewer tries to call author endpoints (report, done, question) -> 403
    const reportRes = await harness.runCrew(['update', 'malicious report'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: reviewerToken,
    });
    expect(reportRes.exitCode).not.toBe(0);
    expect(reportRes.stderr).toContain('403');

    const doneRes = await harness.runCrew(['done', '--result', 'malicious done'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: reviewerToken,
    });
    expect(doneRes.exitCode).not.toBe(0);
    expect(doneRes.stderr).toContain('403');

    const askRes = await harness.runCrew(['ask', 'malicious question?'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: reviewerToken,
    });
    expect(askRes.exitCode).not.toBe(0);
    expect(askRes.stderr).toContain('403');

    // Move task to review and set reviewerAgentId
    await harness.scheduler.transitionTask(taskId, 'verifying');
    await harness.scheduler.transitionTask(taskId, 'review');
    harness.db.db
      .update(schema.tasks)
      .set({ reviewerAgentId })
      .where(eq(schema.tasks.id, taskId))
      .run();

    // 2. Author tries to call review endpoint -> 403
    const authorReviewRes = await harness.runCrew(['review', 'approve'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: harness.agentToken,
    });
    expect(authorReviewRes.exitCode).not.toBe(0);
    expect(authorReviewRes.stderr).toContain('403');

    // 3. Unauthenticated / invalid token calls review endpoint -> 401
    const invalidTokenRes = await harness.runCrew(['review', 'approve'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: 'crew_agent_bad_token',
    });
    expect(invalidTokenRes.exitCode).not.toBe(0);
    expect(invalidTokenRes.stderr).toContain('401');

    // 4. Designated reviewer calls review endpoint -> 200 / success
    const reviewerApproveRes = await harness.runCrew(['review', 'approve'], {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: reviewerToken,
    });
    expect(reviewerApproveRes.exitCode).toBe(0);
    expect(reviewerApproveRes.stdout).toContain('Review approved');

    const updatedTask = harness.getTask(taskId);
    expect(updatedTask?.status).toBe('merge-queue');
  });
});
