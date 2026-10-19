import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Human CLI (PRD Milestone 2 Bullet 9)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('server.json discovery: discovers server and secret when env vars are omitted', async () => {
    // Verify server.json exists and has 0600 permissions (D25)
    const serverJsonPath = path.join(harness.crewHomeDir, 'server.json');
    expect(fs.existsSync(serverJsonPath)).toBe(true);

    const stat = fs.statSync(serverJsonPath);
    expect(stat.mode & 0o777).toBe(0o600);

    const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf-8'));
    expect(serverJson.url).toBe(harness.server.url);
    expect(serverJson.secret).toBe(harness.server.perStartSecret);

    // Call CLI without CREW_SERVER_URL and CREW_SECRET
    const res = await harness.runCrew(['status'], {
      CREW_SERVER_URL: '',
      CREW_SECRET: '',
    });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('=== Crew Status ===');
    expect(res.stdout).toContain('Dispatch: ACTIVE');
  });

  it('crew status: reports agents, dispatch status, live runs, and tasks', async () => {
    const res = await harness.runCrew(['status']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('=== Crew Status ===');
    expect(res.stdout).toContain('Dispatch: ACTIVE');
    expect(res.stdout).toContain('Fake Backend Agent');
    expect(res.stdout).toContain('Live Runs (0)');
  });

  it('crew tasks: lists workspace tasks with status and assignee', async () => {
    await harness.createTask({
      id: 'task-cli-1',
      title: 'First CLI Task',
      description: 'Test crew tasks command',
    });
    await harness.createTask({
      id: 'task-cli-2',
      title: 'Second CLI Task',
      description: 'Another task for crew tasks',
    });

    const res = await harness.runCrew(['tasks']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('task-cli-1');
    expect(res.stdout).toContain('task-cli-2');
    expect(res.stdout).toContain('ready');
    expect(res.stdout).toContain('Fake Backend Agent');
  });

  it('crew diff: prints git diff of the worktree against main', async () => {
    const taskId = 'task-cli-diff';
    await harness.createTask({
      id: taskId,
      title: 'Task for diff test',
      description: 'Verify crew diff',
    });

    // Transition to doing creates worktree
    const taskDoing = await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Start work' });
    expect(taskDoing.worktreePath).toBeDefined();

    // Create a modified file in the worktree
    fs.writeFileSync(path.join(taskDoing.worktreePath!, 'diff-test.txt'), 'console.log("diff test");\n', 'utf-8');

    const res = await harness.runCrew(['diff', taskId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('diff --git');
    expect(res.stdout).toContain('+console.log("diff test");');
  });

  it('crew logs: prints recorded agent logs for a task', async () => {
    const taskId = 'task-cli-logs';
    await harness.createTask({
      id: taskId,
      title: 'Task for logs test',
      description: 'Verify crew logs',
    });

    harness.fakeAdapter.setScript([
      { type: 'update', message: 'Step 1: Inspecting files' },
      { type: 'update', message: 'Step 2: Applied modification' },
      { type: 'done', result: 'Completed task with logs' },
    ]);

    await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Start work' });
    const runResult = await harness.runner.runTask(taskId);
    expect(runResult.exitReason).toBe('done');

    const res = await harness.runCrew(['logs', taskId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain('Step 1: Inspecting files');
    expect(res.stdout).toContain('Step 2: Applied modification');
  });

  it('crew cancel: cancels task and removes worktree', async () => {
    const taskId = 'task-cli-cancel';
    await harness.createTask({
      id: taskId,
      title: 'Task to cancel',
      description: 'Verify crew cancel',
    });

    const taskDoing = await harness.scheduler.transitionTask(taskId, 'doing', { reason: 'Start work' });
    expect(fs.existsSync(taskDoing.worktreePath!)).toBe(true);

    const res = await harness.runCrew(['cancel', taskId]);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain(`Task ${taskId} is now cancelled.`);

    const taskCancelled = harness.getTask(taskId)!;
    expect(taskCancelled.status).toBe('cancelled');
    expect(fs.existsSync(taskDoing.worktreePath!)).toBe(false);
  });

  it('crew worktree gc: garbage collects inactive worktrees', async () => {
    const res = await harness.runCrew(['worktree', 'gc']);
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/Cleaned up|No orphaned worktrees/);

    const badRes = await harness.runCrew(['worktree', 'invalid-subcommand']);
    expect(badRes.exitCode).toBe(1);
    expect(badRes.stderr).toContain('Unknown worktree subcommand');
  });
});
