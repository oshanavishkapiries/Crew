import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function setup(phase = 'grill') {
  h = await createPipelineHarness();
  const role = h.addRole('phase-orch', 'orchestrator', { mode: 'orchestrator' }); h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: phase }).run();
  await h.server.workflow.ensureBoard(h.boardId);
  return h.db.db.select().from(schema.tasks).all().find(t => t.kind === 'phase')!;
}
const outputs = () => h.db.db.select().from(schema.phaseOutputs).all();
async function complete(task: typeof schema.tasks.$inferSelect, text = 'Draft requirements') {
  const run = await h.runTaskWithAgent(task.id, [{ type: 'edit_file', filePath: 'phase-output.md', content: text }, { type: 'phase_done', filePath: 'phase-output.md' }]);
  expect(run.exitReason).toBe('done'); expect(h.getTask(task.id)?.status).toBe('merged');
  return outputs().find(o => o.status === 'draft')!;
}
async function approve(id: string, extra: string[] = []) { return h.runCrew(['approve', '--board', h.boardId, '--draft', id, ...extra]); }

it('stores a draft without verification, approves edited text once concurrently and creates one fresh next-phase task', async () => {
  const task = await setup();
  const draft = await complete(task);
  expect((await h.runCrew(['status'])).stdout).toContain(draft.id);
  expect((await approve(draft.id, ['--reject'])).exitCode).not.toBe(0);
  expect(outputs()[0].status).toBe('draft');
  expect((await h.runCrew(['phase'], { CREW_TASK_ID: task.id, CREW_AGENT_TOKEN: h.runner.getOrCreateAgentToken('orchestrator') })).exitCode).not.toBe(0);
  expect(h.getVerificationResults(task.id)).toHaveLength(0);
  const file = path.join(h.repoDir, 'edited.md'); fs.writeFileSync(file, 'Human edited requirements');
  const results = await Promise.all([approve(draft.id, ['--edit', file]), approve(draft.id, ['--edit', file])]);
  expect(results.filter(r => r.exitCode === 0)).toHaveLength(1);
  expect(outputs().find(o => o.id === draft.id)).toMatchObject({ status: 'approved', body: 'Human edited requirements' });
  expect(h.db.db.select().from(schema.boards).get()?.currentPhase).toBe('spec');
  const next = h.db.db.select().from(schema.tasks).all().filter(t => t.kind === 'phase' && t.creationPhase === 'spec');
  expect(next).toHaveLength(1); expect(next[0].id).not.toBe(task.id); expect(next[0].description).toContain('Human edited requirements');
  expect((await approve(draft.id)).exitCode).not.toBe(0); expect((await approve('missing')).exitCode).not.toBe(0);
});

it('rejects with feedback in the next fresh run without charging a retry', async () => {
  const task = await setup(); const draft = await complete(task);
  expect((await approve(draft.id, ['--reject', '--note', 'Clarify the rollback plan'])).exitCode).toBe(0);
  const next = h.db.db.select().from(schema.tasks).all().find(t => t.id !== task.id)!;
  expect(next).toMatchObject({ creationPhase: 'grill', retries: 0 });
  await complete(next, 'Revised requirements');
  const run = h.db.db.select().from(schema.runs).all().find(r => r.taskId === next.id)!;
  expect(run.prompt).toContain('Clarify the rollback plan'); expect(run.prompt).toContain('Draft requirements');
});

it('keeps a durable gate across restart and never creates a duplicate phase task', async () => {
  const task = await setup(); const draft = await complete(task);
  h.server.workflow.stop(); await h.server.close();
  const { startServer } = await import('../../src/server/index.js');
  h.server = await startServer({ port: 0, db: h.db, scheduler: h.scheduler, runner: h.runner, dispatcher: h.dispatcher, worktreeManager: h.worktreeManager });
  await Promise.all([h.server.workflow.ensureBoard(h.boardId), h.server.workflow.ensureBoard(h.boardId)]);
  expect(outputs().find(o => o.id === draft.id)?.body).toBe('Draft requirements');
  expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(1);
  const response = await fetch(`${h.server.url}/api/boards/${h.boardId}/phase`, { headers: { 'X-Crew-Secret': h.server.perStartSecret } });
  expect((await response.json() as any).draft.id).toBe(draft.id);
});

