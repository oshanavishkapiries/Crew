import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { Runner } from '../../src/server/runner/index.js';
import { Scheduler, Dispatcher } from '../../src/server/scheduler/index.js';
import { WorktreeManager } from '../../src/server/worktree/index.js';
import { startServer } from '../../src/server/index.js';
import { createPipelineHarness, type PipelineHarness, type HarnessOptions } from './index.js';
import { FakeAdapter, type FakeScriptStep } from '../../src/adapters/fake.js';

let h: PipelineHarness;
afterEach(async () => { await h?.server.close().catch(() => {}); await h?.cleanup(); });
const tasks = () => h.db.db.select().from(schema.tasks).all();
const phase = () => h.server.workflow.snapshot(h.boardId);
const integrates = () => tasks().filter(t => t.creationPhase === 'integrate');
const finish = (text = 'Project summary\nRelease summary'): FakeScriptStep[] => [
  { type: 'edit_file', filePath: 'phase-output.md', content: text }, { type: 'phase_done' },
];
async function setup(initial = 'grill', options: HarnessOptions = {}) {
  h = await createPipelineHarness(options);
  const role = h.addRole('orch-role', 'orchestrator', { mode: 'orchestrator' });
  h.addAgent('orch', role);
  h.db.db.update(schema.boards).set({ currentPhase: initial }).run();
  if (initial !== 'dispatch') await h.server.workflow.ensureBoard(h.boardId);
  h.server.workflow.start();
}
async function runPhase(script = finish()) {
  const task = phase().task!;
  h.fakeAdapter.setScript(script);
  await h.dispatcher.dispatchOnce();
  await h.waitForTaskStatus(task.id, 'merged'); await idle();
  return task;
}
async function approve(extra: string[] = []) {
  return h.runCrew(['approve', '--board', h.boardId, '--draft', phase().draft!.id, ...extra]);
}
async function held(input: { id: string; title: string; description: string; blockedByIds?: string[] }) {
  return h.scheduler.createTask({ ...input, boardId: h.boardId, roleId: h.roleId, creationPhase: 'tickets' });
}
async function human(args: string[]) {
  const result = await h.runCrew(args); expect(result.exitCode, result.stderr).toBe(0); return result;
}
function waitForPhase(target: string) {
  if (phase().board.currentPhase === target) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { off(); reject(new Error(`Phase ${target} not reached`)); }, 15000);
    const off = h.eventBus.subscribeBoardEvents(h.boardId, event => {
      if (event.type === 'phase_changed' && phase().board.currentPhase === target) { clearTimeout(timer); off(); resolve(); }
    });
  });
}
async function idle() {
  if (!h.runner.getLiveRuns().length) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { h.runner.off('run_ended', check); reject(new Error('Runs did not finish')); }, 10000);
    function check() { if (!h.runner.getLiveRuns().length) { clearTimeout(timer); h.runner.off('run_ended', check); resolve(); } }
    h.runner.on('run_ended', check);
  });
}
async function restart() {
  await h.server.close();
  h.worktreeManager = new WorktreeManager(h.db);
  h.scheduler = new Scheduler(h.db, h.eventBus, { worktreeManager: h.worktreeManager });
  h.runner = new Runner({ db: h.db, eventBus: h.eventBus, scheduler: h.scheduler,
    adapters: { fake: h.fakeAdapter }, crewHome: h.crewHomeDir });
  h.dispatcher = new Dispatcher({ db: h.db, scheduler: h.scheduler, runner: h.runner, eventBus: h.eventBus, crewHome: h.crewHomeDir });
  h.server = await startServer({ port: 0, db: h.db, eventBus: h.eventBus, scheduler: h.scheduler,
    runner: h.runner, dispatcher: h.dispatcher, worktreeManager: h.worktreeManager, startWorkflow: true });
}
// A restarted server has a new URL/secret; invoke the real human CLI with those credentials.
async function restartedHuman(args: string[]) {
  return h.runCrew(args, { CREW_SERVER_URL: h.server.url, CREW_SECRET: h.server.perStartSecret });
}

