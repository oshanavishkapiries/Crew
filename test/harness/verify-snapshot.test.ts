import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Main-checkout snapshot survives until the diff gate decides (D31)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    // The Verifier is started later, to look like a server that restarted after `crew done`
    harness = await createPipelineHarness({ startVerifier: false, startDispatcher: false });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('keeps the snapshot on disk after the run, still catches the escape when verification starts late, then removes it', async () => {
    const taskId = 'task-snapshot-disk';
    await harness.createTask({ id: taskId, title: 'Snapshot on disk', description: 'Escape then restart' });

    await harness.runTaskWithAgent(taskId, [
      { type: 'edit_file', filePath: path.join(harness.repoDir, 'escaped.txt'), content: 'escape!\n' },
      { type: 'edit_file', filePath: 'inside.txt', content: 'inside\n' },
      { type: 'done', result: 'done' },
    ]);

    const run = harness.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).get()!;
    const snapshotFile = path.join(harness.crewHomeDir, 'snapshots', `${run.id}.txt`);
    expect(harness.getTask(taskId)!.status).toBe('verifying');
    expect(fs.existsSync(snapshotFile)).toBe(true);

    harness.verifier.start();
    await harness.waitForTaskStatus(taskId, 'doing', 10000);

    const diffVr = harness.getVerificationResults(taskId).find((r) => r.step === 'diff')!;
    expect(diffVr.passed).toBe(false);
    expect(diffVr.output).toContain('Out-of-worktree changes detected in main checkout');
    expect(fs.existsSync(snapshotFile)).toBe(false);
  });

  it('removes the snapshot of a work run that did not finish with crew done', async () => {
    const taskId = 'task-snapshot-no-done';
    await harness.createTask({ id: taskId, title: 'No done', description: 'Agent exits early' });

    await harness.runTaskWithAgent(taskId, [{ type: 'update', message: 'bye' }, { type: 'exit', exitCode: 1 }]);

    const run = harness.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).get()!;
    expect(fs.existsSync(path.join(harness.crewHomeDir, 'snapshots', `${run.id}.txt`))).toBe(false);
  });
});
