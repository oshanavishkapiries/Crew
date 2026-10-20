import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { readyToMerge, waitForMerge } from './merge-helpers.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
const human = () => ({ 'x-crew-secret': h.server.perStartSecret, 'Content-Type': 'application/json' });

it('shows queue order, active phase and a dirty-checkout warning through the human API, queue and status CLI', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h, 'first');
  await readyToMerge(h, 'second');
  fs.writeFileSync(path.join(h.repoDir, 'personal'), 'keep');
  const paused = waitForMerge(h, 'first', i => i.status === 'queued' && !!i.output?.includes('paused'));
  h.server.mergeQueue.start();
  await paused;
  const response = await fetch(`${h.server.url}/api/merge-queue`, { headers: human() });
  expect(response.status).toBe(200);
  const queue = await response.json() as any;
  expect(queue.items.map((i: any) => i.taskId)).toEqual(['first', 'second']);
  expect(queue.items[0]).toMatchObject({ status: 'queued', title: 'Feature first', workspaceId: h.workspaceId });
  expect(queue.warnings[0].message).toContain('main');
  const cli = await h.runCrew(['queue']);
  expect(cli.exitCode).toBe(0);
  expect(cli.stdout.indexOf('first')).toBeLessThan(cli.stdout.indexOf('second'));
  expect(cli.stdout).toContain('queued');
  expect(cli.stdout).toContain('main checkout has uncommitted changes');
  const status = await h.runCrew(['status']);
  expect(status.exitCode).toBe(0);
  expect(status.stdout).toContain('Merge queue: 2 pending');
  expect(status.stdout).toContain('main checkout has uncommitted changes');
});

it.each(['missing', 'agent'] as const)('rejects %s credentials for queue and retry without changing the task', async kind => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'human-only', title: 'Human only', description: 'Auth' });
  await h.scheduler.transitionTask('human-only', 'doing');
  await h.scheduler.transitionTask('human-only', 'escalated');
  const headers = kind === 'agent' ? { 'x-crew-agent-token': h.agentToken } : {};
  for (const [method, endpoint] of [['GET', '/api/merge-queue'], ['POST', '/api/tasks/human-only/retry']]) {
    const response = await fetch(`${h.server.url}${endpoint}`, { method, headers });
    expect([401, 403]).toContain(response.status);
  }
  expect(h.getTask('human-only')?.status).toBe('escalated');
  expect(h.getMessages('human-only')).toHaveLength(0);
});

it('keeps escalation terminal for dispatcher, verifier, queue and ordinary Scheduler transitions', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  await h.scheduler.transitionTask('checkout', 'escalated');
  await expect(h.scheduler.transitionTask('checkout', 'doing')).rejects.toThrow('Invalid task transition');
  await expect(h.scheduler.transitionTask('checkout', 'doing', { reason: 'automatic retry', human: true } as any)).rejects.toThrow('Invalid task transition');
  h.server.mergeQueue.start();
  h.dispatcher.start();
  h.verifier.resume();
  await h.dispatcher.dispatchOnce();
  h.server.mergeQueue.tick();
  await h.server.mergeQueue.stop();
  expect(h.getTask('checkout')?.status).toBe('escalated');
  expect(h.db.db.select().from(schema.runs).all()).toHaveLength(1);
  expect(h.scheduler.isValidTransition('escalated', 'doing')).toBe(false);
});

