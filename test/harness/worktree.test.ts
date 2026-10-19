import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { SECRET_HEADER } from '../../src/server/api/security.js';

describe('Worktree on dispatch (PRD Milestone 2 Bullet 1)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('creates worktree and branch on ready -> doing, and edits land in worktree not repo root', async () => {
    const taskId = 'task-wt-1';
    const title = 'Feature: Add Special & Cool Things!! 1234567890 1234567890 1234567890';
    await harness.createTask({
      id: taskId,
      title,
      description: 'Test worktree creation',
    });

    const editFileName = 'feature.txt';
    const content = 'feature content in worktree\n';

    const result = await harness.runTaskWithAgent(taskId, [
      {
        type: 'edit_file',
        filePath: editFileName,
        content,
      },
      {
        type: 'done',
        result: 'feature done',
      },
    ]);

    expect(result.exitCode).toBe(0);

    const task = harness.getTask(taskId);
    expect(task).toBeDefined();
    expect(task!.status).toBe('verifying');

    // Slug should be lowercase, alphanumerics only, truncated to max 40 chars
    expect(task!.branch).toMatch(/^crew\/task-wt-1-[a-z0-9-]+$/);
    expect(task!.branch!.length).toBeLessThanOrEqual('crew/task-wt-1-'.length + 40);

    // Worktree exists on disk
    expect(task!.worktreePath).toBeDefined();
    expect(fs.existsSync(task!.worktreePath!)).toBe(true);

    // Edit exists in worktree, NOT in repoDir
    expect(fs.existsSync(path.join(task!.worktreePath!, editFileName))).toBe(true);
    expect(fs.readFileSync(path.join(task!.worktreePath!, editFileName), 'utf-8')).toBe(content);
    expect(fs.existsSync(path.join(harness.repoDir, editFileName))).toBe(false);

    // Branch exists in git repo
    const gitBranchCheck = await execa('git', ['rev-parse', '--verify', task!.branch!], {
      cwd: harness.repoDir,
    });
    expect(gitBranchCheck.exitCode).toBe(0);
  });

  it('reuses existing worktree on re-dispatch/retry without losing changes', async () => {
    const taskId = 'task-wt-reuse';
    await harness.createTask({
      id: taskId,
      title: 'Task Reuse Worktree',
      description: 'Test reuse worktree on retry',
    });

    // Run first time
    await harness.runTaskWithAgent(taskId, [
      {
        type: 'edit_file',
        filePath: 'step1.txt',
        content: 'step 1 content\n',
      },
      {
        type: 'done',
        result: 'done first attempt',
      },
    ]);

    const taskFirst = harness.getTask(taskId)!;
    const wtPath = taskFirst.worktreePath!;

    // Verification failed -> scheduler transitions back to doing (retry)
    await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Gate failed, retry' });

    const taskSecond = harness.getTask(taskId)!;
    expect(taskSecond.worktreePath).toBe(wtPath);

    // The previously edited file is still in the worktree
    expect(fs.existsSync(path.join(wtPath, 'step1.txt'))).toBe(true);
    expect(fs.readFileSync(path.join(wtPath, 'step1.txt'), 'utf-8')).toBe('step 1 content\n');
  });

  it('cancel removes the worktree but preserves the branch', async () => {
    const taskId = 'task-wt-cancel';
    await harness.createTask({
      id: taskId,
      title: 'Task To Cancel',
      description: 'Will be cancelled',
    });

    // Start running so worktree is created
    await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Started' });
    const taskBefore = harness.getTask(taskId)!;
    const worktreePath = taskBefore.worktreePath!;
    const branch = taskBefore.branch!;

    expect(fs.existsSync(worktreePath)).toBe(true);

    // Cancel via API
    const res = await fetch(`${harness.server.url}/api/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: {
        [SECRET_HEADER]: harness.server.perStartSecret,
      },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; status: string };
    expect(data.status).toBe('cancelled');

    // Worktree directory is removed from disk
    expect(fs.existsSync(worktreePath)).toBe(false);

    // Branch is STILL preserved in git
    const branchCheck = await execa('git', ['rev-parse', '--verify', branch], {
      cwd: harness.repoDir,
    });
    expect(branchCheck.exitCode).toBe(0);
  });

  it('worktree gc removes worktrees for terminal or missing tasks', async () => {
    // Create an orphan worktree directory for a non-existent task
    const orphanTaskId = 'task-wt-orphan';
    const orphanWorktreeDir = path.join(harness.crewHomeDir, 'worktrees', harness.workspaceId, orphanTaskId);
    fs.mkdirSync(orphanWorktreeDir, { recursive: true });
    fs.writeFileSync(path.join(orphanWorktreeDir, 'orphan.txt'), 'orphan', 'utf-8');

    expect(fs.existsSync(orphanWorktreeDir)).toBe(true);

    // Run gc via API
    const res = await fetch(`${harness.server.url}/api/worktrees/gc`, {
      method: 'POST',
      headers: {
        [SECRET_HEADER]: harness.server.perStartSecret,
      },
    });

    expect(res.status).toBe(200);
    const data = (await res.json()) as { success: boolean; removed: Array<{ taskId: string }> };
    expect(data.success).toBe(true);
    expect(data.removed.some((r) => r.taskId === orphanTaskId)).toBe(true);

    // Orphan directory should now be removed
    expect(fs.existsSync(orphanWorktreeDir)).toBe(false);
  });
});
