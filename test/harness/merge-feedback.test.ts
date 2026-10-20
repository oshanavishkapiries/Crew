import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { readyToMerge, waitForMerge } from './merge-helpers.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });

async function advanceMain() {
  fs.writeFileSync(path.join(h.repoDir, 'required.txt'), 'new\n');
  await execa('git', ['add', 'required.txt'], { cwd: h.repoDir });
  await execa('git', ['commit', '-m', 'New requirement'], { cwd: h.repoDir });
}

it('returns all re-verify failures atomically with a retry, and a fresh author fixes the rebased branch and lands', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  h.setVerifyCommands([
    { name: 'new-rule', command: 'test ! -f required.txt || grep -q fixed checkout.txt' },
    { name: 'new-rule-two', command: 'test ! -f required.txt || grep -q fixed checkout.txt' },
  ]);
  await readyToMerge(h);
  await advanceMain();
  let atomic = false;
  const unsub = h.eventBus.subscribeBoardEvents(h.boardId, e => {
    if (e.type === 'task_status_changed' && (e.data as any).from === 'merge-queue' && (e.data as any).to === 'doing') {
      atomic = h.getMessages('checkout').some(m => m.type === 'feedback' && m.body.includes('new-rule-two')) &&
        h.db.db.select().from(schema.mergeQueueItems).get()?.status === 'failed';
    }
  });
  const doing = h.waitForTaskStatus('checkout', 'doing');
  h.server.mergeQueue.start();
  await doing;
  unsub();
  expect(atomic).toBe(true);
  expect(h.getTask('checkout')?.retries).toBe(1);
  expect(h.getVerificationResults('checkout').filter(r => r.step.startsWith('merge:'))).toMatchObject([{ passed: false }, { passed: false }]);
  h.fakeAdapter.setScript([
    { type: 'git', args: ['rebase', 'main'] },
    { type: 'edit_file', filePath: 'checkout.txt', content: 'fixed\n' },
    { type: 'done', result: 'Fixed against current main' },
  ]);
  const done = waitForMerge(h, 'checkout', i => i.status === 'merged');
  h.dispatcher.start();
  await done;
  const runs = h.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, 'checkout')).all();
  expect(runs).toHaveLength(2);
  expect(runs[1].prompt).toContain('new-rule-two');
  expect(runs[1].resumedFromRunId).toBeNull();
  expect(h.getTask('checkout')?.retries).toBe(1);
  expect(fs.readFileSync(path.join(h.repoDir, 'checkout.txt'), 'utf8')).toBe('fixed\n');
});

it('escalates an exhausted merge re-verify retry without dispatching another run', async () => {
  h = await createPipelineHarness({ startVerifier: true, maxRetries: 0 });
  h.setVerifyCommands([{ name: 'new-rule', command: 'test ! -f required.txt' }]);
  await readyToMerge(h);
  await advanceMain();
  const escalated = h.waitForTaskStatus('checkout', 'escalated');
  h.server.mergeQueue.start();
  await escalated;
  expect(h.getTask('checkout')?.retries).toBe(1);
  expect(h.getMessages('checkout').filter(m => m.type === 'feedback')).toHaveLength(1);
  expect(h.scheduler.isValidTransition('merge-queue', 'doing')).toBe(true);
  expect(h.scheduler.isValidTransition('merge-queue', 'escalated')).toBe(true);
  expect(h.scheduler.isValidTransition('escalated', 'doing')).toBe(false);
  h.dispatcher.start();
  await h.dispatcher.dispatchOnce();
  expect(h.db.db.select().from(schema.runs).all()).toHaveLength(1);
});

it('escalates integration setup failure without charging an agent retry', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  h.db.db.update(schema.workspaces).set({ config: { worktreeSetup: 'case "$PWD" in */integration/*) echo integration-setup-broken; exit 7;; esac' } }).run();
  await readyToMerge(h);
  const escalated = h.waitForTaskStatus('checkout', 'escalated');
  h.server.mergeQueue.start();
  await escalated;
  expect(h.getTask('checkout')?.retries).toBe(0);
  expect(h.getMessages('checkout').find(m => m.type === 'feedback')?.body).toContain('integration-setup-broken');
});
