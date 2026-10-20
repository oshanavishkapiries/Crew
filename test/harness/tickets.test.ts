import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
const human = () => ({ 'X-Crew-Secret': h.server.perStartSecret });
const agent = (token = h.agentToken) => ({ 'X-Crew-Agent-Token': token });
async function post(endpoint: string, body: unknown, credentials: Record<string, string> = human()) {
  return fetch(`${h.server.url}${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...credentials }, body: JSON.stringify(body) });
}
const ticket = (title = 'Tiny ticket') => ({ boardId: h.boardId, phase: 'dispatch', title, description: 'Implement one thing', role: 'backend', acceptanceCriteria: 'Works' });

it('creates tickets and assigns agents or roles through the real human CLI, then dispatches by role', async () => {
  h = await createPipelineHarness();
  const create = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'dispatch', '--title', 'Human ticket', '--description', 'Small change', '--role', 'backend', '--criteria', 'Has feature']);
  expect(create.exitCode, create.stderr).toBe(0);
  const task = JSON.parse(create.stdout);
  expect(h.getTask(task.id)).toMatchObject({ title: 'Human ticket', acceptanceCriteria: 'Has feature', createdBy: 'human', creationPhase: 'dispatch', status: 'ready', assigneeAgentId: null, roleId: h.roleId, kind: 'work' });
  expect((await h.runCrew(['assign', h.agentId, task.id])).exitCode).toBe(0);
  expect(h.getTask(task.id)?.assigneeAgentId).toBe(h.agentId);
  expect((await h.runCrew(['assign', 'backend', task.id])).exitCode).toBe(0);
  expect(h.getTask(task.id)?.assigneeAgentId).toBeNull();
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'ticket.txt', content: 'created through CLI\n' }, { type: 'done', result: 'Built' }]);
  await h.dispatcher.dispatchOnce();
  await h.waitForTaskStatus(task.id, 'verifying');
  await h.waitForLiveRuns(0);
  expect(h.getTask(task.id)?.assigneeAgentId).toBe(h.agentId);
  const refused = await h.runCrew(['assign', 'backend', task.id]);
  expect(refused.exitCode).not.toBe(0); expect(refused.stderr).toContain('Only todo or ready');
});

it('rejects worker and missing credentials for both creation and assignment', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'target', title: 'Target', description: 'Existing' });
  for (const [credentials, expected] of [[agent(), 403], [{}, 401]] as const) {
    expect((await post('/api/tasks', ticket(), credentials)).status).toBe(expected);
    expect((await post('/api/tasks/target/assign', { assignee: h.agentId }, credentials)).status).toBe(expected);
  }
  expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(1);
});

it('counts the quota per board and creation phase, rejects concurrent overflow and retains cancelled tickets in the count', async () => {
  h = await createPipelineHarness();
  const results = await Promise.all(Array.from({ length: 21 }, (_, i) => post('/api/tasks', ticket(`Ticket ${i}`))));
  expect(results.filter(r => r.status === 201)).toHaveLength(20);
  expect(results.filter(r => r.status === 409)).toHaveLength(1);
  expect(await results.find(r => r.status === 409)!.text()).toContain('maxTicketsPerPhase');
  const tasks = h.db.db.select().from(schema.tasks).all();
  await h.scheduler.transitionTask(tasks[0].id, 'cancelled');
  expect((await post('/api/tasks', ticket('Still over quota'))).status).toBe(409);
  h.db.db.insert(schema.boards).values({ id: 'another-board', workspaceId: h.workspaceId, currentPhase: 'dispatch', createdAt: new Date() }).run();
  expect((await post('/api/tasks', { ...ticket(), boardId: 'another-board' })).status).toBe(201);
  h.db.db.update(schema.boards).set({ currentPhase: 'integrate' }).where(eq(schema.boards.id, h.boardId)).run();
  expect((await post('/api/tasks', { ...ticket(), phase: 'integrate' })).status).toBe(201);
  expect((await post('/api/tasks', ticket('Late ticket'))).status).toBe(409);
});

it('honours configured quota and rolls back bad blockers, roles and assignees so a corrected ticket can be created', async () => {
  h = await createPipelineHarness();
  h.db.db.update(schema.workspaces).set({ config: { maxTicketsPerPhase: 1 } }).run();
  for (const invalid of [{ blockedByIds: ['missing'] }, { role: 'missing' }, { assignee: 'missing' }, { title: '' }]) {
    const bad = await post('/api/tasks', { ...ticket(), ...invalid });
    expect(bad.status).toBeGreaterThanOrEqual(400); expect(bad.status).toBeLessThan(500);
    expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(0);
  }
  const corrected = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'dispatch', '--title', 'Corrected', '--role', 'backend']);
  expect(corrected.exitCode, corrected.stderr).toBe(0);
  expect((await h.runCrew(['tasks'])).stdout).toContain('Corrected');
  expect((await post('/api/tasks', ticket())).status).toBe(409);
});

it('keeps blocker and cycle checks atomic and rejects cross-board dependencies', async () => {
  h = await createPipelineHarness();
  const a = await (await post('/api/tasks', ticket('First'))).json() as any;
  const b = await (await post('/api/tasks', { ...ticket('Dependent'), blockedByIds: [a.task.id] })).json() as any;
  expect(h.getTask(b.task.id)?.status).toBe('todo');
  await expect(h.scheduler.addDependency(a.task.id, b.task.id)).rejects.toThrow('cycle');
  expect(h.db.db.select().from(schema.taskDependencies).all()).toEqual([{ taskId: b.task.id, blockedByTaskId: a.task.id }]);
  h.db.db.insert(schema.boards).values({ id: 'other', workspaceId: h.workspaceId, createdAt: new Date() }).run();
  const bad = await post('/api/tasks', { ...ticket(), boardId: 'other', phase: 'grill', blockedByIds: [a.task.id] });
  expect(bad.status).toBe(400); expect(await bad.text()).toContain('same board');
  expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(2);
});

it('allows a live Orchestrator to create and assign through the CLI but rejects it after cancellation or phase movement', async () => {
  h = await createPipelineHarness();
  const role = h.addRole('orchestrator-role', 'orchestrator', { mode: 'orchestrator' });
  const token = h.addAgent('orchestrator', role);
  await h.scheduler.createTask({ id: 'context', boardId: h.boardId, title: 'Plan', description: 'Plan tickets', roleId: role, assigneeAgentId: 'orchestrator', kind: 'phase', creationPhase: 'dispatch' });
  h.fakeAdapter.setScript([{ type: 'hang' }]);
  await h.scheduler.transitionTask('context', 'doing');
  await h.runner.startRun({ taskId: 'context', agentId: 'orchestrator' });
  const env = { CREW_AGENT_TOKEN: token, CREW_TASK_ID: 'context' };
  const created = await h.runCrew(['ticket', 'create', '--phase', 'dispatch', '--title', 'Orchestrator ticket', '--role', 'backend'], env);
  expect(created.exitCode, created.stderr).toBe(0);
  const task = JSON.parse(created.stdout);
  expect(h.getTask(task.id)?.createdBy).toBe('agent:orchestrator');
  expect((await h.runCrew(['assign', h.agentId, task.id], env)).exitCode).toBe(0);
  h.db.db.update(schema.boards).set({ currentPhase: 'integrate' }).where(eq(schema.boards.id, h.boardId)).run();
  expect((await h.runCrew(['ticket', 'create', '--phase', 'dispatch', '--title', 'Late', '--role', 'backend'], env)).exitCode).not.toBe(0);
  expect((await h.runCrew(['cancel', 'context'])).exitCode).toBe(0);
  const late = await post('/api/tasks', { ...ticket(), phase: 'integrate', taskId: 'context' }, agent(token));
  expect(late.status).toBe(409);
  expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(2);
});

it('rejects cross-workspace assignment and creation and cannot create phase tasks through the public endpoint', async () => {
  h = await createPipelineHarness();
  h.db.db.insert(schema.workspaces).values({ id: 'elsewhere', name: 'Other', repoPath: '/elsewhere', createdAt: new Date() }).run();
  h.db.db.insert(schema.agents).values({ id: 'foreign', workspaceId: 'elsewhere', roleId: h.roleId, name: 'Foreign', cliType: 'fake', tokenHash: 'foreign-hash', createdAt: new Date() }).run();
  expect((await post('/api/tasks', { ...ticket(), assignee: 'foreign' })).status).toBe(400);
  expect((await post('/api/tasks', { ...ticket(), kind: 'phase' })).status).toBe(400);
  const task = (await (await post('/api/tasks', ticket())).json() as any).task;
  expect((await post(`/api/tasks/${task.id}/assign`, { assignee: 'foreign' })).status).toBe(400);
  expect(h.getTask(task.id)?.assigneeAgentId).toBeNull();
});


it('honours reassignment during worktree setup without starting the previous agent or charging a retry', async () => {
  h = await createPipelineHarness();
  h.addAgent('replacement');
  const task = (await (await post('/api/tasks', ticket('Reassigned during setup'))).json() as any).task;
  const setup = path.join(h.crewHomeDir, 'reassign.cjs');
  fs.writeFileSync(setup, `fetch(${JSON.stringify(`${h.server.url}/api/tasks/${task.id}/assign`)}, {
    method: 'POST', headers: ${JSON.stringify({ ...human(), 'Content-Type': 'application/json' })}, body: JSON.stringify({ assignee: 'replacement' })
  }).then(async r => { if (!r.ok) throw new Error(await r.text()); }).catch(e => { console.error(e); process.exitCode = 1; });`);
  h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: `node '${setup}'` } }).run();
  h.fakeAdapter.setScript([{ type: 'done', result: 'Assigned author completed' }]);
  await h.dispatcher.dispatchOnce();
  expect(h.db.db.select().from(schema.runs).all().filter(run => run.agentId === h.agentId)).toHaveLength(0);
  await h.dispatcher.dispatchOnce();
  await h.waitForTaskStatus(task.id, 'verifying');
  await h.waitForLiveRuns(0);
  expect(h.getTask(task.id)).toMatchObject({ assigneeAgentId: 'replacement', retries: 0 });
  expect(h.db.db.select().from(schema.runs).all().map(run => run.agentId)).toEqual(['replacement']);
});
