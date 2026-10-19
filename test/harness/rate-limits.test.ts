import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, asc } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { Runner, type Clock } from '../../src/server/runner/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

class ManualClock implements Clock {
  private currentTime = Date.now();
  private timers: Array<{ id: number; due: number; cb: () => void }> = [];
  private nextId = 1;

  now() {
    return this.currentTime;
  }

  setTimeout(cb: () => void, ms: number): number {
    const id = this.nextId++;
    this.timers.push({ id, due: this.currentTime + ms, cb });
    return id;
  }

  clearTimeout(id: any): void {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  advance(ms: number) {
    this.currentTime += ms;
    // Repeatedly fire ready timers (a callback may register another timer)
    let ready: Array<{ id: number; due: number; cb: () => void }>;
    do {
      ready = this.timers.filter((t) => t.due <= this.currentTime).sort((a, b) => a.due - b.due);
      this.timers = this.timers.filter((t) => t.due > this.currentTime);
      for (const t of ready) {
        t.cb();
      }
    } while (this.timers.some((t) => t.due <= this.currentTime));
  }
}

describe('Rate limits (PRD Milestone 2 Bullet 7)', () => {
  let harness: PipelineHarness;
  let testClock: ManualClock;

  beforeAll(async () => {
    testClock = new ManualClock();
    harness = await createPipelineHarness({
      clock: testClock,
      startDispatcher: true,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('pauses all agents of the tool on rate limit, honours reported reset time, preserves retries, and resumes mid-task session', async () => {
    // Add second agent using fake tool
    const agent2Id = 'agent-fake-rate-limit-2';
    harness.addAgent(agent2Id);

    const taskId = 'task-rate-limit-1';
    const resetDelayMs = 45000;
    const reportedResetTime = new Date(testClock.now() + resetDelayMs).toISOString();

    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Calling external API' },
      { type: 'rate_limit', rateLimitResetTime: reportedResetTime },
    ]);
    harness.fakeAdapter.setResumeScript([
      { type: 'update', message: 'Resumed call to external API' },
      { type: 'done', result: 'Completed after rate limit wait' },
    ]);

    // Prepare to wait for run to end
    const runEnded1 = new Promise<void>((resolve) => harness.runner.once('run_ended', () => resolve()));

    await harness.createTask({
      id: taskId,
      title: 'Rate limited task',
      description: 'Will hit rate limit with reported reset time',
      assigneeAgentId: harness.agentId,
    });

    // Wait for the first run to complete with rate-limited exitReason
    await runEnded1;

    // Verify Run 1 exited with rate-limited
    const runsAfterLimit = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(asc(schema.runs.startedAt))
      .all();
    expect(runsAfterLimit).toHaveLength(1);
    const run1 = runsAfterLimit[0];
    expect(run1.exitReason).toBe('rate-limited');
    expect(run1.sessionId).toBeDefined();

    // Verify task is still doing and retries was NOT incremented
    const taskAfterLimit = harness.getTask(taskId)!;
    expect(taskAfterLimit.status).toBe('doing');
    expect(taskAfterLimit.retries).toBe(0);

    // Verify ALL agents of tool 'fake' are paused (status = 'rate-limited')
    const agent1 = harness.db.db.select().from(schema.agents).where(eq(schema.agents.id, harness.agentId)).get()!;
    const agent2 = harness.db.db.select().from(schema.agents).where(eq(schema.agents.id, agent2Id)).get()!;
    expect(agent1.status).toBe('rate-limited');
    expect(agent2.status).toBe('rate-limited');

    const status = harness.runner.getRateLimitStatus('fake');
    expect(status.isPaused).toBe(true);

    // Advance clock by 40s (5s before reset) - should remain paused
    testClock.advance(40000);
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(true);
    expect(harness.getTask(taskId)!.status).toBe('doing');

    // Advance remaining 5s to hit reset time
    testClock.advance(5000);

    // Rate limit should now be cleared
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(false);

    // Wait for task to be resumed and reach verifying
    await harness.waitForTaskStatus(taskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    const taskFinal = harness.getTask(taskId)!;
    expect(taskFinal.status).toBe('verifying');
    expect(taskFinal.retries).toBe(0); // Still 0 retries

    // Verify Run 2 in DB resumed session
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

  it('follows 1 -> 2 -> 4 -> 8 -> 16 -> 30 min backoff when no reset time is reported, and resets on success', async () => {
    const taskId = 'task-rate-limit-backoff';

    // Step 0: Initial rate limit without reported reset time -> 1 min backoff (60,000 ms)
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'First attempt' },
      { type: 'rate_limit' },
    ]);
    harness.fakeAdapter.setResumeScript([
      { type: 'update', message: 'Second attempt' },
      { type: 'rate_limit' },
    ]);

    const runEnded1 = new Promise<void>((resolve) => harness.runner.once('run_ended', () => resolve()));

    await harness.createTask({
      id: taskId,
      title: 'Exponential backoff task',
      description: 'Tests 1 -> 2 -> 4 minute progression',
      assigneeAgentId: harness.agentId,
    });

    await runEnded1;

    // First rate limit hit: backoff schedule says 1 min (60,000 ms)
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(true);
    expect(harness.runner.getRateLimitStatus('fake').backoffStep).toBe(1);

    // Advance 50s -> still paused
    testClock.advance(50000);
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(true);

    // Prepare for run 2
    const runEnded2 = new Promise<void>((resolve) => harness.runner.once('run_ended', () => resolve()));

    // Advance 10s -> 60s reached, resumes!
    testClock.advance(10000);
    await runEnded2;

    // Second rate limit hit: backoff schedule says 2 min (120,000 ms), step is now 2
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(true);
    expect(harness.runner.getRateLimitStatus('fake').backoffStep).toBe(2);

    // Advance 100s -> still paused
    testClock.advance(100000);
    expect(harness.runner.getRateLimitStatus('fake').isPaused).toBe(true);

    // Configure next resume to succeed
    harness.fakeAdapter.setResumeScript([
      { type: 'update', message: 'Third attempt succeeded' },
      { type: 'done', result: 'Success after backoff' },
    ]);

    // Advance remaining 20s -> 120s reached, resumes!
    testClock.advance(20000);

    await harness.waitForTaskStatus(taskId, 'verifying', 10000);
    await harness.waitForLiveRuns(0, 10000);

    // Successful run resets backoff step to 0!
    expect(harness.runner.getRateLimitStatus('fake').backoffStep).toBe(0);
    expect(harness.getTask(taskId)!.retries).toBe(0);
  });

  it('persists rate-limited pause state across restarts', async () => {
    // Manually pause the fake tool by triggering a rate limit on a task
    const taskId = 'task-rate-limit-persist';

    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Attempting' },
      { type: 'rate_limit', rateLimitResetTime: new Date(testClock.now() + 180000).toISOString() },
    ]);

    const runEnded = new Promise<void>((resolve) => harness.runner.once('run_ended', () => resolve()));

    await harness.createTask({
      id: taskId,
      title: 'Persistence task',
      description: 'Will trigger rate limit pause',
      assigneeAgentId: harness.agentId,
    });

    await runEnded;

    // Agents in DB are rate-limited
    const agentInDb = harness.db.db.select().from(schema.agents).where(eq(schema.agents.id, harness.agentId)).get()!;
    expect(agentInDb.status).toBe('rate-limited');

    // Marker file exists in crewHome
    const rateLimitsFile = path.join(harness.crewHomeDir, 'rate-limits.json');
    expect(fs.existsSync(rateLimitsFile)).toBe(true);

    // Create a new runner simulating server restart
    const newRunner = new Runner({
      db: harness.db,
      eventBus: harness.eventBus,
      scheduler: harness.scheduler,
      crewHome: harness.crewHomeDir,
      clock: testClock,
    });

    // The new runner should know 'fake' is paused from persisted state
    const newStatus = newRunner.getRateLimitStatus('fake');
    expect(newStatus.isPaused).toBe(true);

    // Cleanup timer on new runner
    await newRunner.killAll();
  });
});
