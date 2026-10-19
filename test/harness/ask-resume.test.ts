import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Ask and resume (PRD Milestone 2 Bullet 5)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('fake agent asks a question, run ends with asked, crew answer resumes with resumedFromRunId and same session ID', async () => {
    const taskId = 'task-ask-resume-1';
    await harness.createTask({
      id: taskId,
      title: 'Module System Migration',
      description: 'Decide module system and implement',
      assigneeAgentId: harness.agentId,
    });

    harness.fakeAdapter.refuseResume = false;
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Analyzing project imports' },
      { type: 'ask', message: 'Should we use ESM or CJS?' },
    ]);
    harness.fakeAdapter.setResumeScript([
      { type: 'update', message: 'Resumed turn after receiving answer' },
      { type: 'done', result: 'Completed migration using ESM' },
    ]);

    // 1. Initial run asks question and ends
    // Transition to doing first
    await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Agent spawned' });
    const runResult1 = await harness.runner.runTask(taskId);

    expect(runResult1.exitReason).toBe('asked');

    // Task is now blocked
    const taskAfterAsk = harness.getTask(taskId)!;
    expect(taskAfterAsk.status).toBe('blocked');

    // Verify question message recorded
    const messagesAfterAsk = harness.getMessages(taskId);
    expect(messagesAfterAsk.some((m) => m.type === 'question' && m.body === 'Should we use ESM or CJS?')).toBe(true);

    // Verify Run 1 in DB
    const runsAfterAsk = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(asc(schema.runs.startedAt))
      .all();
    expect(runsAfterAsk).toHaveLength(1);
    const run1 = runsAfterAsk[0];
    expect(run1.exitReason).toBe('asked');
    expect(run1.sessionId).toBeDefined();

    // 2. Answer via real crew CLI (human command, reads server.json)
    const cliResult = await harness.runCrew(['answer', taskId, 'Use ESM modules']);
    expect(cliResult.exitCode).toBe(0);

    // Wait for resumed run to complete
    await harness.waitForTaskStatus(taskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    // Verify task is now verifying
    const taskFinal = harness.getTask(taskId)!;
    expect(taskFinal.status).toBe('verifying');
    expect(taskFinal.retries).toBe(0); // No retry used

    // Verify answer message recorded
    const finalMessages = harness.getMessages(taskId);
    expect(finalMessages.some((m) => m.type === 'answer' && m.body === 'Use ESM modules')).toBe(true);

    // Verify Run 2 in DB has resumedFromRunId and same session ID
    const runsFinal = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(asc(schema.runs.startedAt))
      .all();
    expect(runsFinal).toHaveLength(2);

    const run2 = runsFinal[1];
    expect(run2.exitReason).toBe('done');
    expect(run2.resumedFromRunId).toBe(run1.id);
    expect(run2.sessionId).toBe(run1.sessionId);
  });

  it('runs fallback fresh run when adapter refuses to resume, with Q&A and git diff summary in prompt', async () => {
    const taskId = 'task-ask-refuse-1';
    await harness.createTask({
      id: taskId,
      title: 'Database Driver Selection',
      description: 'Choose driver and generate initial migration',
      acceptanceCriteria: 'Migration file exists',
      assigneeAgentId: harness.agentId,
    });

    // Make adapter refuse resume
    harness.fakeAdapter.refuseResume = true;
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Drafting schema' },
      { type: 'edit_file', filePath: 'draft_schema.sql', content: 'CREATE TABLE users (id INT);\n' },
      { type: 'ask', message: 'Should we add timestamps to users table?' },
    ]);

    // Initial run
    await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Agent spawned' });
    const runResult1 = await harness.runner.runTask(taskId);
    expect(runResult1.exitReason).toBe('asked');

    const taskBlocked = harness.getTask(taskId)!;
    expect(taskBlocked.status).toBe('blocked');

    // For the fallback fresh run, provide standard script
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Fallback fresh run started' },
      { type: 'done', result: 'Completed with timestamps' },
    ]);

    // Answer the question
    const cliResult = await harness.runCrew(['answer', taskId, 'Yes, add createdAt and updatedAt']);
    expect(cliResult.exitCode).toBe(0);

    // Wait for task to reach verifying
    await harness.waitForTaskStatus(taskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    const taskFinal = harness.getTask(taskId)!;
    expect(taskFinal.status).toBe('verifying');
    expect(taskFinal.retries).toBe(0); // Retry was NOT incremented on fallback

    // Verify runs in DB:
    // 1. Initial run (asked)
    // 2. Failed resume attempt (resume-failed)
    // 3. Fallback fresh run (done)
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(asc(schema.runs.startedAt))
      .all();

    expect(runs).toHaveLength(3);

    const [run1, run2, run3] = runs;
    expect(run1.exitReason).toBe('asked');

    expect(run2.exitReason).toBe('resume-failed');
    expect(run2.resumedFromRunId).toBe(run1.id);

    expect(run3.exitReason).toBe('done');
    expect(run3.resumedFromRunId).toBeNull();

    // Verify fallback prompt in run 3 contains task context, Q&A, and git diff
    expect(run3.prompt).toBeDefined();
    expect(run3.prompt).toContain('Task: Database Driver Selection');
    expect(run3.prompt).toContain('Questions and Answers:');
    expect(run3.prompt).toContain('Question: Should we add timestamps to users table?');
    expect(run3.prompt).toContain('Answer: Yes, add createdAt and updatedAt');
    expect(run3.prompt).toContain('draft_schema.sql');
  });
});