it.each(['grill', 'spec', 'tickets', 'integrate'])('recovers a failed %s phase through real human retry without moving the board', async phase => {
  const task = await setup(phase);
  h.db.db.update(schema.workspaces).set({ config: { maxRetries: 0 } }).run();
  await h.runTaskWithAgent(task.id, [{ type: 'exit', exitCode: 1 }]);
  expect(h.getTask(task.id)?.status).toBe('escalated');
  expect((await h.runCrew(['status'])).stdout).toContain(task.id);
  expect((await h.runCrew(['retry', task.id, '--note', 'Try again'])).exitCode).toBe(0);
  await complete(h.getTask(task.id)!);
  expect(h.db.db.select().from(schema.boards).get()?.currentPhase).toBe(phase);
  expect(h.getTask(task.id)?.retries).toBe(0);
});

it('rejects workers and missing tokens, and a work task cannot take the phase-only completion transition', async () => {
  const task = await setup();
  await h.createTask({ id: 'ordinary', title: 'Work', description: 'Must verify' });
  await h.scheduler.transitionTask('ordinary', 'doing');
  await expect(h.scheduler.transitionTask('ordinary', 'merged')).rejects.toThrow();
  for (const headers of [{}, { 'X-Crew-Agent-Token': h.agentToken }]) {
    for (const route of [`/api/tasks/${task.id}/phase-done`, `/api/boards/${h.boardId}/phase/approve`]) {
      const result = await fetch(`${h.server.url}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ output: 'Spoof', draftId: 'missing' }) });
      expect([401, 403]).toContain(result.status);
    }
  }
  expect(outputs()).toHaveLength(0);
});

it('resumes a stopped phase without a retry and proves its agent and child pids are gone', async () => {
  const task = await setup(); h.fakeAdapter.setScript([{ type: 'hang' }]);
  const hung = new Promise<number>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => { if ((event.data as any)?.grandchildPid) { off(); resolve(Number((event.data as any).grandchildPid)); } }); });
  await h.scheduler.transitionTask(task.id, 'doing'); const run = await h.runner.startRun({ taskId: task.id }); const child = await hung;
  expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
  expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(child, 0)).toThrow();
  expect(h.getTask(task.id)).toMatchObject({ status: 'doing', retries: 0 });
  expect((await h.runCrew(['resume'])).exitCode).toBe(0); await complete(h.getTask(task.id)!);
  expect(h.getTask(task.id)?.retries).toBe(0);
});

it('replaces a cancelled phase only on human retry and rejects its late completion', async () => {
  const task = await setup();
  h.db.db.insert(schema.messages).values([{ id: 'prior-question', taskId: task.id, type: 'question', body: 'Which deployment?', createdAt: new Date() }, { id: 'prior-answer', taskId: task.id, type: 'answer', body: 'Use the existing staging service', createdAt: new Date() }]).run();
  await h.scheduler.transitionTask(task.id, 'doing');
  h.fakeAdapter.setScript([{ type: 'hang' }]);
  const hung = new Promise<number>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => { if ((event.data as any)?.grandchildPid) { off(); resolve(Number((event.data as any).grandchildPid)); } }); });
  const run = await h.runner.startRun({ taskId: task.id }); const child = await hung;
  expect((await h.runCrew(['cancel', task.id])).exitCode).toBe(0);
  expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(child, 0)).toThrow();
  await h.server.workflow.ensureBoard(h.boardId); expect(h.db.db.select().from(schema.tasks).all()).toHaveLength(1);
  const late = await fetch(`${h.server.url}/api/tasks/${task.id}/phase-done`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Crew-Agent-Token': h.runner.getOrCreateAgentToken('orchestrator') }, body: JSON.stringify({ output: 'Late' }) });
  expect(late.status).toBe(409); expect(outputs()).toHaveLength(0);
  expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0);
  expect((await h.runCrew(['retry', task.id])).exitCode).not.toBe(0);
  const replacement = h.db.db.select().from(schema.tasks).all().find(t => t.id !== task.id)!;
  await complete(replacement); expect(h.getTask(task.id)?.status).toBe('cancelled');
  expect(h.db.db.select().from(schema.runs).all().find(run => run.taskId === replacement.id)?.prompt).toContain('Use the existing staging service');
});

it('escalates a hung phase on timeout and recovers through retry with both pids dead', async () => {
  let timeout!: () => void;
  h = await createPipelineHarness({ maxRuntimeMs: 123456, maxRetries: 0, clock: { now: Date.now, setTimeout: (cb, ms) => { if (ms === 123456) timeout = cb; return setTimeout(cb, ms); }, clearTimeout: id => clearTimeout(id) } });
  const role = h.addRole('timed-orch', 'orchestrator'); h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: 'grill' }).run(); await h.server.workflow.ensureBoard(h.boardId);
  const task = h.db.db.select().from(schema.tasks).get()!;
  const hung = new Promise<number>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => { if ((event.data as any)?.grandchildPid) { off(); resolve(Number((event.data as any).grandchildPid)); } }); });
  h.fakeAdapter.setScript([{ type: 'hang' }]); await h.scheduler.transitionTask(task.id, 'doing');
  const run = await h.runner.startRun({ taskId: task.id }); const child = await hung; timeout(); await run.promise;
  expect(h.getTask(task.id)?.status).toBe('escalated');
  expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(child, 0)).toThrow();
  expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0); await complete(h.getTask(task.id)!);
});

it('allows only one starting or live Orchestrator run for a phase and uses a detached disposable worktree', async () => {
  const task = await setup(); await h.scheduler.transitionTask(task.id, 'doing'); h.fakeAdapter.setScript([{ type: 'hang' }]);
  const attempts = await Promise.allSettled([h.runner.startRun({ taskId: task.id }), h.runner.startRun({ taskId: task.id })]);
  expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  await expect(h.runner.startRun({ taskId: task.id })).rejects.toThrow('already');
  expect(h.db.db.select().from(schema.runs).all()).toHaveLength(1);
  const { execa } = await import('execa');
  const head = await execa('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: h.getTask(task.id)!.worktreePath!, reject: false });
  expect(head.exitCode).not.toBe(0);
});

it('retains a draft through stop-all and creates a paused next phase on approval until resume', async () => {
  const task = await setup(); const draft = await complete(task);
  expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
  expect((await approve(draft.id)).exitCode).toBe(0);
  await h.dispatcher.dispatchOnce(); expect(h.runner.getLiveRuns()).toHaveLength(0);
  const next = h.db.db.select().from(schema.tasks).all().find(t => t.creationPhase === 'spec')!;
  expect(next.status).toBe('ready'); expect((await h.runCrew(['resume'])).exitCode).toBe(0);
  await complete(next);
});

it('prints phase instructions and scoped memory and lets a live Orchestrator repair an empty output request', async () => {
  const task = await setup();
  h.db.db.insert(schema.memory).values({ id: 'phase-memory', workspaceId: h.workspaceId, layer: 'project', title: 'Conventions', body: 'Shared phase convention', source: 'human', createdAt: new Date() }).run();
  const hung = new Promise<number>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => { if ((event.data as any)?.grandchildPid) { off(); resolve(Number((event.data as any).grandchildPid)); } }); });
  await h.scheduler.transitionTask(task.id, 'doing'); h.fakeAdapter.setScript([{ type: 'hang' }]); const run = await h.runner.startRun({ taskId: task.id }); const child = await hung;
  const env = { CREW_TASK_ID: task.id, CREW_AGENT_TOKEN: h.runner.getOrCreateAgentToken('orchestrator') };
  const phase = await h.runCrew(['phase'], env); expect(phase.exitCode, phase.stderr).toBe(0); expect(phase.stdout).toContain('Shared phase convention'); expect(phase.stdout).toContain('one question');
  const file = path.join(h.getTask(task.id)!.worktreePath!, 'phase-output.md'); fs.writeFileSync(file, '');
  expect((await h.runCrew(['phase', 'done', '--output', file], env)).exitCode).not.toBe(0); expect(outputs()).toHaveLength(0); expect(h.getTask(task.id)?.status).toBe('doing');
  fs.writeFileSync(file, 'Corrected output'); expect((await h.runCrew(['phase', 'done', '--output', file], env)).exitCode).toBe(0);
  await h.runner.killRun(run.id, 'done'); await run.promise; expect(outputs()[0].body).toBe('Corrected output');
  expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(child, 0)).toThrow();
});

it('shows an actionable missing-team state and recovers with init then resume', async () => {
  h = await createPipelineHarness(); h.db.db.update(schema.boards).set({ currentPhase: 'grill' }).run();
  await expect(h.server.workflow.ensureBoard(h.boardId)).rejects.toThrow('Orchestrator');
  expect((await h.runCrew(['status'])).stdout).toContain('crew init');
  expect((await h.runCrew(['init'])).exitCode).toBe(0); expect((await h.runCrew(['resume'])).exitCode).toBe(0);
  expect(h.db.db.select().from(schema.tasks).all().find(t => t.kind === 'phase')?.status).toBe('ready');
});

it('forces the scoped Orchestrator profile for phase runs and never grants the output rule to ordinary work', async () => {
  h = await createPipelineHarness(); const role = h.addRole('custom-orch', 'orchestrator', { mode: 'standard' }); h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: 'grill' }).run(); await h.server.workflow.ensureBoard(h.boardId);
  const phase = h.db.db.select().from(schema.tasks).get()!;
  const recorded: any[] = []; const build = h.fakeAdapter.buildSpawn.bind(h.fakeAdapter);
  h.fakeAdapter.buildSpawn = options => { recorded.push(options); return build(options); };
  await complete(phase);
  expect(recorded[0].permissions).toMatchObject({ mode: 'orchestrator', phaseOutputPath: path.join(recorded[0].workDir, 'phase-output.md') });
  await h.createTask({ id: 'ordinary-permissions', title: 'Work', description: 'Normal task' });
  await h.runTaskWithAgent('ordinary-permissions', [{ type: 'done', result: 'Done' }]);
  expect(recorded[1].permissions.phaseOutputPath).toBeUndefined();
});

it('rejects an old gate while the next Orchestrator run is live and leaves exactly one next-phase task', async () => {
  const first = await setup(); const draft = await complete(first); expect((await approve(draft.id)).exitCode).toBe(0);
  const next = h.db.db.select().from(schema.tasks).all().find(t => t.creationPhase === 'spec')!;
  const hung = new Promise<number>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => { if ((event.data as any)?.grandchildPid) { off(); resolve(Number((event.data as any).grandchildPid)); } }); });
  await h.scheduler.transitionTask(next.id, 'doing'); h.fakeAdapter.setScript([{ type: 'hang' }]); const run = await h.runner.startRun({ taskId: next.id }); const child = await hung;
  expect((await approve(draft.id)).exitCode).not.toBe(0);
  expect(h.db.db.select().from(schema.tasks).all().filter(t => t.creationPhase === 'spec')).toHaveLength(1);
  expect(h.runner.getLiveRuns()).toHaveLength(1); await h.runner.killRun(run.id, 'stopped'); await run.promise;
  expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(child, 0)).toThrow();
});

it.each([['grill', 'spec'], ['tickets', 'dispatch'], ['integrate', 'done']])('honours an ungated %s phase and advances to %s without an extra Orchestrator for dispatch or done', async (phase, next) => {
  const task = await setup(phase); h.db.db.update(schema.workspaces).set({ config: { workflow: { gates: { [phase]: false } } } }).run();
  await complete(task);
  expect(h.db.db.select().from(schema.boards).get()?.currentPhase).toBe(next);
  expect(outputs()[0].status).toBe('approved');
  expect(h.db.db.select().from(schema.tasks).all().filter(t => t.kind === 'phase')).toHaveLength(next === 'spec' ? 2 : 1);
});

it('runs the phase engine through the real dispatcher, waits at each gate and starts a fresh process after approval', async () => {
  const task = await setup();
  h.fakeAdapter.setRunScripts([
    [{ type: 'edit_file', filePath: 'phase-output.md', content: 'Grill requirements' }, { type: 'phase_done' }],
    [{ type: 'edit_file', filePath: 'phase-output.md', content: 'Spec draft' }, { type: 'phase_done' }],
  ]);
  h.server.workflow.start(); h.dispatcher.start();
  await h.waitForTaskStatus(task.id, 'merged'); await h.waitForLiveRuns(0);
  expect(outputs()).toHaveLength(1); const draft = outputs()[0];
  expect(h.db.db.select().from(schema.boards).get()?.currentPhase).toBe('grill');
  const specGate = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('spec gate timed out')); }, 10000);
    const off = h.eventBus.subscribeBoardEvents(h.boardId, () => { if (outputs().some(o => o.phase === 'spec' && o.status === 'draft')) { clearTimeout(timer); off(); resolve(); } });
  });
  expect((await approve(draft.id)).exitCode).toBe(0); await specGate; await h.waitForLiveRuns(0); await h.server.workflow.close();
  const runs = h.db.db.select().from(schema.runs).all(); expect(runs).toHaveLength(2);
  expect(runs.every(r => r.exitReason === 'done')).toBe(true); expect(new Set(runs.map(r => r.sessionId)).size).toBe(2);
  expect(outputs().find(o => o.phase === 'spec')).toMatchObject({ status: 'draft', body: 'Spec draft' });
  for (const phase of h.db.db.select().from(schema.tasks).all()) expect(fs.existsSync(phase.worktreePath!)).toBe(false);
});

it('escalates phase worktree setup failure without a run and resumes after repair through human retry', async () => {
  const task = await setup(); h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: 'node -e "process.exit(1)"' } }).run();
  await h.scheduler.transitionTask(task.id, 'doing'); expect(h.getTask(task.id)?.status).toBe('escalated');
  expect(h.db.db.select().from(schema.runs).all()).toHaveLength(0); expect((await h.runCrew(['status'])).stdout).toContain(`crew retry ${task.id}`);
  h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: 'node -e "require(\'fs\').writeFileSync(\'.setup-done\',\'ok\')"' } }).run();
  expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0);
  expect(fs.readFileSync(path.join(h.getTask(task.id)!.worktreePath!, '.setup-done'), 'utf8')).toBe('ok');
  await complete(h.getTask(task.id)!);
});

it('records executable spawn failure as a nonzero phase failure and recovers through retry', async () => {
  const task = await setup(); h.db.db.update(schema.workspaces).set({ config: { maxRetries: 0 } }).run();
  const build = h.fakeAdapter.buildSpawn.bind(h.fakeAdapter);
  h.fakeAdapter.buildSpawn = options => ({ ...build(options), command: '/crew-missing-phase-executable' });
  const result = await h.runTaskWithAgent(task.id, [{ type: 'done' }]); expect(result.exitCode).toBe(1);
  expect(h.getTask(task.id)?.status).toBe('escalated');
  expect(h.db.db.select().from(schema.runs).get()).toMatchObject({ exitReason: 'exited', exitCode: 1 });
  expect((await h.runCrew(['status'])).stdout).toContain(`crew retry ${task.id}`);
  h.fakeAdapter.buildSpawn = build; expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0); await complete(h.getTask(task.id)!);
});

it('escalates adapter preparation errors instead of leaving a redispatched phase orphan', async () => {
  const task = await setup(); h.db.db.update(schema.workspaces).set({ config: { maxRetries: 0 } }).run();
  const build = h.fakeAdapter.buildSpawn.bind(h.fakeAdapter);
  h.fakeAdapter.buildSpawn = () => { throw new Error('Adapter preparation failed'); };
  await expect(h.runTaskWithAgent(task.id, [])).rejects.toThrow('Adapter preparation failed');
  expect(h.getTask(task.id)?.status).toBe('escalated');
  expect(h.getMessages(task.id).some(message => message.type === 'feedback' && message.body.includes('Adapter preparation failed'))).toBe(true);
  h.fakeAdapter.buildSpawn = build; expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0); await complete(h.getTask(task.id)!);
});
