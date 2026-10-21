import { createServer } from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function edit(id: string, body: unknown, agent = false) {
  return fetch(`${h.server.url}/api/tasks/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...(agent ? { 'X-Crew-Agent-Token': h.agentToken } : { 'X-Crew-Secret': h.server.perStartSecret }) }, body: JSON.stringify(body) });
}
async function setup() {
  h = await createPipelineHarness();
  await h.createTask({ id: 'a', title: 'A', description: 'Original' });
  await h.createTask({ id: 'b', title: 'B', description: 'Blocker' });
}
it('edits every field through the real CLI, recomputes readiness, and uses edited fields in the worker prompt', async () => {
  await setup();
  const role = h.addRole('new-role', 'writer'); h.addAgent('new-agent', role);
  const result = await h.runCrew(['ticket', 'edit', 'a', '--title', 'Edited title', '--description', 'Edited description', '--criteria', 'Edited criteria', '--role', role, '--assignee', 'new-agent', '--blocked-by', 'b']);
  expect(result.exitCode, result.stderr).toBe(0);
  expect(h.getTask('a')).toMatchObject({ title: 'Edited title', description: 'Edited description', acceptanceCriteria: 'Edited criteria', roleId: role, assigneeAgentId: 'new-agent', status: 'todo' });
  expect((await edit('a', { blockedByIds: [] })).status).toBe(200);
  expect(h.getTask('a')?.status).toBe('ready');
  await h.scheduler.transitionTask('b', 'cancelled');
  h.fakeAdapter.setScript([{ type: 'done', result: 'Built' }]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus('a', 'verifying'); await h.waitForLiveRuns(0);
  const run = h.db.db.select().from(schema.runs).all().find(r => r.taskId === 'a')!;
  const prompt = fs.readFileSync(run.logPath!, 'utf8');
  expect(prompt).toContain('Edited title'); expect(prompt).toContain('Edited description'); expect(prompt).toContain('Edited criteria');
});
it('rejects invalid fields and graph changes atomically and allows corrected edits', async () => {
  await setup();
  for (const body of [{ unknown: 'bad' }, { role: 'missing' }, { title: '' }, { assignee: 'missing' }, { blockedByIds: ['a'] }, { blockedByIds: ['missing'] }]) {
    const res = await edit('a', { title: 'Must rollback', ...body }); expect(res.status).toBeGreaterThanOrEqual(400); expect(res.status).toBeLessThan(500);
    expect(h.getTask('a')?.title).toBe('A');
  }
  expect((await edit('b', { blockedByIds: ['a'] })).status).toBe(200);
  expect((await edit('a', { blockedByIds: ['b'] })).status).toBe(409);
  await h.scheduler.transitionTask('b', 'cancelled');
  expect((await edit('a', { blockedByIds: ['b'] })).status).toBe(400);
  expect((await edit('a', { title: 'Corrected' })).status).toBe(200);
});
it('denies agent tokens and refuses edits after work starts or the board moves on with recovery guidance', async () => {
  await setup(); expect((await edit('a', { title: 'Agent edit' }, true)).status).toBe(403);
  h.db.db.update(schema.boards).set({ currentPhase: 'integrate' }).where(eq(schema.boards.id, h.boardId)).run();
  const moved = await edit('a', { title: 'Late' }); expect(moved.status).toBe(409); expect(await moved.text()).toContain('crew cancel');
  h.db.db.update(schema.boards).set({ currentPhase: 'dispatch' }).run();
  await h.scheduler.transitionTask('a', 'doing');
  expect((await edit('a', { title: 'Running' })).status).toBe(409);
  await h.scheduler.transitionTask('a', 'verifying');
  expect((await edit('a', { title: 'Done' })).status).toBe(409);
  await h.scheduler.transitionTask('a', 'review'); await h.scheduler.transitionTask('a', 'merge-queue'); await h.scheduler.transitionTask('a', 'merged');
  expect((await edit('a', { title: 'Merged' })).status).toBe(409);
});
it('serializes concurrent dependency replacements without half-edited fields', async () => {
  await setup();
  const responses = await Promise.all([edit('a', { title: 'With blocker', blockedByIds: ['b', 'b'] }), edit('a', { title: 'No blockers', blockedByIds: [] })]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  const edges = h.db.db.select().from(schema.taskDependencies).where(eq(schema.taskDependencies.taskId, 'a')).all();
  if (h.getTask('a')?.title === 'With blocker') { expect(edges).toHaveLength(1); expect(h.getTask('a')?.status).toBe('todo'); }
  else { expect(edges).toHaveLength(0); expect(h.getTask('a')?.status).toBe('ready'); }
});
it('an edit during dispatch setup prevents a newly blocked ticket from starting', async () => {
  await setup();
  let release!: () => void;
  let entered!: () => void;
  const barrier = new Promise<void>(resolve => { entered = resolve; });
  const server = createServer((_req, res) => { release = () => { res.end('ok'); server.removeAllListeners('request'); server.on('request', (_req, next) => next.end('ok')); }; entered(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const setupFile = path.join(h.crewHomeDir, 'edit.cjs');
  fs.writeFileSync(setupFile, `fetch('http://127.0.0.1:${port}').then(r=>r.text()).catch(()=>{process.exitCode=1});`);
  h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: `node '${setupFile}'` } }).run();
  h.fakeAdapter.setScript([{ type: 'hang' }]);
  const dispatch = h.dispatcher.dispatchOnce();
  try {
    await barrier;
    expect((await edit('a', { title: 'Blocked during setup', blockedByIds: ['b'] })).status).toBe(200);
    release(); await dispatch;
  } finally { server.closeAllConnections(); server.close(); }
  expect(h.getTask('a')).toMatchObject({ title: 'Blocked during setup', status: 'todo' });
  expect(h.db.db.select().from(schema.runs).all().filter(r => r.taskId === 'a')).toHaveLength(0);
});
it('edits only at a waiting tickets gate, approves the final set and releases the edited graph', async () => {
  h = await createPipelineHarness();
  const role = h.addRole('orch-role', 'orchestrator', { mode: 'orchestrator' }); h.addAgent('orch', role);
  h.db.db.update(schema.boards).set({ currentPhase: 'tickets' }).run();
  await h.server.workflow.ensureBoard(h.boardId);
  const create = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'tickets', '--title', 'Before', '--role', 'backend']);
  const a = JSON.parse(create.stdout).id;
  expect((await edit(a, { title: 'Too early' })).status).toBe(409);
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'phase-output.md', content: 'Three tickets to review' }, { type: 'phase_done' }]);
  await h.dispatcher.dispatchOnce();
  const phase = h.db.db.select().from(schema.tasks).all().find(t => t.kind === 'phase')!;
  await h.waitForTaskStatus(phase.id, 'merged'); await h.waitForLiveRuns(0);
  expect((await edit(a, { title: 'Approved edited title', description: 'Edited work' })).status).toBe(200);
  expect(h.getTask(a)?.status).toBe('todo');
  const b = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'tickets', '--title', 'Dependent', '--role', 'backend', '--blocked-by', a]);
  const bId = JSON.parse(b.stdout).id;
  const draft = h.db.db.select().from(schema.phaseOutputs).all().find(o => o.status === 'draft')!;
  const approved = await h.runCrew(['approve', '--board', h.boardId, '--draft', draft.id]);
  expect(approved.exitCode, approved.stderr).toBe(0);
  expect(h.getTask(a)).toMatchObject({ title: 'Approved edited title', status: 'ready' });
  expect(h.getTask(bId)?.status).toBe('todo');
  h.fakeAdapter.setScript([{ type: 'done', result: 'Built' }]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus(a, 'verifying'); await h.waitForLiveRuns(0);
  expect(h.db.db.select().from(schema.runs).all().find(r => r.taskId === a)?.prompt).toContain('Approved edited title');
});
