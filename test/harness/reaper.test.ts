import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { anotherServerIsRunning, reapStaleRuns } from '../../src/server/runner/reaper.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

let h: PipelineHarness | undefined;
const children: ChildProcess[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone */ } }
  await h?.cleanup(); h = undefined;
  vi.unstubAllEnvs();
});

function alive(pid: number) {
  try { process.kill(pid, 0); } catch { return false; }
  // A killed child stays a zombie until its parent (this test) reaps it.
  try { return !fs.readFileSync(`/proc/${pid}/stat`, 'utf8').includes(') Z '); } catch { return false; }
}

function agentLike(taskId: string | undefined) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 60000)'], {
    detached: true, stdio: 'ignore', env: { ...process.env, ...(taskId ? { CREW_TASK_ID: taskId } : {}) },
  });
  children.push(child);
  return child;
}

async function seed(taskId: string, pid: number) {
  h = h ?? await createPipelineHarness({});
  const exists = h.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  if (!exists) await h.createTask({ id: taskId, title: taskId, description: taskId });
  const id = `run-${pid}`;
  h.db.db.insert(schema.runs).values({ id, taskId, agentId: h.agentId, adapter: 'fake', pid, startedAt: new Date() }).run();
  return id;
}

it('kills an agent that still runs for its task, ends the stale run and leaves the task for orphan re-dispatch', async () => {
  const agent = agentLike('stale-task');
  const run = await seed('stale-task', agent.pid!);
  expect(alive(agent.pid!)).toBe(true);
  const exited = once(agent, 'exit');
  expect(reapStaleRuns(h!.db)).toEqual({ killed: 1, ended: 1 });
  await exited;
  expect(alive(agent.pid!)).toBe(false);
  expect(h!.db.db.select().from(schema.runs).where(eq(schema.runs.id, run)).get()).toMatchObject({ exitReason: 'stopped' });
  expect(h!.db.db.select().from(schema.runs).where(eq(schema.runs.id, run)).get()?.endedAt).toBeInstanceOf(Date);
  expect(h!.getTask('stale-task')?.retries).toBe(0);
});

it('never kills a reused PID: a live process of another task or no task is left running while the stale row is ended', async () => {
  const other = agentLike('some-other-task');
  const plain = agentLike(undefined);
  const first = await seed('reuse-task', other.pid!);
  const second = await seed('reuse-task', plain.pid!);
  expect(reapStaleRuns(h!.db)).toEqual({ killed: 0, ended: 2 });
  expect(alive(other.pid!)).toBe(true); expect(alive(plain.pid!)).toBe(true);
  for (const id of [first, second]) expect(h!.db.db.select().from(schema.runs).where(eq(schema.runs.id, id)).get()?.endedAt).toBeInstanceOf(Date);
});

it('ends rows whose process is already gone and ignores runs that already ended', async () => {
  const gone = agentLike('gone-task');
  const exited = once(gone, 'exit'); process.kill(-gone.pid!, 'SIGKILL'); await exited;
  const run = await seed('gone-task', gone.pid!);
  h!.db.db.insert(schema.runs).values({ id: 'finished', taskId: 'gone-task', agentId: h!.agentId, adapter: 'fake', startedAt: new Date(), endedAt: new Date(), exitReason: 'done' }).run();
  expect(reapStaleRuns(h!.db)).toEqual({ killed: 0, ended: 1 });
  expect(h!.db.db.select().from(schema.runs).where(eq(schema.runs.id, run)).get()?.exitReason).toBe('stopped');
  expect(h!.db.db.select().from(schema.runs).where(eq(schema.runs.id, 'finished')).get()?.exitReason).toBe('done');
});

it('detects a live server in server.json so a second start never reaps its runs', () => {
  const home = fs.mkdtempSync('/tmp/crew-reaper-home-');
  vi.stubEnv('CREW_HOME', home);
  try {
    expect(anotherServerIsRunning()).toBe(false);
    const server = agentLike(undefined);
    fs.writeFileSync(path.join(home, 'server.json'), JSON.stringify({ pid: server.pid }));
    expect(anotherServerIsRunning()).toBe(true);
    fs.writeFileSync(path.join(home, 'server.json'), JSON.stringify({ pid: process.pid }));
    expect(anotherServerIsRunning()).toBe(false);
    fs.writeFileSync(path.join(home, 'server.json'), JSON.stringify({ pid: 2 ** 22 + 1 }));
    expect(anotherServerIsRunning()).toBe(false);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
