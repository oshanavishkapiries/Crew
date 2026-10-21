import fs from 'node:fs';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import type { FakeScriptStep } from '../../src/adapters/fake.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
const finish = (body: string): FakeScriptStep[] => [
  { type: 'edit_file', filePath: 'phase-output.md', content: body }, { type: 'phase_done' },
];
const drafts = () => h.db.db.select().from(schema.phaseOutputs).all();
const tasks = () => h.db.db.select().from(schema.tasks).all();
async function setup(phase = 'grill') {
  h = await createPipelineHarness();
  const role = h.addRole('early-orch', 'orchestrator', { mode: 'orchestrator' });
  h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: phase }).run();
  await h.server.workflow.ensureBoard(h.boardId);
}
async function dispatch(script: FakeScriptStep[]) {
  h.fakeAdapter.setScript(script);
  const task = tasks().find(t => t.kind === 'phase' && t.status === 'ready')!;
  await h.dispatcher.dispatchOnce();
  await h.waitForTaskStatus(task.id, 'merged', 45000);
  await h.waitForLiveRuns(0);
  return task;
}
async function approve(extra: string[] = []) {
  const draft = drafts().find(o => o.status === 'draft')!;
  return h.runCrew(['approve', '--board', h.boardId, '--draft', draft.id, ...extra]);
}

it.each([false, true])('grills through crew ask and protects the answer through next runs (fallback=%s)', async fallback => {
  await setup();
  h.fakeAdapter.refuseResume = fallback;
  h.fakeAdapter.setScript([{ type: 'ask', message: 'Which deployment target?' }]);
  const grill = tasks()[0];
  await h.dispatcher.dispatchOnce();
  await h.waitForTaskStatus(grill.id, 'blocked'); await h.waitForLiveRuns(0);
  expect(h.getMessages(grill.id).some(m => m.type === 'question' && m.body === 'Which deployment target?')).toBe(true);
  h.fakeAdapter.setScript(finish('Requirements: staging'));
  h.fakeAdapter.setResumeScript(finish('Requirements: staging'));
  expect((await h.runCrew(['answer', grill.id, 'Use staging service'])).exitCode).toBe(0);
  await h.waitForTaskStatus(grill.id, 'merged'); await h.waitForLiveRuns(0);
  expect((await approve()).exitCode).toBe(0);
  const spec = await dispatch(finish('Original spec'));
  const runs = h.db.db.select().from(schema.runs).all();
  expect(runs.filter(r => r.taskId === grill.id).at(-1)?.prompt).toContain('Answer: Use staging service');
  expect(runs.find(r => r.taskId === spec.id)?.prompt).toContain('Answer: Use staging service');
  expect(runs.some(r => r.exitReason === 'resume-failed')).toBe(fallback);
  for (const run of [runs.filter(r => r.taskId === grill.id).at(-1)!, runs.find(r => r.taskId === spec.id)!]) {
    expect(fs.readFileSync(run.logPath!, 'utf8')).toContain('Answer: Use staging service');
  }
  expect((await approve(['--reject', '--note', 'Add rollback'])).exitCode).toBe(0);
  expect(h.db.db.select().from(schema.memory).all()).toHaveLength(0);
  await dispatch(finish('Revised spec'));
  const file = path.join(h.repoDir, 'approved.md'); fs.writeFileSync(file, 'Edited spec with rollback');
  const specDraft = drafts().find(o => o.status === 'draft')!;
  expect((await approve(['--edit', file])).exitCode).toBe(0);
  expect(h.db.db.select().from(schema.memory).all()).toEqual([expect.objectContaining({
    layer: 'project', body: 'Edited spec with rollback', source: `phase:spec:${specDraft.id}`,
  })]);
  expect((await h.runCrew(['approve', '--board', h.boardId, '--draft', specDraft.id])).exitCode).not.toBe(0);
  expect(h.db.db.select().from(schema.memory).all()).toHaveLength(1);
  const tickets = await dispatch(finish('No tickets needed'));
  const ticketRun = h.db.db.select().from(schema.runs).all().find(r => r.taskId === tickets.id)!;
  expect(fs.readFileSync(ticketRun.logPath!, 'utf8')).toContain('Edited spec with rollback');
});

it.each([0, 1, 20])('holds %s tickets through rejection and releases only at approval', async count => {
  await setup('tickets');
  const commands: FakeScriptStep[] = Array.from({ length: count }, (_, i) => ({
    type: 'custom_command', command: `crew ticket create --title Ticket${i} --role backend`,
  }));
  if (count === 20) commands.push({
    type: 'custom_command', command: 'if crew ticket create --title Overflow --role backend; then exit 1; fi',
  });
  const planning = await dispatch([...commands, ...finish('Ticket plan')]);
  if (count === 20) {
    const run = h.db.db.select().from(schema.runs).all().find(r => r.taskId === planning.id)!;
    expect(fs.readFileSync(run.logPath!, 'utf8')).toContain('maxTicketsPerPhase');
  }
  const work = () => tasks().filter(t => t.kind === 'work');
  expect(work()).toHaveLength(count);
  expect(work().every(t => t.status === 'todo')).toBe(true);
  await h.dispatcher.dispatchOnce(); expect(h.runner.getLiveRuns()).toHaveLength(0);
  if (count === 20) {
    const over = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'tickets', '--title', 'Overflow', '--role', 'backend']);
    expect(over.exitCode).not.toBe(0); expect(over.stderr).toContain('maxTicketsPerPhase');
    expect(work()).toHaveLength(20);
  }
  const rejected = await approve(['--reject', '--note', 'Review existing tickets; do not duplicate']);
  expect(rejected.exitCode, rejected.stderr).toBe(0);
  await dispatch(finish('Revised ticket plan'));
  expect(work()).toHaveLength(count); expect(work().every(t => t.status === 'todo')).toBe(true);
  expect((await approve()).exitCode).toBe(0);
  expect(work().every(t => t.status === 'ready')).toBe(true);
  expect(h.db.db.select().from(schema.boards).get()?.currentPhase).toBe(count ? 'dispatch' : 'integrate');
  if (count) {
    h.fakeAdapter.setScript([{ type: 'edit_file', filePath: 'work.txt', content: 'Built' }, { type: 'done' }]);
    await h.dispatcher.dispatchOnce();
    await h.waitForTaskStatus(work()[0].id, 'verifying');
    await h.waitForLiveRuns(0);
  }
}, 90000);

