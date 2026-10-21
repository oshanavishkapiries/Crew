import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import * as schema from '../../src/server/db/schema.js';
import { buildPrompt } from '../../src/server/memory/prompt.js';
import { AGENT_TOKEN_HEADER, SECRET_HEADER } from '../../src/server/api/security.js';
import { reapStaleRuns } from '../../src/server/runner/reaper.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function pull(options: Parameters<typeof createPipelineHarness>[0] = {}) {
  h = await createPipelineHarness(options);
  h.db.db.update(schema.agents).set({ mode: 'pull', personality: 'Exact and patient', systemPrompt: 'Keep edits small.' }).where(eq(schema.agents.id, h.agentId)).run();
  return h;
}
const env = () => ({ CREW_AGENT_TOKEN: h.agentToken });
const cli = (args: string[], taskId?: string) => h.runCrew(args, { ...env(), ...(taskId ? { CREW_TASK_ID: taskId } : {}) });
const runs = () => h.db.db.select().from(schema.runs).all();
async function api(endpoint: string, method = 'GET', headers: Record<string, string> = { [AGENT_TOKEN_HEADER]: h.agentToken }) {
  return fetch(h.server.url + endpoint, { method, headers });
}
async function next(wait = '0') {
  const result = await cli(['next', '--wait', wait]);
  expect(result.exitCode, result.stderr).toBe(0);
  // Assignment adds an actionable sentence after its JSON.
  const boundary = result.stdout.indexOf('\nSet CREW_TASK_ID=');
  const start = result.stdout.indexOf('{');
  return JSON.parse(result.stdout.slice(start, boundary < 0 ? undefined : boundary));
}

