import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import * as schema from '../../src/server/db/schema.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });

it('lands two tasks serially on latest main, re-verifies, squashes, cleans up and promotes their dependent', async () => {
  h = await createPipelineHarness({ startVerifier: true });
  const git = async (...args: string[]) => (await execa('git', args, { cwd: h.repoDir })).stdout;
  const base = await git('rev-parse', 'main');
  await git('switch', '-c', 'user-work');
  // The user's hooks must never run for Crew's merge commit or rebase.
  const hooks = path.join(h.repoDir, '.git/hooks');
  fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\nexit 89\n', { mode: 0o755 });
  fs.writeFileSync(path.join(hooks, 'pre-rebase'), '#!/bin/sh\nexit 90\n', { mode: 0o755 });
  h.setVerifyCommands([
    { name: 'check', command: 'test -f feature-a.txt || test -f feature-b.txt' },
    { name: 'b-on-latest', paths: ['feature-b.txt'], command: 'test -f feature-b.txt && git merge-base --is-ancestor main HEAD' },
    { name: 'unrelated', paths: ['never/**'], command: 'exit 1' },
  ]);
  await h.createTask({ id: 'merge-a', title: 'Feature A', description: 'A' });
  await h.createTask({ id: 'merge-b', title: 'Feature B', description: 'B' });
  await h.createTask({ id: 'dependent', title: 'Dependent', description: 'Wait', blockedByIds: ['merge-a', 'merge-b'] });
  // Both branches start before either lands, proving the second item rebases.
  await h.scheduler.transitionTask('merge-a', 'doing');
  await h.scheduler.transitionTask('merge-b', 'doing');
  for (const [id, file] of [['merge-a', 'feature-a.txt'], ['merge-b', 'feature-b.txt']]) {
    await h.runTaskWithAgent(id, [
      { type: 'edit_file', filePath: file, content: id + '\n' },
      { type: 'done', result: id },
    ]);
    await h.waitForTaskStatus(id, 'merge-queue');
  }
  // Direct agent commits use the hook; Crew's own diff gate must bypass it too.
  const phases: string[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error('merge cleanup timed out')); }, 15000);
    const unsub = h.eventBus.subscribeBoardEvents(h.boardId, (e) => {
      if (e.type !== 'merge_item_changed') return;
      const d = e.data as { taskId: string; status: string };
      const phase = `${d.taskId}:${d.status}`;
      if (phases.at(-1) !== phase) phases.push(phase);
      if (d.taskId === 'merge-b' && d.status === 'merged') { clearTimeout(timer); unsub(); resolve(); }
    });
  });
  h.server.mergeQueue.start();
  await done;
  expect(h.getTask('merge-a')?.status).toBe('merged');
  expect(h.getTask('merge-b')?.status).toBe('merged');
  expect(h.getTask('dependent')?.status).toBe('ready');
  expect(await git('rev-list', '--count', `${base}..main`)).toBe('2');
  expect(await git('log', '--format=%s', `${base}..main`)).toBe('Feature B\nFeature A');
  expect(await git('log', '--format=%B', `${base}..main`)).toContain('Crew-Task: merge-b');
  expect(await git('log', '-1', '--format=%an <%ae>|%cn <%ce>', 'main')).toBe('Fake Backend Agent <agent@crew.local>|Crew Test Runner <test@crew.local>');
  expect(await git('show', 'main:feature-a.txt')).toBe('merge-a');
  expect(await git('show', 'main:feature-b.txt')).toBe('merge-b');
  expect(await git('branch', '--show-current')).toBe('user-work');
  expect(await git('status', '--porcelain')).toBe('');
  for (const id of ['merge-a', 'merge-b']) {
    const task = h.getTask(id)!;
    expect(fs.existsSync(task.worktreePath!)).toBe(false);
    expect(await git('branch', '--list', task.branch!)).toBe('');
    expect(await git('worktree', 'list', '--porcelain')).not.toContain(task.worktreePath!);
    expect(h.getVerificationResults(id).filter(r => r.step === 'merge:check')).toMatchObject([{ passed: true }]);
  }
  expect(phases).toEqual(['merge-a:queued','merge-b:queued','merge-a:rebasing','merge-a:verifying','merge-a:merging','merge-a:merged','merge-b:rebasing','merge-b:verifying','merge-b:merging','merge-b:merged']);
  const items = h.db.db.select().from(schema.mergeQueueItems).all();
  expect(items.map(i => i.status)).toEqual(['merged', 'merged']);
  expect(items[1].commitSha).toBe(await git('rev-parse', 'main'));
  expect(items[1].output).toContain('Merged');
  const integration = path.join(h.crewHomeDir, 'integration', h.workspaceId);
  expect(await execa('git', ['symbolic-ref', '-q', 'HEAD'], { cwd: integration, reject: false }).then(r => r.exitCode)).toBe(1);
});
