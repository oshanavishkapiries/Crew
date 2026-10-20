import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { MergeQueue } from '../../src/server/merge/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { readyToMerge, waitForMerge } from './merge-helpers.js';
let h: PipelineHarness;
let replacement: MergeQueue | undefined;
afterEach(async () => { await replacement?.stop(); replacement = undefined; await h?.cleanup(); });
const git = async (cwd: string, ...args: string[]) => (await execa('git', args, { cwd })).stdout;
const integration = () => path.join(h.crewHomeDir, 'integration', h.workspaceId);
function restart() {
  replacement = new MergeQueue({ db: h.db, eventBus: h.eventBus, scheduler: h.scheduler, worktreeManager: h.worktreeManager, crewHome: h.crewHomeDir });
  replacement.start();
}

it.each(['queued', 'rebasing', 'verifying', 'merging'])('recovers a %s item and cleans a crash-interrupted integration rebase before landing once', async status => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const task = h.getTask('checkout')!;
  // Make a real interrupted rebase in the detached integration worktree.
  fs.writeFileSync(path.join(h.repoDir, 'checkout.txt'), 'user main\n');
  await git(h.repoDir, 'add', 'checkout.txt');
  await git(h.repoDir, 'commit', '-m', 'User conflicting main');
  const currentMain = await git(h.repoDir, 'rev-parse', 'main');
  fs.mkdirSync(path.dirname(integration()), { recursive: true });
  await git(h.repoDir, 'worktree', 'add', '--detach', integration(), task.branch!);
  await expect(git(integration(), 'rebase', 'main')).rejects.toThrow();
  fs.writeFileSync(path.join(integration(), 'crash.tmp'), 'left by crash');
  // Remove the source conflict while leaving the integration rebase half done.
  await git(task.worktreePath!, 'reset', '--hard', 'main');
  fs.writeFileSync(path.join(task.worktreePath!, 'checkout.txt'), 'resolved\n');
  await git(task.worktreePath!, 'add', 'checkout.txt');
  await git(task.worktreePath!, 'commit', '-m', 'Recovered source');
  h.db.db.insert(schema.mergeQueueItems).values({ id: 'crashed-item', taskId: task.id, position: 1, status, createdAt: new Date() }).run();
  const done = waitForMerge(h, task.id, i => i.status === 'merged');
  restart();
  await done;
  expect(await git(h.repoDir, 'rev-parse', 'main^')).toBe(currentMain);
  expect(fs.readFileSync(path.join(h.repoDir, 'checkout.txt'), 'utf8')).toBe('resolved\n');
  expect(fs.existsSync(path.join(integration(), 'crash.tmp'))).toBe(false);
  expect(await git(integration(), 'status', '--porcelain')).toBe('');
  expect(h.getTask(task.id)?.retries).toBe(0);
  expect(await git(h.repoDir, 'branch', '--list', task.branch!)).toBe('');
});

it.each([false, true])('recovers a moved ref before the task was marked merged without repeating verification or the merge (later commit: %s)', async later => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const task = h.getTask('checkout')!;
  const sha = await git(h.repoDir, 'rev-parse', task.branch!);
  await git(h.repoDir, 'merge', '--ff-only', sha);
  if (later) await git(h.repoDir, 'commit', '--allow-empty', '-m', 'Later user commit');
  const main = await git(h.repoDir, 'rev-parse', 'main');
  h.db.db.insert(schema.mergeQueueItems).values({ id: 'landed-item', taskId: task.id, position: 1, status: 'merging', commitSha: sha, createdAt: new Date() }).run();
  const done = waitForMerge(h, task.id, i => i.status === 'merged');
  restart();
  await done;
  expect(h.getTask(task.id)?.status).toBe('merged');
  expect(await git(h.repoDir, 'rev-parse', 'main')).toBe(main);
  expect(h.getVerificationResults(task.id).some(r => r.step.startsWith('merge:'))).toBe(false);
  expect(await git(h.repoDir, 'branch', '--list', task.branch!)).toBe('');
  expect(await git(h.repoDir, 'worktree', 'list', '--porcelain')).not.toContain(task.worktreePath!);
});

