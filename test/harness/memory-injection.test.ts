import { eq } from 'drizzle-orm';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
function memory(id: string, layer: string, body: string, extra: Partial<typeof schema.memory.$inferInsert> = {}) {
  h.db.db.insert(schema.memory).values({ id, workspaceId: h.workspaceId, layer, title: id, body, source: 'human', createdAt: new Date(100000), ...extra }).run();
}
function capture() {
  const prompts: Array<{ runId: string; prompt: string }> = [];
  h.eventBus.subscribeRunEvents('*', event => {
    if (event.type === 'start') prompts.push({ runId: (event as any).runId, prompt: (event.data as any).prompt });
  });
  return prompts;
}
async function run(id: string) {
  const prompts = capture();
  await h.runTaskWithAgent(id, [{ type: 'done', result: 'Completed' }]);
  expect(prompts).toHaveLength(1);
  return prompts[0].prompt;
}

it('trims overflowing entries by relevance then age and keeps the complete prompt within the configured budget', async () => {
  h = await createPipelineHarness();
  h.db.db.update(schema.workspaces).set({ config: { memoryBudgetTokens: 300 } }).run();
  await h.createTask({ id: 'budget', title: 'Database migration', description: 'Database migration' });
  memory('irrelevant-new', 'project', 'Gardening '.repeat(45), { createdAt: new Date(400000) });
  memory('relevant-oldest', 'project', 'Database migration '.repeat(25), { createdAt: new Date(100000) });
  memory('relevant-old', 'project', 'Database migration '.repeat(25), { createdAt: new Date(200000) });
  memory('relevant-new', 'project', 'Database migration '.repeat(25), { createdAt: new Date(300000) });
  const prompt = await run('budget');
  expect(prompt.length / 4).toBeLessThanOrEqual(300);
  expect(prompt).toContain('relevant-new'); expect(prompt).toContain('relevant-old\n');
  expect(prompt).not.toContain('relevant-oldest'); expect(prompt).not.toContain('irrelevant-new');
});

it('never drops persona, role, task, acceptance criteria or current feedback even when protected text exceeds the budget', async () => {
  h = await createPipelineHarness();
  h.db.db.update(schema.workspaces).set({ config: { memoryBudgetTokens: 20 } }).run();
  h.db.db.update(schema.agents).set({ personality: 'Careful persona', systemPrompt: 'Always explain tradeoffs.' }).where(eq(schema.agents.id, h.agentId)).run();
  await h.createTask({ id: 'protected', title: 'Protected task', description: 'Full description', acceptanceCriteria: 'All criteria survive' });
  h.db.db.insert(schema.messages).values({ id: 'current', taskId: 'protected', type: 'feedback', body: 'CURRENT FEEDBACK '.repeat(40), createdAt: new Date() }).run();
  memory('optional', 'project', 'Optional memory');
  const prompt = await run('protected');
  for (const text of ['Careful persona', 'Always explain tradeoffs.', 'You are a backend test agent.', 'Task: Protected task', 'Full description', 'All criteria survive', 'CURRENT FEEDBACK '.repeat(40)]) expect(prompt).toContain(text);
  expect(prompt).not.toContain('Optional memory');
});

it('injects project and own-role memory but excludes other roles, tasks and workspaces in actual agent prompts', async () => {
  h = await createPipelineHarness();
  const roleB = h.addRole('role-b', 'frontend'); h.addAgent('agent-b', roleB);
  await h.createTask({ id: 'a', title: 'Task A', description: 'Backend' });
  await h.createTask({ id: 'b', title: 'Task B', description: 'Frontend', roleId: roleB, assigneeAgentId: 'agent-b' });
  memory('shared', 'project', 'Shared convention');
  memory('a-role', 'role', 'ROLE A PRIVATE', { roleId: h.roleId });
  memory('b-role', 'role', 'ROLE B PRIVATE', { roleId: roleB });
  memory('a-task', 'task', 'TASK A PRIVATE', { taskId: 'a' });
  memory('b-task', 'task', 'TASK B PRIVATE', { taskId: 'b' });
  h.db.db.insert(schema.workspaces).values({ id: 'foreign', name: 'Foreign', repoPath: '/foreign', createdAt: new Date() }).run();
  memory('foreign', 'project', 'FOREIGN PRIVATE', { workspaceId: 'foreign' });
  const a = await run('a'), b = await run('b');
  for (const prompt of [a, b]) { expect(prompt).toContain('Shared convention'); expect(prompt).not.toContain('FOREIGN PRIVATE'); }
  expect(a).toContain('ROLE A PRIVATE'); expect(a).toContain('TASK A PRIVATE'); expect(a).not.toContain('ROLE B PRIVATE'); expect(a).not.toContain('TASK B PRIVATE');
  expect(b).toContain('ROLE B PRIVATE'); expect(b).toContain('TASK B PRIVATE'); expect(b).not.toContain('ROLE A PRIVATE'); expect(b).not.toContain('TASK A PRIVATE');
});

