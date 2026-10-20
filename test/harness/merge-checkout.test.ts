import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { readyToMerge, waitForMerge } from './merge-helpers.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
const git = async (...args: string[]) => (await execa('git', args, { cwd: h.repoDir })).stdout;

it('fast-forwards a clean default checkout and updates its working files', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(await git('branch', '--show-current')).toBe('main');
  expect(fs.readFileSync(path.join(h.repoDir, 'checkout.txt'), 'utf8')).toBe('checkout\n');
  expect(await git('status', '--porcelain')).toBe('');
  expect(h.server.mergeQueue.warnings.size).toBe(0);
});

it('updates the default ref while leaving a detached user checkout untouched', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  const old = await git('rev-parse', 'HEAD');
  await git('switch', '--detach');
  await readyToMerge(h);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(await git('rev-parse', 'HEAD')).toBe(old);
  expect(await git('rev-parse', 'main')).not.toBe(old);
  expect(fs.existsSync(path.join(h.repoDir, 'checkout.txt'))).toBe(false);
});

it.each(['tracked', 'untracked'] as const)('pauses for %s changes, preserves all bytes, and resumes after the checkout is clean', async kind => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const old = await git('rev-parse', 'main');
  const file = path.join(h.repoDir, kind === 'tracked' ? 'README.md' : 'personal.bin');
  const bytes = Buffer.from([0, 255, 10, 13, 27, 42]);
  fs.writeFileSync(file, bytes);
  const beforeStatus = await git('status', '--porcelain');
  const paused = waitForMerge(h, 'checkout', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  expect(h.getTask('checkout')?.status).toBe('merge-queue');
  expect(fs.readFileSync(file)).toEqual(bytes);
  expect(await git('status', '--porcelain')).toBe(beforeStatus);
  expect(await git('rev-parse', 'main')).toBe(old);
  expect(h.server.mergeQueue.warnings.get(h.workspaceId)).toContain('main');
  if (kind === 'tracked') await git('restore', 'README.md');
  else fs.unlinkSync(file);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  // Exercise the safety tick directly, with no sleeps or polling in tests.
  h.server.mergeQueue.tick();
  await done;
  expect(fs.readFileSync(path.join(h.repoDir, 'checkout.txt'), 'utf8')).toBe('checkout\n');
  expect(h.server.mergeQueue.warnings.size).toBe(0);
});

it('rechecks a checkout dirtied after re-verification before touching the user files', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const file = path.join(h.repoDir, 'README.md');
  const bytes = Buffer.from('user edits after verification\r\n');
  const old = await git('rev-parse', 'main');
  h.server.mergeQueue.hooks.beforeRefUpdate = async () => { fs.writeFileSync(file, bytes); };
  const paused = waitForMerge(h, 'checkout', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  expect(fs.readFileSync(file)).toEqual(bytes);
  expect(await git('rev-parse', 'main')).toBe(old);
  expect(h.getTask('checkout')?.status).toBe('merge-queue');
});

it('loses compare-and-swap to a user commit, rebases and re-verifies before landing', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await git('switch', '-c', 'user-work');
  h.setVerifyCommands([{ name: 'ancestor', command: 'git merge-base --is-ancestor main HEAD' }]);
  await readyToMerge(h);
  let userCommit = '';
  let attempts = 0;
  h.server.mergeQueue.hooks.beforeRefUpdate = async () => {
    if (++attempts > 1) return;
    const old = await git('rev-parse', 'main');
    userCommit = await git('commit-tree', `${old}^{tree}`, '-p', old, '-m', 'User racing commit');
    await git('update-ref', 'refs/heads/main', userCommit, old);
  };
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(attempts).toBe(2);
  expect(await git('rev-parse', 'main^')).toBe(userCommit);
  expect(h.getVerificationResults('checkout').filter(r => r.step === 'merge:ancestor')).toHaveLength(2);
  expect(await git('branch', '--show-current')).toBe('user-work');
});

it('fails the item after three ref races without overwriting any user commit', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await git('switch', '-c', 'user-work');
  await readyToMerge(h);
  let attempts = 0;
  let last = '';
  h.server.mergeQueue.hooks.beforeRefUpdate = async () => {
    const old = await git('rev-parse', 'main');
    last = await git('commit-tree', `${old}^{tree}`, '-p', old, '-m', `User commit ${++attempts}`);
    await git('update-ref', 'refs/heads/main', last, old);
  };
  const failed = waitForMerge(h, 'checkout', i => i.status === 'failed');
  h.server.mergeQueue.start();
  await failed;
  expect(attempts).toBe(3);
  expect(await git('rev-parse', 'main')).toBe(last);
  expect(h.getTask('checkout')?.status).toBe('escalated');
});


