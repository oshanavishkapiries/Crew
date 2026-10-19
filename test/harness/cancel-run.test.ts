import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Cancel and server.json lifecycle (milestone 2 review fixes)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({ startDispatcher: false });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('crew cancel kills the live run before removing the worktree, without using a retry', async () => {
    const taskId = 'task-cancel-live';
    await harness.createTask({
      id: taskId,
      title: 'Cancel me while running',
      description: 'Will be cancelled mid-run',
      assigneeAgentId: harness.agentId,
    });
    harness.fakeAdapter.setScript([
      { type: 'update', message: 'working' },
      { type: 'sleep', durationMs: 20000 },
      { type: 'done', result: 'never reached' },
    ]);
    harness.dispatcher.start();
    await harness.waitForLiveRuns(1, 5000);
    const worktreePath = harness.getTask(taskId)!.worktreePath!;
    expect(fs.existsSync(worktreePath)).toBe(true);

    const res = await harness.runCrew(['cancel', taskId]);
    expect(res.exitCode).toBe(0);

    expect(harness.runner.getLiveRuns()).toHaveLength(0);
    const task = harness.getTask(taskId)!;
    expect(task.status).toBe('cancelled');
    expect(task.retries).toBe(0);
    expect(fs.existsSync(worktreePath)).toBe(false);

    const runs = harness.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).all();
    expect(runs).toHaveLength(1);
    expect(runs[0].exitReason).toBe('cancelled');

    harness.dispatcher.stop();
  });
});

describe('server.json lifecycle (D25)', () => {
  it('is removed on close, and human commands refuse a stale one whose pid is dead', async () => {
    const harness = await createPipelineHarness({ startDispatcher: false });
    const serverJson = path.join(harness.crewHomeDir, 'server.json');
    expect(fs.existsSync(serverJson)).toBe(true);

    await harness.server.close();
    expect(fs.existsSync(serverJson)).toBe(false);

    fs.writeFileSync(serverJson, JSON.stringify({ url: 'http://127.0.0.1:1', secret: 'x', pid: 2 ** 22 + 12345 }), {
      mode: 0o600,
    });
    const res = await harness.runCrew(['status'], { CREW_SERVER_URL: '', CREW_SECRET: '' });
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('stale');

    await harness.cleanup();
  });
});
