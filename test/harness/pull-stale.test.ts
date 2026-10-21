import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import * as schema from '../../src/server/db/schema.js';
import type { Clock } from '../../src/server/runner/index.js';
import { AGENT_TOKEN_HEADER, SECRET_HEADER } from '../../src/server/api/security.js';
import { startServer } from '../../src/server/index.js';

class ManualClock implements Clock {
  time = Math.floor(Date.now() / 1000) * 1000;
  timers = new Map<number, { at: number; cb: () => void }>();
  next = 0;
  now = () => this.time;
  setTimeout = (cb: () => void, ms: number) => { const id = ++this.next; this.timers.set(id, { at: this.time + ms, cb }); return id; };
  clearTimeout = (id: number) => { this.timers.delete(id); };
  advance(ms: number) {
    this.time += ms;
    for (const [id, timer] of [...this.timers]) if (timer.at <= this.time) { this.timers.delete(id); timer.cb(); }
  }
}
let h: PipelineHarness;
let clock: ManualClock;
let cleaned = false;
afterEach(async () => { if (!cleaned) await h?.cleanup(); });
async function setup() {
  cleaned = false;
  clock = new ManualClock();
  h = await createPipelineHarness({ clock, staleScanIntervalMs: 1000 });
  h.db.db.update(schema.workspaces).set({ config: { staleAfterMs: 10000 } }).run();
  h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, h.agentId)).run();
}
async function poll(token = h.agentToken) {
  const result = await h.runCrew(['next', '--wait', '0'], { CREW_AGENT_TOKEN: token });
  expect(result.exitCode, result.stderr).toBe(0);
  const from = result.stdout.indexOf('{'); const to = result.stdout.indexOf('\nSet CREW_TASK_ID=');
  return JSON.parse(result.stdout.slice(from, to < 0 ? undefined : to));
}
const agent = () => h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!;
const runs = () => h.db.db.select().from(schema.runs).all();

it('scanner timer requeues stale work without retries, preserves edits/branch, and a second Pull agent picks it up', async () => {
  await setup();
  await h.createTask({ id: 'stale', title: 'Preserve work', description: '' });
  const first = await poll();
  fs.writeFileSync(path.join(first.workDir, 'draft.txt'), 'Keep this edit\n');
  const secondToken = h.addAgent('replacement');
  h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, 'replacement')).run();
  const events: string[] = [];
  h.eventBus.subscribeBoardEvents(h.boardId, e => { if (e.type === 'agent_stale') events.push(e.type); });
  clock.advance(11000);
  expect(agent().status).toBe('stale');
  expect(runs()[0]).toMatchObject({ exitReason: 'stale', pid: null });
  expect(h.getTask('stale')).toMatchObject({ status: 'ready', retries: 0, branch: first.task.branch, worktreePath: first.workDir, assigneeAgentId: null });
  expect(events).toEqual(['agent_stale']);
  expect(h.server.pullStaleScanner.scanOnce()).toEqual([]);
  const replacement = await poll(secondToken);
  expect(replacement.workDir).toBe(first.workDir);
  expect(fs.readFileSync(path.join(replacement.workDir, 'draft.txt'), 'utf8')).toBe('Keep this edit\n');
  expect(replacement.runId).not.toBe(first.runId);
  const old = await h.runCrew(['done'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'stale', CREW_RUN_ID: first.runId });
  expect(old.exitCode).toBe(1); expect(old.stderr).toContain('retired as stale');
  expect(h.getTask('stale')?.assigneeAgentId).toBe('replacement');
});

it('reconnect refuses the retired task/run while allowing different new work', async () => {
  await setup();
  await h.createTask({ id: 'old', title: 'Old', description: '' });
  const old = await poll(); clock.advance(11000);
  const joined = await h.runCrew(['join'], { CREW_AGENT_TOKEN: h.agentToken });
  expect(joined.exitCode).toBe(0); expect(joined.stdout).toContain('retired as stale');
  expect(agent().status).toBe('idle');
  expect((await poll()).retryIn).toBe(1); // cannot immediately reclaim its own stale work
  await h.createTask({ id: 'new', title: 'New', description: '' });
  expect((await poll()).task.id).toBe('new');
  const late = await h.runCrew(['update', 'Old write'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'old', CREW_RUN_ID: old.runId });
  expect(late.exitCode).toBe(1); expect(late.stderr).toContain('retired as stale');
  expect(h.getMessages('old')).toHaveLength(0);
});

it('restart grants a full configured grace window without rewriting persisted heartbeat', async () => {
  await setup();
  await h.createTask({ id: 'restart', title: 'Restart', description: '' }); await poll();
  const heartbeat = agent().lastHeartbeatAt;
  await h.server.close(); clock.advance(60000);
  h.server = await startServer({ port: 0, db: h.db, scheduler: h.scheduler, runner: h.runner, dispatcher: h.dispatcher, worktreeManager: h.worktreeManager, clock, staleScanIntervalMs: 1000 });
  await fetch(h.server.url + '/api/control/resume', { method: 'POST', headers: { [SECRET_HEADER]: h.server.perStartSecret } });
  expect(agent().lastHeartbeatAt).toEqual(heartbeat);
  expect(h.server.pullStaleScanner.scanOnce()).toEqual([]);
  clock.advance(9000); expect(agent().status).toBe('idle');
  clock.advance(2000); expect(agent().status).toBe('stale');
  expect(h.getTask('restart')).toMatchObject({ status: 'ready', retries: 0 });
  const replacementUrl = h.server.url;
  await h.cleanup(); cleaned = true;
  clock.advance(60000); // no scanner may access the database after harness shutdown
  const closed = await fetch(replacementUrl + '/health').then(() => false, () => true);
  expect(closed).toBe(true);
});

