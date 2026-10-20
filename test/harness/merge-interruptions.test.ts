import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { readyToMerge, waitForMerge } from './merge-helpers.js';
let h: PipelineHarness;
const originalPath = process.env.PATH;
afterEach(async () => { await h?.cleanup(); process.env.PATH = originalPath; });
const quote = (s: string) => "'" + s.replaceAll("'", "'\\''") + "'";
function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = fs.watch(path.dirname(file), () => { if (fs.existsSync(file)) finish(); });
    const timer = setTimeout(() => finish(new Error(`No process signal: ${file}`)), 10000);
    function finish(error?: Error) { clearTimeout(timer); watcher.close(); if (error) reject(error); else resolve(); }
  });
}
const git = async (...args: string[]) => (await execa('git', args, { cwd: h.repoDir })).stdout;

async function hanging(stage: 'rebase' | 'verify' | 'setup' | 'landed' | 'prepare') {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const signal = path.join(h.crewHomeDir, 'merge-running');
  const once = path.join(h.crewHomeDir, 'merge-once');
  const worker = path.join(h.crewHomeDir, 'hang.cjs');
  fs.writeFileSync(worker, `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
    process.on('SIGTERM', () => child.kill('SIGTERM'));
    child.on('exit', () => process.exit(0));
    fs.writeFileSync(${JSON.stringify(once)}, 'once');
    fs.writeFileSync(${JSON.stringify(signal)}, JSON.stringify([process.ppid, process.pid, child.pid]));
  `);
  const command = `if test ! -f ${quote(once)}; then node ${quote(worker)}; fi`;
  if (stage === 'verify') h.setVerifyCommands([{ name: 'interrupt', command }]);
  if (stage === 'setup') h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: `touch interrupted-output; ${command}` } }).run();
  if (stage === 'rebase' || stage === 'landed' || stage === 'prepare') {
    const realGit = (await execa('which', ['git'])).stdout;
    const bin = path.join(h.crewHomeDir, 'bin');
    fs.mkdirSync(bin, { recursive: true });
    // A test executable delegates every call to real git. On the first integration
    // rebase it suspends that real git process and starts a child in the same group.
    fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}
      const { spawn, spawnSync } = require('node:child_process');
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      if (${JSON.stringify(stage)} === 'landed' && args.includes('update-ref') && args.includes('--stdin')) {
        const r = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
        if (r.status !== 0) process.exit(r.status ?? 1);
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
        process.on('SIGTERM', () => child.kill('SIGTERM'));
        child.on('exit', () => process.exit(0));
        fs.writeFileSync(${JSON.stringify(signal)}, JSON.stringify([process.pid, child.pid, r.pid]));
      } else if (${JSON.stringify(stage)} === 'landed' || fs.existsSync(${JSON.stringify(once)}) || (${JSON.stringify(stage)} === 'prepare' ? !(args.includes('update-ref') && args.includes('--stdin')) : !process.cwd().includes('/integration/') || !args.includes('rebase') || args.includes('--abort'))) {
        const r = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' }); process.exit(r.status ?? 1);
      }
      else {
      const git = spawn(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
      process.kill(git.pid, 'SIGSTOP');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      let remaining = 2;
      for (const p of [git, child]) p.on('exit', () => { if (--remaining === 0) process.exit(0); });
      process.on('SIGTERM', () => { process.kill(git.pid, 'SIGCONT'); git.kill('SIGTERM'); child.kill('SIGTERM'); });
      fs.writeFileSync(${JSON.stringify(once)}, 'once');
      fs.writeFileSync(${JSON.stringify(signal)}, JSON.stringify([process.pid, git.pid, child.pid]));
      }
    `, { mode: 0o755 });
    process.env.PATH = `${bin}:${originalPath}`;
  }
  const running = waitForFile(signal);
  h.server.mergeQueue.start();
  await running;
  return JSON.parse(fs.readFileSync(signal, 'utf8')) as number[];
}

it.each(['rebase', 'verify', 'setup', 'prepare'] as const)('stop-all kills %s and every child, remains stopped on restart, and resumes without a retry', async stage => {
  const pids = await hanging(stage);
  const old = await git('rev-parse', 'main');
  expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  expect(h.getTask('checkout')?.status).toBe('merge-queue');
  expect(h.db.db.select().from(schema.mergeQueueItems).get()?.status).toBe('queued');
  expect(await git('rev-parse', 'main')).toBe(old);
  const dir = path.join(h.crewHomeDir, 'integration', h.workspaceId);
  expect((await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout).toBe('');
  await h.server.mergeQueue.stop();
  h.server.mergeQueue.start();
  expect(fs.existsSync(path.join(h.crewHomeDir, 'stopped'))).toBe(true);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  expect((await h.runCrew(['resume'])).exitCode).toBe(0);
  await done;
  expect(h.getTask('checkout')?.retries).toBe(0);
  expect((await git('log', '--format=%s', 'main')).split('\n').filter(s => s === 'Feature checkout')).toHaveLength(1);
});

it.each(['rebase', 'verify', 'setup', 'prepare'] as const)('cancel kills %s and every child before removing its item, cleans integration and keeps its branch', async stage => {
  const pids = await hanging(stage);
  const task = h.getTask('checkout')!;
  const old = await git('rev-parse', 'main');
  expect((await h.runCrew(['cancel', task.id])).exitCode).toBe(0);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  expect(h.getTask(task.id)?.status).toBe('cancelled');
  expect(h.getTask(task.id)?.retries).toBe(0);
  expect(h.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, task.id)).get()).toBeUndefined();
  expect(await git('branch', '--list', task.branch!)).toContain(task.branch);
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(task.worktreePath!);
  expect(await git('rev-parse', 'main')).toBe(old);
  expect((await execa('git', ['status', '--porcelain'], { cwd: path.join(h.crewHomeDir, 'integration', h.workspaceId) })).stdout).toBe('');
});


it('records the landed merge when cancellation arrives after Git moved the ref but before the task transition', async () => {
  const pids = await hanging('landed');
  const task = h.getTask('checkout')!;
  const item = h.db.db.select().from(schema.mergeQueueItems).get()!;
  expect(item.status).toBe('merging');
  expect(h.getTask(task.id)?.status).toBe('merge-queue');
  expect(await git('rev-parse', 'main')).toBe(item.commitSha);
  expect((await h.runCrew(['cancel', task.id])).exitCode).toBe(0);
  for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  expect(h.getTask(task.id)?.status).toBe('merged');
  expect(h.db.db.select().from(schema.mergeQueueItems).get()?.status).toBe('merged');
  expect(await git('rev-parse', 'main')).toBe(item.commitSha);
  expect(await git('branch', '--list', task.branch!)).toBe('');
  expect(h.getTask(task.id)?.retries).toBe(0);
});

it('finishes cleanup when stop-all arrives after the task transition but before branch cleanup', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const task = h.getTask('checkout')!;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const remove = h.worktreeManager.removeWorktree.bind(h.worktreeManager);
  let held = false;
  h.worktreeManager.removeWorktree = async value => {
    if (value.id === task.id && h.getTask(task.id)?.status === 'merged' && !held) {
      held = true; entered(); await gate;
    }
    await remove(value);
  };
  h.server.mergeQueue.start();
  await reached;
  const stopped = h.server.mergeQueue.stopAll();
  release();
  await stopped;
  expect(h.getTask(task.id)?.status).toBe('merged');
  expect(await git('branch', '--list', task.branch!)).toBe('');
  expect(await git('worktree', 'list', '--porcelain')).not.toContain(task.worktreePath!);
  expect(h.db.db.select().from(schema.mergeQueueItems).get()?.status).toBe('merged');
});
