import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Reviewer selection skips agents that cannot review now (D8, D34)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({ startVerifier: true });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('never picks a stopped or rate-limited reviewer when an idle one exists, even if its tool differs from the author', async () => {
    const reviewerRoleId = harness.addRole('role-reviewer', 'reviewer');
    harness.addAgent('rev-codex-stopped', reviewerRoleId, 'codex');
    harness.addAgent('rev-gemini-limited', reviewerRoleId, 'gemini');
    harness.addAgent('rev-fake-idle', reviewerRoleId, 'fake');
    harness.db.db.update(schema.agents).set({ status: 'stopped' }).where(eq(schema.agents.id, 'rev-codex-stopped')).run();
    harness.db.db.update(schema.agents).set({ status: 'rate-limited' }).where(eq(schema.agents.id, 'rev-gemini-limited')).run();

    const taskId = 'task-review-selection';
    await harness.createTask({ id: taskId, title: 'Reviewer selection', description: 'Pick a usable reviewer' });

    const authorScript = [
      { type: 'edit_file' as const, filePath: 'selection.txt', content: 'content' },
      { type: 'done' as const, result: 'done' },
    ];
    const reviewerScript = [{ type: 'review' as const, action: 'approve' as const }];
    harness.fakeAdapter.setRunScripts([authorScript, reviewerScript]);

    await harness.runTaskWithAgent(taskId, authorScript);
    await harness.waitForTaskStatus(taskId, 'merge-queue');

    const reviewRun = harness.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .all()
      .find((r) => r.kind === 'review');
    expect(reviewRun?.agentId).toBe('rev-fake-idle');
  });
});