it('pauses for checkout dirtiness introduced in the final update window', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const old = await git('rev-parse', 'main');
  const file = path.join(h.repoDir, 'checkout.txt');
  const bytes = Buffer.from([0, 255, 10, 13, 42]);
  h.server.mergeQueue.hooks.beforeCheckoutMerge = async () => { fs.writeFileSync(file, bytes); };
  const paused = waitForMerge(h, 'checkout', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  expect(h.getTask('checkout')?.status).toBe('merge-queue');
  expect(h.getTask('checkout')?.retries).toBe(0);
  expect(h.server.mergeQueue.warnings.get(h.workspaceId)).toContain('main');
  expect(await git('rev-parse', 'main')).toBe(old);
  expect(fs.readFileSync(file)).toEqual(bytes);
  h.server.mergeQueue.hooks.beforeCheckoutMerge = undefined;
  fs.unlinkSync(file);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.tick();
  await done;
});

it.each(['before attempt', 'before checkout transaction'])('pauses for an ignored file collision %s without overwriting any user bytes', async timing => {
  h = await createPipelineHarness({ startVerifier: true });
  fs.writeFileSync(path.join(h.repoDir, '.gitignore'), 'local.env\n');
  await git('add', '.gitignore');
  await git('commit', '-m', 'Ignore local environment');
  await h.createTask({ id: 'ignored', title: 'Track environment fixture', description: 'Tracked incoming path' });
  await h.runTaskWithAgent('ignored', [
    { type: 'edit_file', filePath: 'local.env', content: 'task fixture\n' },
    { type: 'git', args: ['add', '-f', 'local.env'] },
    { type: 'done', result: 'Tracked fixture' },
  ]);
  await h.waitForTaskStatus('ignored', 'merge-queue');
  const file = path.join(h.repoDir, 'local.env');
  const bytes = Buffer.from([255, 0, 13, 10, 42]);
  const old = await git('rev-parse', 'main');
  if (timing === 'before attempt') fs.writeFileSync(file, bytes);
  else h.server.mergeQueue.hooks.beforeCheckoutMerge = async () => { fs.writeFileSync(file, bytes); };
  const paused = waitForMerge(h, 'ignored', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  expect(fs.readFileSync(file)).toEqual(bytes);
  expect(await git('rev-parse', 'main')).toBe(old);
  expect(h.getTask('ignored')).toMatchObject({ status: 'merge-queue', retries: 0 });
  expect(h.server.mergeQueue.warnings.get(h.workspaceId)).toContain('main');
  h.server.mergeQueue.hooks.beforeCheckoutMerge = undefined;
  fs.unlinkSync(file);
  const done = waitForMerge(h, 'ignored', i => i.status === 'merged');
  h.server.mergeQueue.tick();
  await done;
  expect(fs.readFileSync(file, 'utf8')).toBe('task fixture\n');
});

it('rechecks a branch switch immediately before checkout update and lands only on the default branch', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const old = await git('rev-parse', 'main');
  h.server.mergeQueue.hooks.beforeCheckoutMerge = async () => { await git('switch', '-c', 'user-switched'); };
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(await git('branch', '--show-current')).toBe('user-switched');
  expect(await git('rev-parse', 'user-switched')).toBe(old);
  expect(await git('rev-parse', 'main')).not.toBe(old);
  expect(fs.existsSync(path.join(h.repoDir, 'checkout.txt'))).toBe(false);
  expect(await git('status', '--porcelain')).toBe('');
});

it('holds HEAD stable across the final checkout transaction and fast-forward', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  let attempted = false;
  let refused = false;
  h.server.mergeQueue.hooks.beforeCheckoutWrite = async () => {
    attempted = true;
    const result = await execa('git', ['switch', '-c', 'racing-switch'], { cwd: h.repoDir, reject: false });
    refused = result.exitCode !== 0 && /index\.lock|HEAD\.lock/.test(result.stderr);
  };
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(attempted).toBe(true);
  expect(refused).toBe(true);
  expect(await git('branch', '--show-current')).toBe('main');
  expect(await git('rev-parse', 'racing-switch')).toBe(await git('rev-parse', 'main^'));
  expect(await git('status', '--porcelain')).toBe('');
});

it.each(['index', 'HEAD'])('pauses for a user-owned %s lock without changing it and resumes after it is released', async kind => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const lock = path.join(h.repoDir, '.git', `${kind}.lock`);
  const bytes = Buffer.from('user git operation lock\n');
  fs.writeFileSync(lock, bytes);
  const old = await git('rev-parse', 'main');
  const paused = waitForMerge(h, 'checkout', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  expect(fs.readFileSync(lock)).toEqual(bytes);
  expect(await git('rev-parse', 'main')).toBe(old);
  expect(h.getTask('checkout')).toMatchObject({ status: 'merge-queue', retries: 0 });
  fs.unlinkSync(lock);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.tick();
  await done;
  expect(await git('status', '--porcelain')).toBe('');
  expect(fs.existsSync(lock)).toBe(false);
});