it('walks three tickets with one dependency and two staffed roles from grill to done, with human gates and worker Q&A', async () => {
  await setup('grill', { startVerifier: true, startMergeQueue: true, adapters: { 'review-fake': new FakeAdapter([{ type: 'review', action: 'approve' }]) } });
  const frontend = h.addRole('front-role', 'frontend'); h.addAgent('front', frontend);
  const reviewer = h.addRole('review-role', 'reviewer'); h.addAgent('reviewer', reviewer, 'review-fake');
  await runPhase(finish('Build three features')); expect((await approve()).exitCode).toBe(0);
  await runPhase(finish('Three feature spec')); expect((await approve()).exitCode).toBe(0);
  await runPhase([
    { type: 'custom_command', command: 'crew ticket create --title First --role backend > first.json; crew ticket create --title Second --role frontend; crew ticket create --title Third --role backend --blocked-by "$(node -p "require(\'./first.json\').id")"' },
    ...finish('Three ticket plan'),
  ]);
  expect((await approve()).exitCode).toBe(0); expect(phase().board.currentPhase).toBe('dispatch');
  expect(tasks().filter(t => t.kind === 'phase' && t.creationPhase === 'dispatch')).toHaveLength(0);
  const work = tasks().filter(t => t.kind === 'work');
  // Run each ready ticket through dispatch, review, and merge before selecting the next script.
  for (const title of ['First', 'Second', 'Third']) {
    const task = work.find(t => t.title === title)!;
    // Stop unrelated ready tickets from starting together using the dispatch capacity.
    h.db.db.update(schema.workspaces).set({ config: { maxParallelAgents: 1 } }).run();
    if (title === 'First') {
      h.fakeAdapter.setScript([{ type: 'ask', message: 'Which feature value?' }]);
      await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus(task.id, 'blocked'); await idle();
      expect(phase().board.currentPhase).toBe('dispatch'); expect(phase().task).toBeUndefined();
      h.fakeAdapter.setResumeScript([{ type: 'edit_file', filePath: `${title}.txt`, content: title }, { type: 'custom_command', command: 'crew remember "Use independent feature files"' }, { type: 'done' }]);
      await human(['answer', task.id, 'Use First']);
    } else {
      h.fakeAdapter.setScript([{ type: 'edit_file', filePath: `${title}.txt`, content: title }, { type: 'done' }]);
      await h.dispatcher.dispatchOnce();
    }
    await h.waitForTaskStatus(task.id, 'review'); await idle();
    await h.waitForTaskStatus(task.id, 'merged', 20000);
    await idle();
    if (title === 'First') {
      const resumed = h.db.db.select().from(schema.runs).all().filter(r => r.taskId === task.id && r.kind === 'work').at(-1)!;
      expect(fs.readFileSync(resumed.logPath!, 'utf8')).toContain('Answer: Use First');
    }
    expect(h.getTask(task.id)?.assigneeAgentId).toBe(title === 'Second' ? 'front' : h.agentId);
  }
  await waitForPhase('integrate'); expect(integrates()).toHaveLength(1);
  const learning = h.db.db.select().from(schema.memory).all().find(m => m.layer === 'role')!;
  const integrated = await runPhase([
    { type: 'custom_command', command: `crew memory list --layer role > role-learnings.json; node -e 'if (!require("./role-learnings.json").some(m => m.id === "${learning.id}")) process.exit(1)' && crew memory promote ${learning.id}` }, ...finish(),
  ]);
  const run = h.db.db.select().from(schema.runs).all().find(r => r.taskId === integrated.id)!;
  expect(fs.readFileSync(run.logPath!, 'utf8')).toContain('Use independent feature files');
  expect(phase().instructions).toContain('crew memory promote');
  const endedRead = await h.runCrew(['memory', 'list', '--layer', 'role'], { CREW_AGENT_TOKEN: h.runner.getOrCreateAgentToken('orch'), CREW_TASK_ID: integrated.id });
  expect(endedRead.exitCode).toBe(0); expect(JSON.parse(endedRead.stdout)).toEqual([]);
  const draft = phase().draft!;
  const edit = path.join(h.crewHomeDir, 'edited.md'); fs.writeFileSync(edit, 'Edited project summary\nShipped three features');
  let doneEvents = 0;
  const off = h.eventBus.subscribeBoardEvents(h.boardId, e => { if (e.type === 'phase_changed' && phase().board.currentPhase === 'done') doneEvents++; });
  const results = await Promise.all([approve(['--edit', edit]), approve(['--edit', edit])]); off();
  expect(doneEvents).toBe(1);
  expect(results.filter(r => r.exitCode === 0)).toHaveLength(1);
  expect(phase().board.currentPhase).toBe('done');
  expect(h.db.db.select().from(schema.memory).all()).toContainEqual(expect.objectContaining({ title: 'Project summary', body: 'Edited project summary\nShipped three features', source: `phase:integrate:${draft.id}` }));
  expect(h.db.db.select().from(schema.memory).all().filter(m => m.source === `phase:integrate:${draft.id}`)).toHaveLength(1);
  expect(h.db.db.select().from(schema.memory).all().find(m => m.id === learning.id)?.promotedAt).not.toBeNull();
  for (const task of work) {
    expect((await execa('git', ['show', `main:${task.title}.txt`], { cwd: h.repoDir })).stdout).toBe(task.title);
    expect(h.getVerificationResults(task.id).some(r => r.step === 'review' && r.passed)).toBe(true);
  }
  expect((await execa('git', ['rev-list', '--count', 'main'], { cwd: h.repoDir })).stdout).toBe('4');
}, 90000);