it('stop-all suspends stale evaluation and resume grants grace before recovery', async () => {
  await setup();
  await h.createTask({ id: 'stopped', title: 'Stop', description: '' }); await poll();
  expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
  clock.advance(60000); expect(h.server.pullStaleScanner.scanOnce()).toEqual([]);
  expect(agent().status).toBe('stopped'); expect(h.getTask('stopped')?.status).toBe('doing');
  expect((await h.runCrew(['resume'])).exitCode).toBe(0);
  clock.advance(9000); expect(agent().status).toBe('idle');
  clock.advance(2000); expect(agent().status).toBe('stale');
  expect(h.getTask('stopped')?.retries).toBe(0);
});

it('idle Pull agents become disconnected without a requeue; spawn agents are untouched', async () => {
  await setup();
  h.addAgent('spawn');
  await h.runCrew(['join'], { CREW_AGENT_TOKEN: h.agentToken });
  clock.advance(11000);
  expect(agent().status).toBe('idle'); expect(runs()).toHaveLength(0);
  const response = await fetch(h.server.url + '/api/agents', { headers: { [SECRET_HEADER]: h.server.perStartSecret } });
  const data = await response.json() as { agents: { id: string; status: string; tokenHash?: string }[] };
  expect(data.agents.find(a => a.id === h.agentId)?.status).toBe('disconnected');
  expect(data.agents.find(a => a.id === 'spawn')?.status).toBe('idle');
  expect(data.agents.every(a => a.tokenHash === undefined)).toBe(true);
});

it('overlapping scanner passes and done produce one safe outcome without duplicate transitions', async () => {
  await setup();
  await h.createTask({ id: 'race', title: 'Race', description: '' }); const work = await poll();
  const done = h.runCrew(['done'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'race', CREW_RUN_ID: work.runId });
  clock.advance(11000);
  const affected = await Promise.all([Promise.resolve(h.server.pullStaleScanner.scanOnce()), Promise.resolve(h.server.pullStaleScanner.scanOnce())]);
  const result = await done;
  expect(affected.flat()).toHaveLength(0); // interval already ran the single recovery
  expect(h.getTask('race')).toMatchObject({ status: 'ready', retries: 0 });
  expect(result.exitCode).toBe(1);
  expect(runs()).toHaveLength(1); expect(runs()[0].exitReason).toBe('stale');
});

it('done activity wins before expiry and scanner never requeues verifying work', async () => {
  await setup();
  await h.createTask({ id: 'finished', title: 'Finish', description: '' }); const work = await poll();
  clock.advance(9000);
  const done = await h.runCrew(['done'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'finished', CREW_RUN_ID: work.runId });
  expect(done.exitCode).toBe(0); clock.advance(20000);
  expect(h.getTask('finished')?.status).toBe('verifying'); expect(agent().status).toBe('idle');
  expect(runs()[0].exitReason).toBe('done');
});

it('stale Pull phases keep the phase task/output/worktree for another Orchestrator', async () => {
  await setup();
  const role = h.addRole('orch', 'orchestrator');
  h.db.db.update(schema.agents).set({ roleId: role }).where(eq(schema.agents.id, h.agentId)).run();
  await h.server.workflow.ensureBoard(h.boardId); const first = await poll();
  fs.writeFileSync(path.join(first.workDir, 'phase-output.md'), 'Partial requirements');
  const token = h.addAgent('new-orch', role); h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, 'new-orch')).run();
  clock.advance(11000); const next = await poll(token);
  expect(next.task).toMatchObject({ id: first.task.id, kind: 'phase', retries: 0 });
  expect(next.workDir).toBe(first.workDir);
  expect(fs.readFileSync(path.join(next.workDir, 'phase-output.md'), 'utf8')).toBe('Partial requirements');
});

it('a stale Pull Reviewer keeps review pending and hands it to a different Reviewer without charging the author', async () => {
  await setup(); h.verifier.start();
  const role = h.addRole('review', 'reviewer');
  const reviewerToken = h.addAgent('old-reviewer', role);
  h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, 'old-reviewer')).run();
  await h.createTask({ id: 'review', title: 'Review', description: '' }); const work = await poll();
  fs.writeFileSync(path.join(work.workDir, 'feature.txt'), 'feature');
  await h.runCrew(['done'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'review', CREW_RUN_ID: work.runId });
  await h.waitForTaskStatus('review', 'review'); const first = await poll(reviewerToken);
  const token = h.addAgent('new-reviewer', role); h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, 'new-reviewer')).run();
  clock.advance(11000);
  // Verifier consumes the existing review -> review event asynchronously.
  await new Promise(resolve => setTimeout(resolve, 50));
  const second = await poll(token);
  expect(second.task.id).toBe(first.task.id); expect(second.runId).not.toBe(first.runId);
  expect(h.getTask('review')).toMatchObject({ status: 'review', retries: 0, reviewerAgentId: 'new-reviewer' });
  const late = await h.runCrew(['review', 'approve'], { CREW_AGENT_TOKEN: reviewerToken, CREW_TASK_ID: 'review', CREW_RUN_ID: first.runId });
  expect(late.exitCode).toBe(1); expect(late.stderr).toContain('retired as stale');
  expect(h.getTask('review')?.status).toBe('review');
});