it('keeps a bad-blocker draft intact and recovers with human cancel then approve', async () => {
  await setup('tickets');
  await dispatch([{ type: 'custom_command', command: 'crew ticket create --title Blocker --role backend' }, ...finish('Plan')]);
  const blocker = tasks().find(t => t.kind === 'work')!;
  const child = await h.runCrew(['ticket', 'create', '--board', h.boardId, '--phase', 'tickets', '--title', 'Dependent', '--role', 'backend', '--blocked-by', blocker.id]);
  expect(child.exitCode).toBe(0);
  const dependent = JSON.parse(child.stdout);
  expect((await h.runCrew(['cancel', blocker.id])).exitCode).toBe(0);
  const draft = drafts().find(o => o.status === 'draft')!;
  expect((await approve()).exitCode).not.toBe(0);
  expect(drafts().find(o => o.id === draft.id)?.status).toBe('draft');
  expect(h.getTask(dependent.id)?.status).toBe('todo');
  expect((await h.runCrew(['cancel', dependent.id])).exitCode).toBe(0);
  expect((await approve()).exitCode).toBe(0);
});

it('denies human approval, memory deletion and out-of-integrate promotion in a live Orchestrator', async () => {
  await setup('grill');
  await dispatch(finish('Human gate'));
  const gate = drafts()[0];
  h.db.db.insert(schema.boards).values({ id: 'other-board', workspaceId: h.workspaceId, currentPhase: 'tickets', createdAt: new Date() }).run();
  await h.server.workflow.ensureBoard('other-board');
  h.db.db.insert(schema.memory).values({ id: 'learning', workspaceId: h.workspaceId, layer: 'role', roleId: 'early-orch', title: 'Learning', body: 'Keep me', source: 'human', createdAt: new Date() }).run();
  // Commands must fail; their stderr is emitted in the real agent log.
  await dispatch([
    { type: 'custom_command', command: 'crew approve --board ' + h.boardId + ' --draft ' + gate.id + ' > approval.txt 2>&1; cat approval.txt' },
    { type: 'custom_command', command: 'if crew memory delete learning; then exit 1; fi' },
    { type: 'custom_command', command: 'if crew memory promote learning; then exit 1; fi' },
    ...finish('Permission checks'),
  ]);
  const logs = h.db.db.select().from(schema.runs).all();
  const denialLog = fs.readFileSync(logs.at(-1)!.logPath!, 'utf8');
  expect(denialLog).toContain('only humans can delete memory');
  expect(denialLog).toContain('only an active integrate Orchestrator can promote memory');
  expect(drafts().find(d => d.id === gate.id)?.status).toBe('draft');
  expect(fs.readFileSync(logs.at(-1)!.logPath!, 'utf8')).toContain('human command');
  expect(h.db.db.select().from(schema.memory).all()).toEqual([expect.objectContaining({ id: 'learning', promotedAt: null })]);
});

it('rejects a bad creation without losing the plan and lets the human create a corrected dependency before approval', async () => {
  await setup('tickets');
  await dispatch(finish('Dependency plan'));
  const draft = drafts().find(o => o.status === 'draft')!;
  const create = (title: string, blockers: string[] = []) => h.runCrew([
    'ticket', 'create', '--board', h.boardId, '--phase', 'tickets', '--title', title, '--role', 'backend',
    ...(blockers.length ? ['--blocked-by', blockers.join(',')] : []),
  ]);
  expect((await create('Bad', ['missing'])).exitCode).not.toBe(0);
  expect(tasks().filter(t => t.kind === 'work')).toHaveLength(0);
  expect(drafts().find(o => o.id === draft.id)?.status).toBe('draft');
  const first = JSON.parse((await create('First')).stdout);
  const second = JSON.parse((await create('Second', [first.id])).stdout);
  expect((await approve()).exitCode).toBe(0);
  expect(h.getTask(first.id)?.status).toBe('ready');
  expect(h.getTask(second.id)?.status).toBe('todo');
});

it('publishes an ungated spec once with provenance before starting tickets', async () => {
  await setup('spec');
  h.db.db.update(schema.workspaces).set({ config: { workflow: { gates: { spec: false } } } }).run();
  await dispatch(finish('Ungated approved spec'));
  const spec = drafts()[0];
  expect(spec.status).toBe('approved');
  expect(h.db.db.select().from(schema.memory).all()).toEqual([expect.objectContaining({
    body: 'Ungated approved spec', source: `phase:spec:${spec.id}`,
  })]);
  expect(tasks().find(t => t.creationPhase === 'tickets')?.status).toBe('ready');
});
