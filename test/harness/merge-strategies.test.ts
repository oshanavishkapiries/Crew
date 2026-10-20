import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { afterEach, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { waitForMerge } from './merge-helpers.js';

let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
it.each(['squash', 'rebase', 'rebase-fallback'] as const)('%s merges a two-commit task with the configured history', async strategy => {
  const squash = strategy === 'squash';
  h = await createPipelineHarness({ startVerifier: true });
  const git = async (...args: string[]) => (await execa('git', args, { cwd: h.repoDir })).stdout;
  let base = await git('rev-parse', 'main');
  h.db.db.update(schema.workspaces).set({ config: { mergeStrategy: squash ? 'squash' : 'rebase' } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
  await h.createTask({ id: 'history', title: 'Combined feature', description: 'Two commits' });
  await h.runTaskWithAgent('history', [
    { type: 'edit_file', filePath: 'one.txt', content: 'one\n' },
    { type: 'git', args: ['add', 'one.txt'] },
    { type: 'git', args: ['commit', '-m', 'First author commit'] },
    { type: 'edit_file', filePath: 'two.txt', content: 'two\n' },
    { type: 'git', args: ['add', 'two.txt'] },
    { type: 'git', args: ['commit', '-m', 'Second author commit'] },
    { type: 'done', result: 'Both commits ready' },
  ]);
  await h.waitForTaskStatus('history', 'merge-queue');
  expect(await execa('git', ['rev-list', '--count', `${base}..HEAD`], { cwd: h.getTask('history')!.worktreePath! }).then(r => r.stdout)).toBe('2');
  fs.writeFileSync(path.join(h.repoDir, 'user.txt'), 'user commit\n');
  await git('add', 'user.txt');
  await git('commit', '-m', 'User advanced main');
  base = await git('rev-parse', 'main');
  if (strategy === 'rebase-fallback') {
    await git('config', 'user.name', '');
    await git('config', 'user.email', '');
  }
  const done = waitForMerge(h, 'history', i => i.status === 'merged');
  h.server.mergeQueue.start();
  await done;
  expect(await git('rev-list', '--count', `${base}..main`)).toBe(squash ? '1' : '2');
  expect(await git('log', '--format=%s', `${base}..main`)).toBe(squash ? 'Combined feature' : 'Second author commit\nFirst author commit');
  if (squash) expect(await git('log', '-1', '--format=%B')).toContain('Crew-Task: history');
  expect(fs.readFileSync(path.join(h.repoDir, 'one.txt'), 'utf8')).toBe('one\n');
  expect(fs.readFileSync(path.join(h.repoDir, 'two.txt'), 'utf8')).toBe('two\n');
  expect(await git('status', '--porcelain')).toBe('');
  if (strategy === 'rebase-fallback') expect(await git('log', '-1', '--format=%cn <%ce>')).toBe('Crew <crew@localhost>');
  expect(h.getTask('history')?.status).toBe('merged');
});
