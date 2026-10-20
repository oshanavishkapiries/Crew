import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function request(method: string, route: string, body?: unknown, token?: string) {
  return fetch(`${h.server.url}/api/memory${route}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Crew-Agent-Token': token } : { 'X-Crew-Secret': h.server.perStartSecret }) }, body: body === undefined ? undefined : JSON.stringify(body) });
}
const rows = () => h.db.db.select().from(schema.memory).all();

it('curates all three layers with the real human CLI and preserves sources across edits', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'context', title: 'Context', description: 'Memory owner' });
  for (const [layer, extra] of [['project', []], ['role', ['--role', h.roleId]], ['task', ['--task', 'context']]] as const) {
    const result = await h.runCrew(['memory', 'add', '--workspace', h.workspaceId, '--layer', layer, '--title', `${layer} title`, '--body', `${layer} body`, ...extra]);
    expect(result.exitCode, result.stderr).toBe(0);
    const entry = JSON.parse(result.stdout);
    expect(entry).toMatchObject({ layer, source: 'human', promotedAt: null });
    const edited = await h.runCrew(['memory', 'edit', entry.id, '--body', 'Corrected']);
    expect(edited.exitCode, edited.stderr).toBe(0);
    expect(JSON.parse(edited.stdout)).toMatchObject({ body: 'Corrected', source: 'human' });
    const listed = await h.runCrew(['memory', 'list', '--workspace', h.workspaceId, '--layer', layer]);
    expect(JSON.parse(listed.stdout)).toEqual([JSON.parse(edited.stdout)]);
    expect((await h.runCrew(['memory', 'delete', entry.id])).exitCode).toBe(0);
  }
  expect(rows()).toHaveLength(0);
});

it('remembers only the authenticated role and isolates role and task reads across agents and workspaces', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'own', title: 'Own', description: 'Assigned' });
  const otherRole = h.addRole('other-role', 'frontend'); const otherToken = h.addAgent('other', otherRole);
  const remembered = await h.runCrew(['remember', 'Backend learning'], { CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'own' });
  expect(remembered.exitCode, remembered.stderr).toBe(0);
  const entry = JSON.parse(remembered.stdout);
  expect(entry).toMatchObject({ workspaceId: h.workspaceId, layer: 'role', roleId: h.roleId, source: `agent:${h.agentId}`, promotedAt: null });
  await request('POST', '', { workspaceId: h.workspaceId, layer: 'project', title: 'Shared', body: 'Convention' });
  await request('POST', '', { workspaceId: h.workspaceId, layer: 'task', taskId: 'own', title: 'Private task', body: 'Context' });
  const own = await (await request('GET', `?workspaceId=${h.workspaceId}`, undefined, h.agentToken)).json() as any;
  expect(own.entries).toHaveLength(3);
  const other = await (await request('GET', `?workspaceId=${h.workspaceId}`, undefined, otherToken)).json() as any;
  expect(other.entries.map((e: any) => e.title)).toEqual(['Shared']);
  expect((await request('PATCH', `/${entry.id}`, { body: 'Overwrite' }, otherToken)).status).toBe(403);
  expect((await request('DELETE', `/${entry.id}`, undefined, h.agentToken)).status).toBe(403);
  for (const spoof of [{ roleId: otherRole }, { source: 'human' }, { layer: 'project' }, { workspaceId: 'elsewhere' }]) {
    expect((await request('POST', '', { title: 'Spoof', body: 'No', ...spoof }, h.agentToken)).status).toBe(403);
  }
  h.db.db.insert(schema.workspaces).values({ id: 'elsewhere', name: 'Other', repoPath: '/other', createdAt: new Date() }).run();
  expect((await request('GET', '?workspaceId=elsewhere', undefined, h.agentToken)).status).toBe(403);
  expect(rows()).toHaveLength(3);
});

it('promotes explicitly and atomically with provenance and rejects repeated or invalid promotion', async () => {
  h = await createPipelineHarness();
  const original = (await (await request('POST', '', { title: 'Learning', body: 'Keep me' }, h.agentToken)).json() as any).entry;
  expect(rows()).toHaveLength(1);
  expect((await request('PATCH', `/${original.id}`, { promote: true }, h.agentToken)).status).toBe(403);
  const promoted = await h.runCrew(['memory', 'promote', original.id]);
  expect(promoted.exitCode, promoted.stderr).toBe(0);
  const copy = JSON.parse(promoted.stdout);
  expect(copy).toMatchObject({ layer: 'project', body: 'Keep me', roleId: null, taskId: null, source: `promotion:${original.id}:agent:${h.agentId}` });
  expect(copy.promotedAt).toBeTruthy();
  expect(rows().find(r => r.id === original.id)?.promotedAt?.toISOString()).toBe(copy.promotedAt);
  expect((await h.runCrew(['memory', 'promote', original.id])).exitCode).not.toBe(0);
  expect((await request('PATCH', `/${copy.id}`, { promote: true })).status).toBe(409);
  expect(rows()).toHaveLength(2);
});

it('rejects malformed scopes and missing credentials without writing and allows corrected requests', async () => {
  h = await createPipelineHarness();
  const noAuth = await fetch(`${h.server.url}/api/memory?workspaceId=${h.workspaceId}`);
  expect(noAuth.status).toBe(401);
  for (const invalid of [{ layer: 'unknown' }, { layer: 'role', roleId: 'missing' }, { layer: 'task', taskId: 'missing' }, { title: '' }, { source: 'agent:spoof' }]) {
    expect((await request('POST', '', { workspaceId: h.workspaceId, layer: 'project', title: 'Valid', body: 'Text', ...invalid })).status).toBe(400);
  }
  expect(rows()).toHaveLength(0);
  expect((await request('POST', '', { workspaceId: h.workspaceId, layer: 'project', title: 'Valid', body: 'Text' })).status).toBe(201);
  expect((await request('PATCH', '/missing', { body: 'Text' })).status).toBe(404);
  expect((await request('DELETE', '/missing')).status).toBe(404);
});

it('allows only a live integrate Orchestrator to promote another role learning', async () => {
  h = await createPipelineHarness();
  const entry = (await (await request('POST', '', { title: 'Learning', body: 'Promote during integrate' }, h.agentToken)).json() as any).entry;
  const role = h.addRole('orch-role', 'orchestrator'); const token = h.addAgent('orch', role);
  await h.scheduler.createTask({ id: 'integrate', boardId: h.boardId, title: 'Integrate', description: 'Summarize', roleId: role, assigneeAgentId: 'orch', kind: 'phase', creationPhase: 'integrate' });
  h.db.db.update(schema.boards).set({ currentPhase: 'integrate' }).run();
  await h.scheduler.transitionTask('integrate', 'doing');
  h.fakeAdapter.setScript([{ type: 'hang' }]); await h.runner.startRun({ taskId: 'integrate', agentId: 'orch' });
  expect((await request('PATCH', `/${entry.id}`, { promote: true, contextTaskId: 'integrate' }, token)).status).toBe(200);
  const second = (await (await request('POST', '', { title: 'Second', body: 'Stay role' }, h.agentToken)).json() as any).entry;
  await h.runCrew(['cancel', 'integrate']);
  expect((await request('PATCH', `/${second.id}`, { promote: true, contextTaskId: 'integrate' }, token)).status).toBe(409);
  expect(rows().find(r => r.id === second.id)?.promotedAt).toBeNull();
});