it('uses the same project memory for the real verification Reviewer while keeping author role memory private', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  const reviewerRole = h.addRole('reviewer-role', 'reviewer'); h.addAgent('reviewer', reviewerRole);
  memory('project', 'project', 'Shared review convention');
  memory('author-only', 'role', 'Author private learning', { roleId: h.roleId });
  memory('review-only', 'role', 'Review private learning', { roleId: reviewerRole });
  await h.createTask({ id: 'review', title: 'Review task', description: 'Change a file', acceptanceCriteria: 'File exists' });
  const prompts = capture();
  h.fakeAdapter.setRunScripts([[{ type: 'edit_file', filePath: 'feature.txt', content: 'feature\n' }, { type: 'done', result: 'Implemented' }], [{ type: 'review', action: 'approve' }]]);
  await h.scheduler.transitionTask('review', 'doing'); await h.runner.runTask('review');
  await h.waitForTaskStatus('review', 'merge-queue'); await h.waitForLiveRuns(0);
  expect(prompts).toHaveLength(2);
  const reviewer = prompts.find(p => h.db.db.select().from(schema.runs).where(eq(schema.runs.id, p.runId)).get()?.kind === 'review')!.prompt;
  for (const p of prompts) expect(p.prompt).toContain('Shared review convention');
  expect(reviewer).toContain('Review private learning'); expect(reviewer).not.toContain('Author private learning');
  expect(reviewer).toContain('Git diff against main:'); expect(reviewer).toContain('feature.txt'); expect(reviewer).toContain('Earlier verification results:'); expect(reviewer).toContain('crew review approve');
});

it('uses configured persona, memory, feedback, Q&A and git context in the fresh-process fallback', async () => {
  h = await createPipelineHarness();
  h.db.db.update(schema.workspaces).set({ config: { roles: { backend: { defaultPrompt: 'Configured fallback role' } } } }).run();
  h.db.db.update(schema.agents).set({ personality: 'Fallback persona' }).run();
  memory('fallback-shared', 'project', 'Fallback project convention'); memory('fallback-role', 'role', 'Fallback role learning', { roleId: h.roleId });
  await h.createTask({ id: 'fallback', title: 'Fallback task', description: 'Keep local changes' });
  h.db.db.insert(schema.messages).values({ id: 'fallback-feedback', taskId: 'fallback', type: 'feedback', body: 'Fix the current issue', createdAt: new Date() }).run();
  const prompts = capture();
  await h.runTaskWithAgent('fallback', [{ type: 'edit_file', filePath: 'draft.txt', content: 'draft\n' }, { type: 'ask', message: 'Keep the draft?' }]);
  h.fakeAdapter.refuseResume = true; h.fakeAdapter.setScript([{ type: 'done', result: 'Kept draft' }]);
  const answer = await h.runCrew(['answer', 'fallback', 'Yes keep it']); expect(answer.exitCode, answer.stderr).toBe(0);
  await h.waitForTaskStatus('fallback', 'verifying'); await h.waitForLiveRuns(0);
  expect(prompts).toHaveLength(2);
  const fallback = prompts[1].prompt;
  for (const text of ['Configured fallback role', 'Fallback persona', 'Fallback project convention', 'Fallback role learning', 'Fix the current issue', 'Question: Keep the draft?', 'Answer: Yes keep it', 'draft.txt']) expect(fallback).toContain(text);
  expect(h.getTask('fallback')?.retries).toBe(0);
});

it('uses the common builder for phase task prompts and additional run instructions', async () => {
  h = await createPipelineHarness();
  const role = h.addRole('orch', 'orchestrator'); h.addAgent('orchestrator', role);
  memory('phase-shared', 'project', 'Approved project spec'); memory('phase-role', 'role', 'Orchestrator learning', { roleId: role });
  await h.scheduler.createTask({ id: 'phase', boardId: h.boardId, title: 'Spec phase', description: 'Draft a spec', kind: 'phase', creationPhase: 'spec', roleId: role, assigneeAgentId: 'orchestrator' });
  await h.scheduler.transitionTask('phase', 'doing'); const prompts = capture();
  h.fakeAdapter.setScript([{ type: 'exit', exitCode: 0 }]);
  await h.runner.runTask('phase', { prompt: 'Phase-specific instructions' });
  expect(prompts).toHaveLength(1);
  for (const text of ['You are a orchestrator agent.', 'Task: Spec phase', 'Draft a spec', 'Approved project spec', 'Orchestrator learning', 'Phase-specific instructions']) expect(prompts[0].prompt).toContain(text);
});

it('adds the parent, finished blocker results, task memory and earlier messages to task context', async () => {
  h = await createPipelineHarness();
  await h.createTask({ id: 'blocker', title: 'Finished database setup', description: 'Create schema' });
  await h.runTaskWithAgent('blocker', [{ type: 'done', result: 'Database schema created' }]);
  for (const status of ['review', 'merge-queue', 'merged'] as const) await h.scheduler.transitionTask('blocker', status);
  await h.createTask({ id: 'parent', title: 'Parent feature', description: 'Parent context' });
  await h.scheduler.createTask({ id: 'child', boardId: h.boardId, title: 'Child feature', description: 'Use database', roleId: h.roleId, assigneeAgentId: h.agentId, parentTaskId: 'parent', blockedByIds: ['blocker'] });
  memory('child-context', 'task', 'Task-specific decision', { taskId: 'child' });
  h.db.db.insert(schema.messages).values([
    { id: 'earlier', taskId: 'child', type: 'feedback', body: 'Earlier failure detail', createdAt: new Date(100000) },
    { id: 'latest', taskId: 'child', type: 'feedback', body: 'Current correction', createdAt: new Date(200000) },
    { id: 'comment', taskId: 'child', type: 'comment', body: 'Relevant earlier discussion', createdAt: new Date(100000) },
  ]).run();
  const prompt = await run('child');
  for (const text of ['Parent feature', 'Parent context', 'Finished database setup', 'Database schema created', 'Task-specific decision', 'Earlier failure detail', 'Current correction', 'Relevant earlier discussion']) expect(prompt).toContain(text);
});
