import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import type { PermissionProfile } from '../../src/adapters/types.js';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { waitForMerge } from './merge-helpers.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
const git = async (...args: string[]) => (await execa('git', args, { cwd: h.repoDir })).stdout;
async function pair(depth = 0) {
  await h.createTask({ id: 'a', title: 'First change', description: 'A' });
  await h.createTask({ id: 'b', title: 'Second change', description: 'B' });
  h.db.db.update(schema.tasks).set({ depth }).where(eq(schema.tasks.id, 'b')).run();
  await h.createTask({ id: 'dependent', title: 'After B', description: 'Wait', blockedByIds: ['b'] });
  await h.scheduler.transitionTask('a', 'doing');
  await h.scheduler.transitionTask('b', 'doing');
  for (const id of ['a', 'b']) {
    await h.runTaskWithAgent(id, [{ type: 'edit_file', filePath: 'README.md', content: `${id}\n` }, { type: 'done', result: id }]);
    await h.waitForTaskStatus(id, 'merge-queue');
  }
}
async function conflict() {
  const waiting = waitForMerge(h, 'b', i => i.status === 'conflict' && !!i.conflictTaskId);
  h.server.mergeQueue.start();
  return await waiting;
}

it('hands the same branch to a new worktree, resolves with an agent and merges both parent and child', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  const profiles: Array<{ taskId?: string; permissions: PermissionProfile }> = [];
  const spawn = h.fakeAdapter.buildSpawn.bind(h.fakeAdapter);
  h.fakeAdapter.buildSpawn = opts => { profiles.push({ taskId: opts.taskId, permissions: structuredClone(opts.permissions) }); return spawn(opts); };
  await pair();
  const original = h.getTask('b')!;
  const item = await conflict();
  const child = h.getTask(item.conflictTaskId!)!;
  expect(child).toMatchObject({ parentTaskId: 'b', depth: 1, roleId: original.roleId, branch: original.branch });
  expect(child.description).toContain('README.md');
  expect(child.description).toContain('main');
  const queue = await h.runCrew(['queue']);
  expect(queue.exitCode).toBe(0);
  expect(queue.stdout).toContain(`[conflict]`);
  expect(queue.stdout).toContain(`Conflict sub-task: ${child.id}`);
  expect(fs.existsSync(original.worktreePath!)).toBe(false);
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(original.worktreePath!);
  expect(await git('branch', '--list', original.branch!)).not.toBe('');
  await git('config', 'core.editor', 'false');
  const done = waitForMerge(h, child.id, i => i.status === 'merged');
  await h.runTaskWithAgent(child.id, [
    { type: 'git', args: ['rebase', 'main'], allowFailure: true },
    { type: 'edit_file', filePath: 'README.md', content: 'a and b\n' },
    { type: 'git', args: ['add', 'README.md'] },
    { type: 'git', args: ['rebase', '--continue'] },
    { type: 'done', result: 'Resolved both changes' },
  ]);
  await done;
  await h.waitForTaskStatus('b', 'merged');
  expect(profiles.find(p => p.taskId === child.id)?.permissions.conflictResolution).toBe(true);
  expect(profiles.filter(p => p.taskId !== child.id).every(p => !p.permissions.conflictResolution)).toBe(true);
  expect(h.getTask('dependent')?.status).toBe('ready');
  expect(fs.readFileSync(path.join(h.repoDir, 'README.md'), 'utf8')).toBe('a and b\n');
  expect(h.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, child.id)).get()).toMatchObject({ exitReason: 'done' });
  expect(h.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, 'b')).get()).toMatchObject({ status: 'merged', conflictTaskId: child.id });
  expect(await git('branch', '--list', child.branch!)).toBe('');
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(h.getTask(child.id)!.worktreePath!);
});

it('escalates a conflict past maxDepth without creating a sub-task', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await pair(3);
  const escalated = h.waitForTaskStatus('b', 'escalated');
  h.server.mergeQueue.start();
  await escalated;
  expect(h.db.db.select().from(schema.tasks).all().filter(t => t.parentTaskId === 'b')).toHaveLength(0);
  expect(h.getMessages('b').some(m => m.body.includes('depth'))).toBe(true);
});