it.each(['missing branch', 'empty squash', 'three ref races'])('human retry recovers %s, resets retries and records the note atomically before a new approval requeues and merges', async failure => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  const task = h.getTask('checkout')!;
  h.db.db.update(schema.tasks).set({ retries: 2 }).where(eq(schema.tasks.id, task.id)).run();
  if (failure === 'missing branch') {
    await h.worktreeManager.removeWorktree(task);
    await execa('git', ['branch', '-D', task.branch!], { cwd: h.repoDir });
  } else if (failure === 'empty squash') {
    fs.writeFileSync(path.join(h.repoDir, 'checkout.txt'), 'checkout\n');
    await execa('git', ['add', 'checkout.txt'], { cwd: h.repoDir });
    await execa('git', ['commit', '-m', 'Already implemented'], { cwd: h.repoDir });
  } else {
    await execa('git', ['switch', '-c', 'user-work'], { cwd: h.repoDir });
    h.server.mergeQueue.hooks.beforeRefUpdate = async () => {
      const old = (await execa('git', ['rev-parse', 'main'], { cwd: h.repoDir })).stdout;
      const sha = (await execa('git', ['commit-tree', `${old}^{tree}`, '-p', old, '-m', 'Racing user'], { cwd: h.repoDir })).stdout;
      await execa('git', ['update-ref', 'refs/heads/main', sha, old], { cwd: h.repoDir });
    };
  }
  const failed = waitForMerge(h, task.id, i => i.status === 'failed');
  h.server.mergeQueue.start();
  await failed;
  h.server.mergeQueue.hooks.beforeRefUpdate = undefined;
  expect(h.getTask(task.id)).toMatchObject({ status: 'escalated', retries: 2 });
  let atomic = false;
  const unsub = h.eventBus.subscribeBoardEvents(h.boardId, e => {
    if (e.type === 'task_status_changed' && (e.data as any).from === 'escalated') {
      atomic = h.getTask(task.id)?.retries === 0 && h.getMessages(task.id).some(m => m.type === 'feedback' && m.body === 'Branch repaired; try again');
    }
  });
  const retry = await h.runCrew(['retry', task.id, '--note', 'Branch repaired; try again']);
  unsub();
  expect(retry.exitCode, retry.stderr).toBe(0);
  expect(atomic).toBe(true);
  expect(h.getTask(task.id)).toMatchObject({ status: 'doing', retries: 0 });
  const done = waitForMerge(h, task.id, i => i.status === 'merged');
  await h.runTaskWithAgent(task.id, [{ type: 'edit_file', filePath: 'checkout.txt', content: 'recovered\n' }, { type: 'done', result: 'Recovered' }]);
  await done;
  expect(h.getTask(task.id)).toMatchObject({ status: 'merged', retries: 0 });
  const runs = h.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, task.id)).all();
  expect(runs).toHaveLength(2);
  expect(runs[1].prompt).toContain('Branch repaired; try again');
  expect(runs[1].resumedFromRunId).toBeNull();
  expect((await execa('git', ['show', 'main:checkout.txt'], { cwd: h.repoDir })).stdout).toBe('recovered');
  expect((await h.runCrew(['retry', task.id])).exitCode).toBe(1);
});

it('allows a human retry without a note and rejects retrying a non-escalated task or a non-string note', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'retry', title: 'Retry', description: 'Optional note' });
  expect((await h.runCrew(['retry', 'retry'])).exitCode).toBe(1);
  await h.scheduler.transitionTask('retry', 'doing');
  await h.scheduler.transitionTask('retry', 'escalated');
  for (const body of [{ note: 42 }, null, []]) {
    const bad = await fetch(`${h.server.url}/api/tasks/retry/retry`, { method: 'POST', headers: human(), body: JSON.stringify(body) });
    expect(bad.status).toBe(400);
  }
  expect(h.getTask('retry')?.status).toBe('escalated');
  expect((await h.runCrew(['retry', 'retry'])).exitCode).toBe(0);
  expect(h.getTask('retry')).toMatchObject({ status: 'doing', retries: 0 });
  expect(h.getMessages('retry')).toHaveLength(0);
});

it('reports the current merging phase before the default ref moves', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  await readyToMerge(h);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let enter!: () => void;
  const reached = new Promise<void>(resolve => { enter = resolve; });
  h.server.mergeQueue.hooks.beforeRefUpdate = async () => { enter(); await gate; };
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await reached;
  try {
    const response = await fetch(`${h.server.url}/api/merge-queue`, { headers: human() });
    expect(response.status).toBe(200);
    expect((await response.json() as any).items[0]).toMatchObject({ taskId: 'checkout', status: 'merging' });
    expect((await h.runCrew(['queue'])).stdout).toContain('[merging]');
  } finally { release(); }
  await done;
  expect((await h.runCrew(['queue'])).stdout).toContain('Empty');
});


it('accepts only one concurrent human retry and commits only that request feedback', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'concurrent', title: 'Concurrent retry', description: 'One recovery' });
  await h.scheduler.transitionTask('concurrent', 'doing');
  await h.scheduler.transitionTask('concurrent', 'escalated');
  const outcomes = await Promise.allSettled([
    h.scheduler.retryTaskByHuman('concurrent', 'first'),
    h.scheduler.retryTaskByHuman('concurrent', 'second'),
  ]);
  expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter(o => o.status === 'rejected')).toHaveLength(1);
  expect(h.getMessages('concurrent').filter(m => m.type === 'feedback')).toHaveLength(1);
  expect(h.getTask('concurrent')).toMatchObject({ status: 'doing', retries: 0 });
});