it('real join returns persona, role, configured rules, workDir and only project memory without echoing the token', async () => {
  await pull();
  h.db.db.update(schema.workspaces).set({ config: { roles: { backend: { defaultPrompt: 'Configured backend rules' } } } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
  h.db.db.insert(schema.memory).values({ id: 'project', workspaceId: h.workspaceId, layer: 'project', title: 'Convention', body: 'Use ESM', createdAt: new Date() }).run();
  const joined = await cli(['join', '--token', h.agentToken]);
  expect(joined.exitCode, joined.stderr).toBe(0);
  expect(joined.stdout).not.toContain(h.agentToken);
  const data = JSON.parse(joined.stdout);
  expect(data).toMatchObject({ agentId: h.agentId, connected: true, persona: 'Exact and patient', systemPrompt: 'Keep edits small.', workDir: h.repoDir, memory: [{ title: 'Convention', body: 'Use ESM' }] });
  expect(h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()?.lastHeartbeatAt).toBeInstanceOf(Date);
});

it('provisions setup, worktree, branch, run and the exact shared prompt without spawning; concurrent polls replay one assignment', async () => {
  await pull({ startDispatcher: true });
  h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: 'touch setup-ready' } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
  await h.createTask({ id: 'pull-work', title: 'Pull work', description: 'Implement it' });
  await h.dispatcher.dispatchOnce();
  expect(runs()).toHaveLength(0);
  const joined = await cli(['join']); expect(joined.exitCode).toBe(0);
  const [a, b] = await Promise.all([next(), next()]);
  expect(a.runId).toBe(b.runId);
  expect(runs()).toHaveLength(1);
  expect(runs()[0]).toMatchObject({ pid: null, sessionId: null, endedAt: null, prompt: a.prompt });
  const task = h.getTask('pull-work')!;
  expect(task.status).toBe('doing'); expect(task.branch).toMatch(/^crew\//);
  expect(fs.existsSync(path.join(a.workDir, 'setup-ready'))).toBe(true);
  const agent = h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!;
  expect(a.prompt).toBe(await buildPrompt(h.db, { task, agent, instructions: '' }));
  expect(h.runner.getLiveRuns()).toHaveLength(0);
  expect(reapStaleRuns(h.db)).toEqual({ killed: 0, ended: 0 });
  expect(runs()[0].endedAt).toBeNull();
});

it('long-polls for newly ready work, returns retryIn when empty, and validates wait values', async () => {
  await pull();
  expect(await next()).toMatchObject({ retryIn: 1, instruction: expect.stringContaining('Call crew next') });
  const waiting = next('2');
  await new Promise(resolve => setTimeout(resolve, 150));
  await h.createTask({ id: 'arriving', title: 'Arriving', description: 'Now available' });
  expect((await waiting).task.id).toBe('arriving');
  for (const value of ['-1', 'NaN', 'Infinity']) {
    expect((await api(`/api/agents/${h.agentId}/next-task?wait=${value}`)).status).toBe(400);
  }
});

it('enforces own-agent token, Pull-only endpoints, human secret/cookie separation and missing/invalid credentials', async () => {
  await pull();
  const other = h.addAgent('other');
  const endpoints = [ ['/api/agents/join', 'POST'], [`/api/agents/${h.agentId}/next-task?wait=0`, 'GET'], [`/api/agents/${h.agentId}/heartbeat`, 'POST'] ];
  for (const [endpoint, method] of endpoints) {
    expect((await api(endpoint, method, {})).status).toBe(401);
    expect((await api(endpoint, method, { [AGENT_TOKEN_HEADER]: 'invalid' })).status).toBe(401);
    expect((await api(endpoint, method, { [SECRET_HEADER]: h.server.perStartSecret })).status).toBe(401);
    expect((await api(endpoint, method, { [AGENT_TOKEN_HEADER]: other })).status).toBe(403);
  }
  h.db.db.update(schema.agents).set({ mode: 'pull' }).where(eq(schema.agents.id, 'other')).run();
  for (const [endpoint, method] of endpoints.slice(1)) expect((await api(endpoint, method, { [AGENT_TOKEN_HEADER]: other })).status).toBe(403);
  const key = await fetch(h.server.url + '/api/session/key', { method: 'POST', headers: { [SECRET_HEADER]: h.server.perStartSecret } }).then(r => r.json()) as { key: string };
  const session = await fetch(h.server.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(key) });
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  for (const [endpoint, method] of endpoints) expect((await api(endpoint, method, { Cookie: cookie, 'X-Crew-Board': '1' })).status).toBe(401);
  expect((await api('/api/agents', 'GET')).status).toBe(403);
});

it('records heartbeats from all real agent commands and the dedicated endpoint using the injected clock', async () => {
  let now = Date.now();
  await pull({ clock: { now: () => now, setTimeout, clearTimeout } });
  await cli(['join']);
  await h.createTask({ id: 'heart', title: 'Activity', description: 'Track' });
  await next();
  const heartbeat = () => h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!.lastHeartbeatAt!.getTime();
  const calls = [ () => cli(['update', 'Still working'], 'heart'), () => cli(['remember', 'Use ESM']), () => api(`/api/agents/${h.agentId}/heartbeat`, 'POST'), () => cli(['ask', 'Which version?'], 'heart'), () => next() ];
  for (const call of calls) { now += 2000; await call(); expect(heartbeat()).toBe(Math.floor(now / 1000) * 1000); }
  const before = heartbeat(); now += 2000;
  await api(`/api/agents/${h.agentId}/heartbeat`, 'POST', { [AGENT_TOKEN_HEADER]: 'bad' });
  expect(heartbeat()).toBe(before);
});

it('keeps Pull capacity shared with spawn agents, roles/workspaces/blockers isolated, and only one active task per agent', async () => {
  await pull({ maxParallelAgents: 1 });
  h.addAgent('spawn');
  const role = h.addRole('different', 'different');
  await h.createTask({ id: 'wrong-role', title: 'Wrong', description: '', roleId: role, assigneeAgentId: undefined });
  await h.createTask({ id: 'mine', title: 'Mine', description: '' });
  await h.createTask({ id: 'blocked', title: 'Blocked', description: '', blockedByIds: ['mine'] });
  await h.createTask({ id: 'spawn-work', title: 'Spawn', description: '', assigneeAgentId: 'spawn' });
  expect((await next()).task.id).toBe('mine');
  expect((await next()).task.id).toBe('mine');
  await h.dispatcher.dispatchOnce();
  expect(runs()).toHaveLength(1);
  expect(h.getTask('spawn-work')!.status).toBe('ready');
  expect(h.getTask('blocked')!.status).toBe('todo');
  expect(h.getTask('wrong-role')!.status).toBe('ready');
});

it('Pull CLI update/remember/ask waits without a child, and the answer arrives on another call and next', async () => {
  await pull({ startDispatcher: true });
  await h.createTask({ id: 'qa', title: 'Choose format', description: 'Ask first' });
  const assignment = await next();
  expect((await cli(['update', 'Considering formats'], 'qa')).exitCode).toBe(0);
  expect((await cli(['remember', 'Use a deliberate format'])).exitCode).toBe(0);
  expect((await cli(['ask', 'ESM or CJS?'], 'qa')).exitCode).toBe(0);
  expect(h.getTask('qa')?.status).toBe('blocked');
  expect(runs()[0]).toMatchObject({ exitReason: 'asked', pid: null });
  expect((await next()).blocked).toBe(true);
  expect((await h.runCrew(['answer', 'qa', 'Use ESM'])).exitCode).toBe(0);
  await h.dispatcher.dispatchOnce();
  expect(runs()).toHaveLength(1); // no session resume/spawn on human answer
  const notice = await cli(['remember', 'The human chose ESM']);
  expect(notice.stdout).toContain('Answer for qa: Use ESM');
  const resumed = await next();
  expect(resumed.workDir).toBe(assignment.workDir);
  expect(resumed.prompt).toContain('Question: ESM or CJS?');
  expect(resumed.prompt).toContain('Answer: Use ESM');
  expect(runs()).toHaveLength(2);
  expect(h.getTask('qa')?.retries).toBe(0);
  expect(h.runner.getLiveRuns()).toHaveLength(0);
});

it('Pull task runs real done → verifying → review → merge-queue → merged with a spawned fake Reviewer', async () => {
  await pull({ startDispatcher: true, startVerifier: true, startMergeQueue: true });
  const reviewerRole = h.addRole('reviewer', 'reviewer');
  h.addAgent('reviewer-agent', reviewerRole);
  h.fakeAdapter.setScript([{ type: 'review', action: 'approve', feedback: 'Looks good' }]);
  h.setVerifyCommands([{ name: 'feature-check', command: 'test -f feature.txt' }]);
  const states: string[] = [];
  h.eventBus.subscribeBoardEvents(h.boardId, event => {
    const data = event.data as { taskId?: string; to?: string };
    if (event.type === 'task_status_changed' && data.taskId === 'land' && data.to) states.push(data.to);
  });
  await h.createTask({ id: 'land', title: 'Land Pull feature', description: 'Add feature.txt' });
  const assignment = await next();
  fs.writeFileSync(path.join(assignment.workDir, 'feature.txt'), 'From Pull\n');
  const done = await cli(['done', '--result', 'Feature ready'], 'land');
  expect(done.exitCode, done.stderr).toBe(0);
  expect(done.stdout).toContain('Clear your context and run crew join again');
  await h.waitForTaskStatus('land', 'merged');
  await h.waitForLiveRuns(0);
  expect(states).toEqual(['ready', 'doing', 'verifying', 'review', 'merge-queue', 'merged']);
  expect(h.getVerificationResults('land')).toEqual(expect.arrayContaining([
    expect.objectContaining({ step: 'diff', passed: true }),
    expect.objectContaining({ step: 'feature-check', passed: true }),
    expect.objectContaining({ step: 'review', passed: true }),
    expect.objectContaining({ step: 'merge:feature-check', passed: true }),
  ]));
  expect(await execa('git', ['show', 'main:feature.txt'], { cwd: h.repoDir }).then(r => r.stdout)).toBe('From Pull');
  expect(runs().filter(run => run.agentId === h.agentId)).toMatchObject([{ pid: null, exitReason: 'done' }]);
});

it('a failed gate returns feedback on next, charges one retry, and the corrected Pull attempt merges', async () => {
  await pull({ startDispatcher: true, startVerifier: true, startMergeQueue: true });
  h.setVerifyCommands([{ name: 'required-content', command: "test \"$(cat feature.txt)\" = fixed" }]);
  await h.createTask({ id: 'fix', title: 'Fix feature', description: 'Write fixed to feature.txt' });
  const first = await next();
  fs.writeFileSync(path.join(first.workDir, 'feature.txt'), 'wrong\n');
  expect((await cli(['done'], 'fix')).exitCode).toBe(0);
  await h.waitForTaskStatus('fix', 'doing');
  expect(h.getTask('fix')!.retries).toBe(1);
  const second = await next();
  expect(second.workDir).toBe(first.workDir);
  expect(second.runId).not.toBe(first.runId);
  expect(second.prompt).toContain('Latest verification feedback:');
  expect(second.prompt).toContain('required-content');
  fs.writeFileSync(path.join(second.workDir, 'feature.txt'), 'fixed\n');
  expect((await cli(['done'], 'fix')).exitCode).toBe(0);
  await h.waitForTaskStatus('fix', 'merged');
  expect(h.getTask('fix')!.retries).toBe(1);
  expect(runs()).toHaveLength(2);
});

it('stop-all ends pid-less runs without killing, refuses writes, reports stop on next call and resumes the kept branch', async () => {
  await pull({ startDispatcher: true });
  await h.createTask({ id: 'stop-pull', title: 'Pause', description: '' });
  const first = await next();
  fs.writeFileSync(path.join(first.workDir, 'progress.txt'), 'keep\n');
  expect((await h.runCrew(['status'])).stdout).toContain('PID: n/a');
  expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
  expect(runs()[0]).toMatchObject({ pid: null, exitReason: 'stopped' });
  expect(h.getTask('stop-pull')!.status).toBe('doing');
  const rejected = await cli(['done'], 'stop-pull');
  expect(rejected.exitCode).toBe(1); expect(rejected.stdout).toContain('Crew is stopped');
  expect((await next()).instruction).toContain('Crew is stopped');
  expect((await h.runCrew(['resume'])).exitCode).toBe(0);
  const resumed = await next();
  expect(resumed.workDir).toBe(first.workDir);
  expect(fs.readFileSync(path.join(resumed.workDir, 'progress.txt'), 'utf8')).toBe('keep\n');
  expect(h.getTask('stop-pull')!.retries).toBe(0);
  expect((await cli(['update', 'Back to work'], 'stop-pull')).exitCode).toBe(0);
  const logs = await h.runCrew(['logs', 'stop-pull']);
  expect(logs.exitCode, logs.stderr).toBe(0); expect(logs.stdout).toContain('Back to work');
});

it('cancel ends the Pull run, removes its worktree, refuses late writes and reports cancellation on the next call', async () => {
  await pull();
  await h.createTask({ id: 'cancel-pull', title: 'Cancel', description: '' });
  const assignment = await next();
  expect((await h.runCrew(['cancel', 'cancel-pull'])).exitCode).toBe(0);
  expect(runs()[0]).toMatchObject({ pid: null, exitReason: 'cancelled' });
  expect(h.getTask('cancel-pull')!.status).toBe('cancelled');
  expect(fs.existsSync(assignment.workDir)).toBe(false);
  for (const args of [['update', 'Late'], ['done'], ['ask', 'Late question']]) {
    const result = await cli(args, 'cancel-pull');
    expect(result.exitCode).toBe(1); expect(result.stderr).toContain('cancelled');
  }
  expect((await cli(['remember', 'Keep a useful lesson'])).stdout).toContain('is cancelled. Stop working');
  expect((await next()).retryIn).toBe(1);
});
