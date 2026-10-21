import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createCrewDatabase, type CrewDatabase } from '../../src/server/db/index.js';
import * as schema from '../../src/server/db/schema.js';
import { EventBus } from '../../src/server/events/index.js';
import { Runner } from '../../src/server/runner/index.js';
import { Scheduler } from '../../src/server/scheduler/index.js';
import { WorktreeManager } from '../../src/server/worktree/index.js';
import { startServer } from '../../src/server/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

let h: PipelineHarness;
let restartedDb: CrewDatabase | undefined;
afterEach(async () => { if (h) { await h.server.close().catch(() => {}); restartedDb?.close(); restartedDb = undefined; await h.cleanup(); } });
const phases = ['grill', 'spec', 'tickets'];
const tasks = () => h.db.db.select().from(schema.tasks).all().filter(task => task.kind === 'phase');
const outputs = () => h.db.db.select().from(schema.phaseOutputs).all();
async function setup(phase: string) {
  h = await createPipelineHarness();
  const role = h.addRole('interrupt-orch', 'orchestrator'); h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: phase }).run();
  await h.server.workflow.ensureBoard(h.boardId);
  return tasks()[0];
}
async function human(args: string[]) {
  return h.runCrew(args, { CREW_SERVER_URL: h.server.url, CREW_SECRET: h.server.perStartSecret });
}
function event<T>(subscribe: (resolve: (value: T) => void) => () => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error('Timed out waiting for agent event')); }, 10000);
    const off = subscribe(value => { clearTimeout(timer); off(); resolve(value); });
  });
}
async function hang(taskId: string) {
  h.fakeAdapter.setScript([{ type: 'hang' }]);
  const child = event<number>(resolve => h.server.eventBus.subscribeRunEvents('*', e => {
    if ((e.data as any)?.grandchildPid) resolve(Number((e.data as any).grandchildPid));
  }));
  await h.server.dispatcher.dispatchOnce();
  const childPid = await child;
  const run = h.server.runner.getLiveRunByTaskId(taskId)!;
  expect(run).toBeDefined();
  expect(() => process.kill(run.pid!, 0)).not.toThrow();
  expect(() => process.kill(childPid, 0)).not.toThrow();
  return { run, childPid };
}
function dead(pid: number) { expect(() => process.kill(pid, 0)).toThrow(); }
async function complete(taskId: string) {
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'phase-output.md', content: `Durable draft ${taskId}` }, { type: 'phase_done' }]);
  const ended = event<void>(resolve => {
    const listener = (run: any) => { if (run.taskId === taskId) resolve(); };
    h.server.runner.on('run_ended', listener);
    return () => h.server.runner.off('run_ended', listener);
  });
  await h.server.dispatcher.dispatchOnce(); await ended;
  expect(h.getTask(taskId)?.status).toBe('merged');
  return outputs().find(output => output.taskId === taskId)!;
}
async function restart() {
  await h.server.close();
  // Open the durable database through a new connection and rebuild the runtime.
  restartedDb = createCrewDatabase({ dbPath: path.join(h.crewHomeDir, 'crew.db') });
  const eventBus = new EventBus(); const worktreeManager = new WorktreeManager(restartedDb);
  const scheduler = new Scheduler(restartedDb, eventBus, { worktreeManager });
  const runner = new Runner({ db: restartedDb, eventBus, scheduler, adapters: { fake: h.fakeAdapter }, crewHome: h.crewHomeDir, serverUrl: 'http://127.0.0.1:0' });
  h.server = await startServer({ port: 0, db: restartedDb, eventBus, worktreeManager, scheduler, runner, startWorkflow: true });
  await Promise.all([h.server.workflow.ensureBoard(h.boardId), h.server.workflow.ensureBoard(h.boardId)]);
}
async function approve(draftId: string) {
  const result = await human(['approve', '--board', h.boardId, '--draft', draftId]);
  expect(result.exitCode, result.stderr).toBe(0);
}

