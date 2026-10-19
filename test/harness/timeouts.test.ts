import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import type { Clock } from '../../src/server/runner/index.js';
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
    // Sort by due time and trigger ready timers
    const ready = this.timers.filter((t) => t.due <= this.currentTime).sort((a, b) => a.due - b.due);
    this.timers = this.timers.filter((t) => t.due > this.currentTime);
    for (const t of ready) {
      t.cb();
    }
  }
}

describe('Timeouts and kill (PRD Milestone 2 Bullet 3)', () => {
  let harness: PipelineHarness;
  let testClock: ManualClock;

  beforeAll(async () => {
    testClock = new ManualClock();
    harness = await createPipelineHarness({
      maxRetries: 2,
      maxRuntimeMs: 30000,
      noOutputTimeoutMs: 5000,
      clock: testClock,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('kills process group and grandchild on no-output timeout, and uses up a retry', async () => {
    const taskId = 'task-timeout-nooutput';
    await harness.createTask({
      id: taskId,
      title: 'Hanging Task',
      description: 'Will hang without output',
    });

    let grandchildPid: number | null = null;
    const unsub = harness.eventBus.subscribeRunEvents('*', (event) => {
      if (event.type === 'tool_call' && (event.data as any)?.grandchildPid) {
        grandchildPid = Number((event.data as any).grandchildPid);
      }
    });

    // Start task in background
    const runPromise = harness.runTaskWithAgent(taskId, [
      {
        type: 'hang',
      },
    ]);

    // Wait until hang step is reached and grandchild is spawned
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (grandchildPid !== null) {
          clearInterval(check);
          resolve();
        }
      }, 50);
    });

    expect(grandchildPid).toBeGreaterThan(0);

    // Verify grandchild is currently alive
    let grandchildAliveBefore = true;
    try {
      process.kill(grandchildPid!, 0);
    } catch {
      grandchildAliveBefore = false;
    }
    expect(grandchildAliveBefore).toBe(true);

    // Advance clock past no-output timeout (5000ms)
    testClock.advance(5500);

    // Advance clock for SIGKILL grace period if needed
    testClock.advance(5500);

    const result = await runPromise;
    unsub();

    expect(result.exitReason).toBe('no-output');

    // 1. Verify task retry was incremented and stays doing
    const taskAfter = harness.getTask(taskId)!;
    expect(taskAfter.retries).toBe(1);
    expect(taskAfter.status).toBe('doing');

    // 2. Verify Run row in DB recorded exitReason as no-output
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();
    expect(runs).toHaveLength(1);
    expect(runs[0].exitReason).toBe('no-output');

    // 3. Verify grandchild process is dead
    let grandchildAliveAfter = true;
    try {
      process.kill(grandchildPid!, 0);
    } catch {
      grandchildAliveAfter = false;
    }
    expect(grandchildAliveAfter).toBe(false);
  });

  it('escalates task when retries exceed maxRetries on repeated timeouts', async () => {
    const taskId = 'task-timeout-escalate';
    await harness.createTask({
      id: taskId,
      title: 'Escalating Task',
      description: 'Will exceed max retries',
    });

    // Attempt 1: fails and retries (retries becomes 1)
    const run1 = harness.runTaskWithAgent(taskId, [{ type: 'hang' }]);
    // Wait briefly for process to start
    await new Promise((r) => setTimeout(r, 200));
    testClock.advance(5500);
    testClock.advance(5500);
    await run1;

    let task = harness.getTask(taskId)!;
    expect(task.retries).toBe(1);
    expect(task.status).toBe('doing');

    // Attempt 2: fails and retries (retries becomes 2, maxRetries is 2)
    const run2 = harness.runTaskWithAgent(taskId, [{ type: 'hang' }]);
    await new Promise((r) => setTimeout(r, 200));
    testClock.advance(5500);
    testClock.advance(5500);
    await run2;

    task = harness.getTask(taskId)!;
    expect(task.retries).toBe(2);
    expect(task.status).toBe('doing');

    // Attempt 3: fails -> retries becomes 3 > 2 -> task escalates
    const run3 = harness.runTaskWithAgent(taskId, [{ type: 'hang' }]);
    await new Promise((r) => setTimeout(r, 200));
    testClock.advance(5500);
    testClock.advance(5500);
    await run3;

    task = harness.getTask(taskId)!;
    expect(task.retries).toBe(3);
    expect(task.status).toBe('escalated');
  });
});
