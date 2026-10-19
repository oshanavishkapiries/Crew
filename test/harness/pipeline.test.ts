import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('In-process Pipeline Harness (PRD Milestone 1)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('drives a task from todo to verifying through real crew update and crew done CLI calls', async () => {
    const taskId = 'task-milestone1-1';

    // 1. Create task
    const initialTask = await harness.createTask({
      id: taskId,
      title: 'Build Authentication Module',
      description: 'Implement core token handling',
      acceptanceCriteria: 'Exports auth utility',
    });

    expect(initialTask.status).toBe('ready');

    // 2. Run fake agent that executes real crew update and crew done CLI calls
    const authFileName = 'auth.ts';

    const result = await harness.runTaskWithAgent(taskId, [
      {
        type: 'update',
        message: 'Initializing auth tokens',
      },
      {
        type: 'edit_file',
        filePath: authFileName,
        content: 'export const token = "auth-token-123";\n',
      },
      {
        type: 'update',
        message: 'Auth module implemented, ready for verification',
      },
      {
        type: 'done',
        result: 'Authentication module completed with exported token',
      },
    ]);

    expect(result.exitCode).toBe(0);

    // 3. Verify task reached 'verifying' state and has worktree/branch
    const taskAfter = harness.getTask(taskId);
    expect(taskAfter).toBeDefined();
    expect(taskAfter!.status).toBe('verifying');
    expect(taskAfter!.branch).toBe('crew/task-milestone1-1-build-authentication-module');
    expect(taskAfter!.worktreePath).toBeDefined();

    // 4. Verify progress and done messages were recorded in DB
    const messages = harness.getMessages(taskId);
    expect(messages.length).toBeGreaterThanOrEqual(3);

    const updateMessages = messages.filter((m) => m.type === 'comment');
    expect(updateMessages.some((m) => m.body.includes('Initializing auth tokens'))).toBe(true);
    expect(
      updateMessages.some((m) => m.body.includes('Auth module implemented, ready for verification')),
    ).toBe(true);

    const doneMessages = messages.filter((m) => m.type === 'result');
    expect(doneMessages).toHaveLength(1);
    expect(doneMessages[0].body).toContain('Authentication module completed');

    // 5. Verify file was created in task worktree, NOT in repo root
    const worktreeAuthFile = path.join(taskAfter!.worktreePath!, authFileName);
    const repoAuthFile = path.join(harness.repoDir, authFileName);
    expect(fs.existsSync(worktreeAuthFile)).toBe(true);
    expect(fs.readFileSync(worktreeAuthFile, 'utf-8')).toBe('export const token = "auth-token-123";\n');
    expect(fs.existsSync(repoAuthFile)).toBe(false);
  });
});