it.each([0, 2])('moves a board with %s cancelled tickets to integrate exactly once', async count => {
  await setup('tickets');
  for (let i = 0; i < count; i++) { await held({ id: `cancel-${i}`, title: 'Cancelled', description: '' }); await human(['cancel', `cancel-${i}`]); }
  await runPhase(); expect((await approve()).exitCode).toBe(0);
  await Promise.all([h.server.workflow.ensureBoard(h.boardId), h.server.workflow.ensureBoard(h.boardId)]);
  expect(phase().board.currentPhase).toBe('integrate'); expect(integrates()).toHaveLength(1);
});

it.each(['retry', 'cancel'])('keeps the last escalated ticket actionable and recovers through human %s', async recovery => {
  await setup('tickets', { maxRetries: 0, startVerifier: true, startMergeQueue: true });
  await held({ id: 'last', title: 'Last feature', description: '' });
  await runPhase(); expect((await approve()).exitCode).toBe(0);
  h.fakeAdapter.setScript([{ type: 'exit', exitCode: 1 }]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus('last', 'escalated'); await idle();
  expect(phase().board.currentPhase).toBe('dispatch');
  expect(phase().problem).toContain('crew retry last'); expect(phase().problem).toContain('crew cancel last');
  const status = await fetch(`${h.server.url}/api/status`, { headers: { 'X-Crew-Secret': h.server.perStartSecret } });
  expect(JSON.stringify(await status.json())).toContain('crew retry last');
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'recovered.txt', content: 'Recovered' }, { type: 'done' }]);
  await human([recovery, 'last']);
  if (recovery === 'retry') { await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus('last', 'merged'); await idle(); }
  await waitForPhase('integrate'); expect(integrates()).toHaveLength(1); expect(phase().problem).toBeUndefined();
});

it('creates integrate once when a last merge races human cancellation', async () => {
  await setup('tickets', { startVerifier: true });
  await held({ id: 'landing', title: 'Landing', description: '' });
  await held({ id: 'cancelled', title: 'Cancelled', description: '', blockedByIds: ['landing'] });
  await runPhase(); expect((await approve()).exitCode).toBe(0);
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'landed.txt', content: 'landed' }, { type: 'done' }]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus('landing', 'merge-queue'); await idle();
  let cancel!: Promise<unknown>;
  h.server.mergeQueue.hooks.beforeRefUpdate = async () => { cancel = human(['cancel', 'cancelled']); await cancel; };
  h.server.mergeQueue.start(); await waitForPhase('integrate'); await cancel;
  await h.server.workflow.ensureBoard(h.boardId);
  expect(integrates()).toHaveLength(1); expect(h.getTask('landing')?.status).toBe('merged');
});

