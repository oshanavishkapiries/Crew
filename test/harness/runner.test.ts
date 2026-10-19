import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { SECRET_HEADER } from '../../src/server/api/security.js';

describe('Runner with fake adapter (PRD Milestone 2 Bullet 2)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('spawns agent in worktree, streams events to log file and SSE, and records Run with exitReason done', async () => {
    const taskId = 'task-runner-1';
    await harness.createTask({
      id: taskId,
      title: 'Runner Integration Task',
      description: 'Test runner execution and event logging',
    });

    // Subscribe to SSE stream for runs before starting
    const eventsReceived: Array<{ type: string; data: unknown }> = [];
    const unsubscribe = harness.eventBus.subscribeRunEvents('*', (event) => {
      eventsReceived.push(event);
    });

    const result = await harness.runTaskWithAgent(taskId, [
      {
        type: 'update',
        message: 'Step 1: Running under real runner',
      },
      {
        type: 'edit_file',
        filePath: 'runner_output.txt',
        content: 'runner generated content\n',
      },
      {
        type: 'update',
        message: 'Step 2: Edit complete',
      },
      {
        type: 'done',
        result: 'Runner task finished',
      },
    ]);

    unsubscribe();

    expect(result.exitCode).toBe(0);
    expect(result.exitReason).toBe('done');

    // 1. Verify task transitioned to verifying
    const task = harness.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('verifying');

    // 2. Verify file was created in task worktree, NOT repo root
    const worktreeFile = path.join(task!.worktreePath!, 'runner_output.txt');
    const repoFile = path.join(harness.repoDir, 'runner_output.txt');
    expect(fs.existsSync(worktreeFile)).toBe(true);
    expect(fs.readFileSync(worktreeFile, 'utf-8')).toBe('runner generated content\n');
    expect(fs.existsSync(repoFile)).toBe(false);

    // 3. Verify Run row in DB
    const runs = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all();

    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.exitCode).toBe(0);
    expect(run.exitReason).toBe('done');
    expect(run.startedAt).toBeDefined();
    expect(run.endedAt).toBeDefined();
    expect(run.logPath).toBeDefined();
    expect(run.prompt).toContain('Runner Integration Task');

    // 4. Verify log file exists and contains raw JSON lines
    expect(fs.existsSync(run.logPath!)).toBe(true);
    const logContent = fs.readFileSync(run.logPath!, 'utf-8');
    const logLines = logContent.trim().split('\n');
    const jsonLines = logLines.filter((l) => l.trim().startsWith('{') && l.trim().endsWith('}'));
    expect(jsonLines.length).toBeGreaterThanOrEqual(4);

    const parsedLogEvents = jsonLines.map((l) => JSON.parse(l.trim()));
    expect(parsedLogEvents.some((e) => e.type === 'start')).toBe(true);
    expect(parsedLogEvents.some((e) => e.type === 'tool_call' && e.data?.message?.includes('Step 1'))).toBe(true);
    expect(parsedLogEvents.some((e) => e.type === 'file_edit')).toBe(true);
    expect(parsedLogEvents.some((e) => e.type === 'completion')).toBe(true);

    // 5. Verify run SSE events were published to the event bus
    const runEventsForThisRun = eventsReceived.filter(
      (e) => (e as any).runId === run.id || (e.data as any)?.runId === run.id,
    );
    // At least run_ended event is published
    expect(eventsReceived.length).toBeGreaterThanOrEqual(1);

    // 6. Verify SSE endpoint /api/runs/:id/stream is reachable and sends connected event
    const sseRes = await fetch(`${harness.server.url}/api/runs/${run.id}/stream`, {
      headers: {
        [SECRET_HEADER]: harness.server.perStartSecret,
      },
    });
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('content-type')).toContain('text/event-stream');
    // Read the first chunk
    const reader = sseRes.body?.getReader();
    if (reader) {
      const chunk = await reader.read();
      const text = new TextDecoder().decode(chunk.value);
      expect(text).toContain('connected');
      await reader.cancel();
    }
  });
});