it('cancels a queued item without leaving queued state and keeps the branch', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  fs.writeFileSync(path.join(h.repoDir, 'personal.txt'), 'dirty');
  const paused = waitForMerge(h, 'checkout', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  const branch = h.getTask('checkout')!.branch!;
  expect((await h.runCrew(['cancel', 'checkout'])).exitCode).toBe(0);
  expect(h.getTask('checkout')?.status).toBe('cancelled');
  expect(h.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, 'checkout')).get()).toBeUndefined();
  expect(await git(h.repoDir, 'branch', '--list', branch)).toContain(branch);
});

it('recovers a legacy failed item into escalation with its reason and never retries it automatically', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  h.db.db.insert(schema.mergeQueueItems).values({ id: 'legacy-failed', taskId: 'checkout', position: 1, status: 'failed', output: 'Historical git failure', createdAt: new Date() }).run();
  const escalated = h.waitForTaskStatus('checkout', 'escalated', 2000);
  restart();
  await escalated;
  replacement!.tick();
  await replacement!.stop();
  expect(h.getTask('checkout')?.retries).toBe(0);
  expect(h.getMessages('checkout').filter(m => m.type === 'feedback').map(m => m.body)).toEqual(['Historical git failure']);
  expect(h.db.db.select().from(schema.runs).all()).toHaveLength(1);
  expect(h.db.db.select().from(schema.mergeQueueItems).get()?.status).toBe('failed');
});

it('finishes a conflict parent after restart when its child landed while the worker was down', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  for (const id of ['a', 'b']) {
    await h.createTask({ id, title: `Change ${id}`, description: id });
    await h.scheduler.transitionTask(id, 'doing');
  }
  for (const id of ['a', 'b']) {
    await h.runTaskWithAgent(id, [{ type: 'edit_file', filePath: 'README.md', content: `${id}\n` }, { type: 'done', result: id }]);
    await h.waitForTaskStatus(id, 'merge-queue');
  }
  const conflicted = waitForMerge(h, 'b', i => i.status === 'conflict');
  h.server.mergeQueue.start();
  const item = await conflicted;
  await h.server.mergeQueue.stop();
  const childId = item.conflictTaskId!;
  await h.runTaskWithAgent(childId, [
    { type: 'git', args: ['rebase', 'main'], allowFailure: true },
    { type: 'edit_file', filePath: 'README.md', content: 'a and b\n' },
    { type: 'git', args: ['add', 'README.md'] },
    { type: 'git', args: ['rebase', '--continue'] },
    { type: 'done', result: 'Resolved' },
  ]);
  await h.waitForTaskStatus(childId, 'merge-queue');
  const child = h.getTask(childId)!;
  const sha = await git(h.repoDir, 'rev-parse', child.branch!);
  await git(h.repoDir, 'merge', '--ff-only', sha);
  await h.scheduler.transitionTask(childId, 'merged', {
    alongside: () => h.db.db.insert(schema.mergeQueueItems).values({ id: 'child-landed', taskId: childId, position: 3, status: 'merged', commitSha: sha, createdAt: new Date() }).run(),
  });
  expect(h.getTask('b')?.status).toBe('merge-queue');
  const done = waitForMerge(h, 'b', i => i.status === 'merged');
  restart();
  await done;
  await replacement!.stop();
  expect(h.getTask('b')?.status).toBe('merged');
  expect(await git(h.repoDir, 'branch', '--list', child.branch!)).toBe('');
  expect(await git(h.repoDir, 'worktree', 'list', '--porcelain')).not.toContain(child.worktreePath!);
  expect(await git(h.repoDir, 'rev-parse', 'main')).toBe(sha);
});