it('recovers dispatch completion on restart and preserves an integrate draft over another restart', async () => {
  await setup('tickets', { startVerifier: true }); await held({ id: 'last', title: 'Last', description: '' });
  await runPhase(); expect((await approve()).exitCode).toBe(0);
  h.server.workflow.stop();
  h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'last.txt', content: 'Landed before restart' }, { type: 'done' }]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus('last', 'merge-queue'); await idle();
  h.server.mergeQueue.start(); await h.waitForTaskStatus('last', 'merged');
  expect(phase().board.currentPhase).toBe('dispatch'); expect(integrates()).toHaveLength(0);
  await restart(); await waitForPhase('integrate'); expect(integrates()).toHaveLength(1);
  await runPhase(); const draft = phase().draft!; await restart();
  expect(phase().draft?.id).toBe(draft.id); expect(integrates()).toHaveLength(1);
  expect((await restartedHuman(['approve', '--board', h.boardId, '--draft', draft.id])).exitCode).toBe(0);
  expect(phase().board.currentPhase).toBe('done');
});

it('does not publish a rejected integrate summary and publishes ungated integration once', async () => {
  await setup('integrate'); await runPhase(finish('Rejected summary'));
  expect((await approve(['--reject', '--note', 'Describe release'])).exitCode).toBe(0);
  expect(h.db.db.select().from(schema.memory).all()).toHaveLength(0);
  h.db.db.update(schema.workspaces).set({ config: { workflow: { gates: { integrate: false } } } }).run();
  await runPhase(finish('Approved project and release summary'));
  expect(phase().board.currentPhase).toBe('done');
  expect(h.db.db.select().from(schema.memory).all()).toEqual([expect.objectContaining({ body: 'Approved project and release summary', source: expect.stringMatching(/^phase:integrate:/) })]);
});

it.each(['crash', 'hang', 'stop-all'])('recovers integrate %s with the human command and kills hung children', async mode => {
  let timeout!: () => void;
  await setup('integrate', { maxRetries: 0, maxRuntimeMs: 123456, clock: { now: Date.now,
    setTimeout: (cb, ms) => { if (ms === 123456) timeout = cb; return setTimeout(cb, ms); }, clearTimeout: id => clearTimeout(id) } });
  h.fakeAdapter.setScript([{ type: mode === 'crash' ? 'exit' : 'hang', exitCode: 1 }]);
  let child: number | undefined;
  const hung = new Promise<void>(resolve => { const off = h.eventBus.subscribeRunEvents('*', event => {
    if ((event.data as { grandchildPid?: number })?.grandchildPid) { child = Number((event.data as any).grandchildPid); off(); resolve(); }
  }); if (mode === 'crash') { off(); resolve(); } });
  await h.dispatcher.dispatchOnce(); await hung;
  const pid = h.runner.getLiveRuns()[0]?.pid;
  if (mode === 'stop-all') await human(['stop-all']); else if (mode === 'hang') timeout();
  await idle();
  if (mode !== 'crash') { expect(pid).toBeTypeOf('number'); expect(child).toBeTypeOf('number'); }
  if (pid) expect(() => process.kill(pid, 0)).toThrow();
  if (child) expect(() => process.kill(child!, 0)).toThrow();
  expect(phase().board.currentPhase).toBe('integrate');
  expect(phase().task?.status).toBe(mode === 'stop-all' ? 'doing' : 'escalated');
  if (mode === 'stop-all') expect(phase().task?.retries).toBe(0);
  h.fakeAdapter.setScript(finish('Recovered summary'));
  await human(mode === 'stop-all' ? ['resume'] : ['retry', phase().task!.id]);
  await h.dispatcher.dispatchOnce(); await h.waitForTaskStatus(phase().task!.id, 'merged'); await idle();
  expect((await approve()).exitCode).toBe(0); expect(phase().board.currentPhase).toBe('done');
});

it('keeps completed dispatch intact without staff and recovers with human init then resume', async () => {
  await setup('tickets'); await runPhase();
  h.db.db.update(schema.roles).set({ name: 'retired-orchestrator' }).where(eq(schema.roles.id, 'orch-role')).run();
  expect((await approve()).exitCode).not.toBe(0);
  expect(phase().board.currentPhase).toBe('dispatch'); expect(integrates()).toHaveLength(0);
  expect(phase().problem).toContain('crew init'); expect(phase().problem).toContain('crew resume');
  await human(['init']); await human(['resume']);
  expect(phase().board.currentPhase).toBe('integrate'); expect(integrates()).toHaveLength(1);
});