it.each(['escalated', 'cancelled'] as const)('escalates the parent when its conflict sub-task is %s', async state => {
  h = await createPipelineHarness({ startVerifier: true });
  await pair();
  const item = await conflict();
  const escalated = h.waitForTaskStatus('b', 'escalated');
  if (state === 'escalated') {
    await h.scheduler.transitionTask(item.conflictTaskId!, 'doing');
    await h.scheduler.transitionTask(item.conflictTaskId!, 'escalated');
  } else {
    expect((await h.runCrew(['cancel', item.conflictTaskId!])).exitCode).toBe(0);
  }
  await escalated;
  expect(h.getTask('dependent')?.status).toBe('todo');
});

it('rejects an empty diff after the agent drops all conflicted changes', async () => {
  h = await createPipelineHarness({ startVerifier: true, maxRetries: 0 });
  await pair();
  const item = await conflict();
  await h.runTaskWithAgent(item.conflictTaskId!, [
    { type: 'git', args: ['rebase', 'main'], allowFailure: true },
    { type: 'git', args: ['rebase', '--skip'] },
    { type: 'done', result: 'No change remains' },
  ]);
  await h.waitForTaskStatus('b', 'escalated');
  expect(h.getVerificationResults(item.conflictTaskId!).find(r => r.step === 'diff')).toMatchObject({ passed: false, output: 'no changes against main' });
});

it.each(['parent', 'child'] as const)('cancels a conflict %s while its child is running, kills the child and preserves the shared branch', async target => {
  h = await createPipelineHarness({ startVerifier: true });
  await pair();
  const item = await conflict();
  const childId = item.conflictTaskId!;
  h.fakeAdapter.setScript([{ type: 'sleep', durationMs: 60000 }]);
  h.dispatcher.start();
  await h.waitForLiveRuns(1);
  const child = h.getTask(childId)!;
  const pid = h.runner.getLiveRuns()[0].pid!;
  expect((await h.runCrew(['cancel', target === 'parent' ? 'b' : childId])).exitCode).toBe(0);
  if (target === 'child') await h.waitForTaskStatus('b', 'escalated');
  expect(() => process.kill(pid, 0)).toThrow();
  expect(h.getTask('b')?.status).toBe(target === 'parent' ? 'cancelled' : 'escalated');
  expect(h.getTask(childId)?.status).toBe('cancelled');
  expect(h.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, childId)).get()).toBeUndefined();
  const parentItem = h.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, 'b')).get();
  if (target === 'parent') expect(parentItem).toBeUndefined();
  else expect(parentItem?.status).toBe('failed');
  expect(await git('branch', '--list', child.branch!)).toContain(child.branch);
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(child.worktreePath!);
  expect(h.getTask('dependent')?.status).toBe('todo');
  await h.dispatcher.dispatchOnce();
  expect(h.runner.getLiveRuns()).toHaveLength(0);
});

it('human retry of an escalated conflict parent transfers its terminal child worktree without losing uncommitted work', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await pair();
  const item = await conflict();
  await h.scheduler.transitionTask(item.conflictTaskId!, 'doing');
  const child = h.getTask(item.conflictTaskId!)!;
  const bytes = Buffer.from('agent resolution in progress\r\n');
  fs.writeFileSync(path.join(child.worktreePath!, 'README.md'), bytes);
  await h.scheduler.transitionTask(child.id, 'escalated');
  await h.waitForTaskStatus('b', 'escalated');
  const retry = await h.runCrew(['retry', 'b', '--note', 'Continue the saved conflict work']);
  expect(retry.exitCode, retry.stderr).toBe(0);
  const parent = h.getTask('b')!;
  expect(parent.status).toBe('doing');
  expect(parent.branch).toBe(child.branch);
  expect(fs.readFileSync(path.join(parent.worktreePath!, 'README.md'))).toEqual(bytes);
  expect(fs.existsSync(child.worktreePath!)).toBe(false);
  expect(h.getTask(child.id)?.worktreePath).toBeNull();
  expect(await git('worktree', 'list', '--porcelain')).toContain(parent.worktreePath!);
});