it.each(phases)('restarts during a live %s run, kills its process tree and completes the same task once', async phase => {
  const task = await setup(phase); const { run, childPid } = await hang(task.id);
  await restart(); await run.promise; dead(run.pid!); dead(childPid);
  expect(tasks()).toHaveLength(1); expect(h.getTask(task.id)).toMatchObject({ status: 'doing', retries: 0 });
  expect(outputs()).toHaveLength(0);
  expect((await human(['resume'])).exitCode).toBe(0);
  const draft = await complete(task.id); expect(outputs()).toHaveLength(1);
  await approve(draft.id);
  expect(outputs()[0].status).toBe('approved');
  expect(tasks()).toHaveLength(2); // tickets: zero-ticket dispatch now creates the integrate task (bullet 6)
  expect(tasks().filter(t => t.creationPhase === phase)).toHaveLength(1);
  expect(h.db.db.select().from(schema.runs).all().filter(r => r.taskId === task.id)).toHaveLength(2);
});
it.each(phases)('preserves a pending %s gate over restart and accepts human approval exactly once', async phase => {
  const task = await setup(phase); const draft = await complete(task.id);
  await restart(); expect(tasks()).toHaveLength(1);
  expect(outputs()).toEqual([draft]);
  const status = await human(['status']); expect(status.stdout).toContain(draft.id);
  await approve(draft.id);
  expect((await human(['approve', '--board', h.boardId, '--draft', draft.id])).exitCode).not.toBe(0);
  expect(outputs()[0]).toMatchObject({ id: draft.id, body: draft.body, status: 'approved' });
  expect(tasks()).toHaveLength(2); // tickets: zero-ticket dispatch now creates the integrate task (bullet 6)
  expect(tasks().filter(t => t.creationPhase === phase)).toHaveLength(1);
});
it.each(phases)('stops a live %s process tree and resumes without another task or charged retry', async phase => {
  const task = await setup(phase); const { run, childPid } = await hang(task.id);
  expect((await human(['stop-all'])).exitCode).toBe(0);
  await run.promise; dead(run.pid!); dead(childPid);
  await h.server.dispatcher.dispatchOnce(); expect(h.server.runner.getLiveRuns()).toHaveLength(0);
  expect(h.getTask(task.id)).toMatchObject({ status: 'doing', retries: 0 }); expect(tasks()).toHaveLength(1);
  expect((await human(['resume'])).exitCode).toBe(0);
  const draft = await complete(task.id); await approve(draft.id);
  expect(h.getTask(task.id)?.retries).toBe(0);
  expect(tasks().filter(t => t.creationPhase === phase)).toHaveLength(1);
});
it.each([...phases, 'integrate'])('cancels a live %s process tree and creates exactly one replacement on retry', async phase => {
  const task = await setup(phase); const { run, childPid } = await hang(task.id);
  expect((await human(['cancel', task.id])).exitCode).toBe(0);
  await run.promise; dead(run.pid!); dead(childPid);
  await h.server.workflow.ensureBoard(h.boardId); expect(tasks()).toHaveLength(1);
  const results = await Promise.all([human(['retry', task.id]), human(['retry', task.id])]);
  expect(results.filter(result => result.exitCode === 0)).toHaveLength(1);
  expect(tasks()).toHaveLength(2); const replacement = tasks().find(t => t.id !== task.id)!;
  expect(replacement).toMatchObject({ creationPhase: phase, parentTaskId: task.id, status: 'ready' });
  const draft = await complete(replacement.id); await approve(draft.id);
  expect(h.getTask(task.id)?.status).toBe('cancelled');
});
it.each(phases)('recovers an escalated %s task through the printed human retry command', async phase => {
  const task = await setup(phase);
  h.db.db.update(schema.workspaces).set({ config: { maxRetries: 0 } }).run();
  h.fakeAdapter.setScript([{ type: 'exit', exitCode: 1 }]);
  await h.server.scheduler.transitionTask(task.id, 'doing'); await h.server.runner.runTask(task.id);
  expect(h.getTask(task.id)?.status).toBe('escalated');
  expect((await human(['status'])).stdout).toContain(`crew retry ${task.id}`);
  expect((await human(['retry', task.id])).exitCode).toBe(0);
  const draft = await complete(task.id); await approve(draft.id);
  expect(tasks().filter(t => t.creationPhase === phase)).toHaveLength(1);
});
it.each([...phases, 'integrate'])('rejects workers, absent tokens and foreign workspace tokens at every %s phase endpoint without mutation', async phase => {
  const task = await setup(phase); const { run } = await hang(task.id);
  const foreignToken = h.addAgent('foreign-orch', 'interrupt-orch');
  h.db.db.insert(schema.workspaces).values({ id: 'foreign-workspace', name: 'Foreign', repoPath: '/unused', defaultBranch: 'main', createdAt: new Date() }).run();
  const { eq } = await import('drizzle-orm');
  h.db.db.update(schema.agents).set({ workspaceId: 'foreign-workspace' }).where(eq(schema.agents.id, 'foreign-orch')).run();
  const callers = [{}, { 'X-Crew-Agent-Token': h.agentToken }, { 'X-Crew-Agent-Token': foreignToken }];
  for (const headers of callers) {
    for (const endpoint of [
      `/api/tasks/${task.id}/phase`, `/api/tasks/${task.id}/phase-done`,
      `/api/boards/${h.boardId}/phase`, `/api/boards/${h.boardId}/phase/approve`,
    ]) {
      const boardGet = endpoint.endsWith('/phase') && endpoint.includes('/boards/');
      const result = await fetch(`${h.server.url}${endpoint}`, { method: boardGet ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...headers }, ...(boardGet ? {} : { body: JSON.stringify({ output: 'Spoof', draftId: 'missing' }) }) });
      expect([401, 403], endpoint).toContain(result.status);
    }
  }
  expect(outputs()).toHaveLength(0); expect(tasks()).toHaveLength(1); expect(h.getTask(task.id)?.status).toBe('doing');
  const draft = await (async () => { expect((await human(['stop-all'])).exitCode).toBe(0); await run.promise; expect((await human(['resume'])).exitCode).toBe(0); return complete(task.id); })();
  // Repeat against a real pending draft, so approval denial cannot pass on a missing gate.
  for (const headers of callers) {
    const result = await fetch(`${h.server.url}/api/boards/${h.boardId}/phase/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ draftId: draft.id }) });
    expect([401, 403]).toContain(result.status);
  }
  expect(outputs()[0].status).toBe('draft'); await approve(draft.id);
});
