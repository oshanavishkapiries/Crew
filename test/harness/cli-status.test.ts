import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function phase() {
  h = await createPipelineHarness();
  const role = h.addRole('cli-orch', 'orchestrator'); h.addAgent('orchestrator', role);
  h.db.db.update(schema.boards).set({ currentPhase: 'grill' }).run();
  await h.server.workflow.ensureBoard(h.boardId);
  return h.db.db.select().from(schema.tasks).get()!;
}
it('shows the pending gate phase, exact approval command and completed phase task', async () => {
  const task = await phase();
  await h.runTaskWithAgent(task.id, [{ type: 'edit_file', filePath: 'phase-output.md', content: 'Requirements' }, { type: 'phase_done' }]);
  const draft = h.db.db.select().from(schema.phaseOutputs).get()!;
  const result = await h.runCrew(['status']);
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(`Board ${h.boardId}: grill`);
  expect(result.stdout).toContain(`Pending grill gate: ${draft.id}`);
  expect(result.stdout).toContain(`crew approve --board ${h.boardId} --draft ${draft.id}`);
  expect(result.stdout).toContain(`Phase task ${task.id}: merged`);
});
it('shows an escalated phase task with a working retry recovery command', async () => {
  const task = await phase(); h.db.db.update(schema.workspaces).set({ config: { maxRetries: 0 } }).run();
  await h.runTaskWithAgent(task.id, [{ type: 'exit', exitCode: 1 }]);
  const result = await h.runCrew(['status']);
  expect(result.stdout).toContain(`Phase task ${task.id}: escalated`);
  expect(result.stdout).toContain(`crew retry ${task.id}`);
  expect((await h.runCrew(['retry', task.id])).exitCode).toBe(0);
});
it('shows nothing pending on a complete empty board and renders missing-team problems unchanged', async () => {
  h = await createPipelineHarness();
  h.db.db.update(schema.boards).set({ currentPhase: 'done' }).run();
  const empty = await h.runCrew(['status']);
  expect(empty.exitCode).toBe(0); expect(empty.stdout).toContain(`Board ${h.boardId}: done`);
  expect(empty.stdout).not.toContain('crew approve'); expect(empty.stdout).not.toContain('crew retry');
  h.db.db.update(schema.boards).set({ currentPhase: 'grill' }).run();
  const problem = h.server.workflow.snapshot(h.boardId).problem!;
  expect((await h.runCrew(['status'])).stdout).toContain(`Attention: ${problem}`);
});
it('shows per-board dispatch work-ticket counts without phase tasks', async () => {
  h = await createPipelineHarness();
  await h.scheduler.createTask({ id: 'historical-phase', boardId: h.boardId, title: 'Grill phase', description: 'Earlier phase', kind: 'phase', creationPhase: 'grill', roleId: h.roleId });
  await h.createTask({ id: 'ticket-ready', title: 'Ready ticket', description: 'Work' });
  await h.createTask({ id: 'ticket-cancelled', title: 'Cancelled ticket', description: 'Work' });
  expect((await h.runCrew(['cancel', 'ticket-cancelled'])).exitCode).toBe(0);
  h.db.db.insert(schema.boards).values({ id: 'other-progress-board', workspaceId: h.workspaceId, currentPhase: 'dispatch', createdAt: new Date() }).run();
  await h.createTask({ id: 'other-progress-ticket', title: 'Other board', description: 'Work' });
  h.db.db.update(schema.tasks).set({ boardId: 'other-progress-board' }).where(eq(schema.tasks.id, 'other-progress-ticket')).run();
  const result = await h.runCrew(['status']);
  expect(result.stdout).toContain('Tickets (2): ready: 1, cancelled: 1');
  expect(result.stdout).toContain('Tickets (1): ready: 1');
});
it('combines status, role, board and assignee filters and accepts exact names or IDs', async () => {
  h = await createPipelineHarness(); const qa = h.addRole('role-qa', 'qa'); h.addAgent('qa-agent', qa);
  await h.createTask({ id: 'filter-backend', title: 'Backend match', description: 'Work' });
  await h.createTask({ id: 'filter-qa', title: 'QA match', description: 'Work', roleId: qa, assigneeAgentId: 'qa-agent' });
  await h.createTask({ id: 'filter-cancelled', title: 'Old backend', description: 'Work' });
  await h.runCrew(['cancel', 'filter-cancelled']);
  h.db.db.insert(schema.boards).values({ id: 'other-board', workspaceId: h.workspaceId, currentPhase: 'dispatch', createdAt: new Date() }).run();
  await h.createTask({ id: 'filter-other-board', title: 'Other board', description: 'Work' });
  h.db.db.update(schema.tasks).set({ boardId: 'other-board' }).where(eq(schema.tasks.id, 'filter-other-board')).run();
  for (const [role, agent] of [[h.roleId, h.agentId], ['backend', 'Fake Backend Agent']]) {
    const result = await h.runCrew(['tasks', '--status', 'ready', '--role', role, '--board', h.boardId, '--assignee', agent]);
    expect(result.exitCode, result.stderr).toBe(0); expect(result.stdout).toContain('filter-backend');
    for (const id of ['filter-qa', 'filter-cancelled', 'filter-other-board']) expect(result.stdout).not.toContain(id);
  }
  const qaResult = await h.runCrew(['tasks', '--role', 'qa']); expect(qaResult.stdout).toContain('filter-qa'); expect(qaResult.stdout).not.toContain('filter-backend');
  const cancelled = await h.runCrew(['tasks', '--status', 'cancelled']); expect(cancelled.stdout).toContain('filter-cancelled'); expect(cancelled.stdout).not.toContain('filter-backend');
  const none = await h.runCrew(['tasks', '--status', 'ready', '--assignee', 'qa-agent', '--role', 'backend']);
  expect(none.exitCode).toBe(0); expect(none.stdout).toContain('No tasks found.');
});
it.each(['status', 'role', 'board', 'assignee'])('rejects an invalid %s filter with valid choices and help', async flag => {
  h = await createPipelineHarness();
  const result = await h.runCrew(['tasks', `--${flag}`, 'not-a-value']);
  expect(result.exitCode).not.toBe(0); expect(result.stderr).toContain(`Invalid --${flag}`);
  expect(result.stderr).toContain('crew tasks --help'); expect(result.stderr).toContain('Valid');
});
it('shows the full command descriptions and filter flags in real help', async () => {
  h = await createPipelineHarness();
  for (const cmd of ['init', 'ticket', 'assign', 'memory', 'remember', 'phase', 'approve', 'status', 'tasks']) {
    const result = await h.runCrew([cmd, '--help']); expect(result.exitCode).toBe(0);
    if (cmd === 'tasks') { for (const flag of ['--status', '--role', '--board', '--assignee']) expect(result.stdout).toContain(flag); }
    if (cmd === 'approve') expect(result.stdout).toContain('rejection starts a fresh phase run');
  }
});

it('accepts registered filters without tasks and requires IDs for ambiguous names', async () => {
  h = await createPipelineHarness();
  const empty = h.addRole('empty-role', 'empty');
  h.addAgent('empty-agent', empty);
  const noTasks = await h.runCrew(['tasks', '--role', 'empty', '--assignee', 'empty-agent', '--board', h.boardId]);
  expect(noTasks.exitCode).toBe(0); expect(noTasks.stdout).toBe('No tasks found.');
  h.addRole('another-empty-role', 'empty');
  const ambiguous = await h.runCrew(['tasks', '--role', 'empty']);
  expect(ambiguous.exitCode).not.toBe(0); expect(ambiguous.stderr).toContain('another-empty-role');
  expect((await h.runCrew(['tasks', '--role', 'empty-role'])).exitCode).toBe(0);
});
