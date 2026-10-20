import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import * as schema from '../../src/server/db/schema.js';
import { WorktreeManager } from '../../src/server/worktree/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

// Observe filesystem events from the real setup process; no polling or sleeps.
function waitForFile(file: string): Promise<void> {
  if (fs.existsSync(file)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const watcher = fs.watch(path.dirname(file), () => {
      if (fs.existsSync(file)) finish();
    });
    const timer = setTimeout(() => finish(new Error(`No setup signal: ${file}`)), 10000);
    function finish(error?: Error) {
      clearTimeout(timer);
      watcher.close();
      if (error) reject(error); else resolve();
    }
  });
}

function shellQuote(value: string): string { return "'" + value.replaceAll("'", "'\\''") + "'"; }

describe('Milestone 4 bullet 0: worktree setup', () => {
  let h: PipelineHarness;
  beforeEach(async () => { h = await createPipelineHarness({ startVerifier: true }); });
  afterEach(async () => { await h.cleanup(); });

  function configure(worktreeSetup: string, verifyCommands: unknown[] = []) {
    h.db.db.update(schema.workspaces).set({ config: { worktreeSetup, verifyCommands } })
      .where(eq(schema.workspaces.id, h.workspaceId)).run();
  }

  it('sets up before dispatch so verification can use installed files, and reuses setup across manager restart', async () => {
    fs.writeFileSync(path.join(h.repoDir, '.gitignore'), 'node_modules/\n');
    await execa('git', ['add', '.gitignore'], { cwd: h.repoDir });
    await execa('git', ['commit', '-m', 'ignore installed files'], { cwd: h.repoDir });
    const count = path.join(h.crewHomeDir, 'setup-count');
    configure(`mkdir -p node_modules && echo ok > node_modules/.setup-done && echo run >> ${shellQuote(count)}`, [
      { name: 'needs-setup', command: 'test "$(cat node_modules/.setup-done)" = ok' },
    ]);
    h.fakeAdapter.setScript([
      { type: 'edit_file', filePath: 'feature.txt', content: 'implemented\n' },
      { type: 'done', result: 'Ready' },
    ]);
    await h.createTask({ id: 'setup-pass', title: 'Setup pass', description: 'Use installed files' });
    h.dispatcher.start();
    await h.waitForTaskStatus('setup-pass', 'merge-queue');
    await h.waitForLiveRuns(0);
    const task = h.getTask('setup-pass')!;
    expect(h.getVerificationResults(task.id).find((v) => v.step === 'needs-setup')?.passed).toBe(true);
    const managerAfterRestart = new WorktreeManager(h.db);
    await managerAfterRestart.ensureWorktree(task);
    expect(fs.readFileSync(count, 'utf8')).toBe('run\n');
    expect((await execa('git', ['status', '--porcelain'], { cwd: task.worktreePath! })).stdout).toBe('');
    expect((await execa('git', ['worktree', 'list', '--porcelain'], { cwd: h.repoDir })).stdout).toContain(task.worktreePath);
    expect(h.getTask(task.id)?.retries).toBe(0);
    await managerAfterRestart.removeWorktree(task);
    await managerAfterRestart.ensureWorktree(task);
    expect(fs.readFileSync(count, 'utf8')).toBe('run\nrun\n');
  });


  it('runs setup once in a detached integration worktree using the shared command runner', async () => {
    const integration = path.join(h.crewHomeDir, 'integration-test');
    await execa('git', ['-c', 'core.hooksPath=', 'worktree', 'add', '--detach', integration, 'main'], { cwd: h.repoDir });
    const count = path.join(h.crewHomeDir, 'integration-setup-count');
    const config = { worktreeSetup: `echo ready > .setup-done && echo run >> ${shellQuote(count)}` };
    await h.worktreeManager.setupWorktree(integration, config, 'integration-test');
    await h.worktreeManager.setupWorktree(integration, config, 'integration-test');
    expect(fs.readFileSync(path.join(integration, '.setup-done'), 'utf8')).toBe('ready\n');
    expect(fs.readFileSync(count, 'utf8')).toBe('run\n');
    expect((await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: integration })).stdout).toBe('HEAD');
    await execa('git', ['worktree', 'remove', '--force', integration], { cwd: h.repoDir });
  });

  it('escalates a failed setup with output and no agent run or retry', async () => {
    configure('echo broken-environment >&2; exit 9');
    const events: any[] = [];
    const unsubscribe = h.eventBus.subscribeBoardEvents(h.boardId, (e) => events.push(e));
    await h.createTask({ id: 'setup-fail', title: 'Setup fails', description: 'Broken installation' });
    h.dispatcher.start();
    await h.waitForTaskStatus('setup-fail', 'escalated');
    const task = h.getTask('setup-fail')!;
    expect(task.retries).toBe(0);
    expect(h.db.db.select().from(schema.runs).all()).toHaveLength(0);
    expect(h.getMessages(task.id).map((m) => m.body).join('\n')).toContain('broken-environment');
    expect(events.find((e) => e.type === 'task_status_changed' && e.data.to === 'escalated')?.data.reason).toContain('broken-environment');
    expect(fs.existsSync(task.worktreePath!)).toBe(true);
    expect((await execa('git', ['branch', '--list', task.branch!], { cwd: h.repoDir })).stdout).toContain(task.branch);
    unsubscribe();
  });

  async function startHangingSetup() {
    const signal = path.join(h.crewHomeDir, 'setup-running');
    const worker = path.join(h.crewHomeDir, 'setup-worker.cjs');
    fs.writeFileSync(worker, `
      const { spawn } = require('node:child_process');
      const fs = require('node:fs');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
      process.on('SIGTERM', () => { child.kill('SIGTERM'); });
      child.on('exit', () => process.exit(0));
      fs.writeFileSync(${JSON.stringify(signal)}, JSON.stringify([process.pid, child.pid]));
    `);
    const once = path.join(h.crewHomeDir, 'setup-once');
    configure(`if test ! -f ${shellQuote(once)}; then touch ${shellQuote(once)}; node ${shellQuote(worker)}; fi`);
    h.fakeAdapter.setScript([
      { type: 'edit_file', filePath: 'resumed.txt', content: 'resumed\n' },
      { type: 'done', result: 'Ready' },
    ]);
    await h.createTask({ id: 'setup-interrupt', title: 'Interrupt setup', description: 'Setup child process' });
    const running = waitForFile(signal);
    h.dispatcher.start();
    await running;
    return JSON.parse(fs.readFileSync(signal, 'utf8')) as number[];
  }

  function expectGone(pids: number[]) {
    for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
  }

  it('stop-all kills setup and its child; resume completes setup without a retry', async () => {
    const pids = await startHangingSetup();
    expect((await h.runCrew(['stop-all'])).exitCode).toBe(0);
    expectGone(pids);
    expect(h.getTask('setup-interrupt')?.status).toBe('ready');
    expect(h.db.db.select().from(schema.runs).all()).toHaveLength(0);
    expect((await h.runCrew(['resume'])).exitCode).toBe(0);
    await h.waitForTaskStatus('setup-interrupt', 'merge-queue');
    await h.waitForLiveRuns(0);
    expect(h.getTask('setup-interrupt')?.retries).toBe(0);
  });

  it('cancel kills setup and its child before removing the worktree and keeps the branch', async () => {
    const pids = await startHangingSetup();
    expect((await h.runCrew(['cancel', 'setup-interrupt'])).exitCode).toBe(0);
    expectGone(pids);
    expect(h.getTask('setup-interrupt')?.status).toBe('cancelled');
    expect(h.db.db.select().from(schema.runs).all()).toHaveLength(0);
    const worktree = h.worktreeManager.getWorktreePath(h.workspaceId, 'setup-interrupt');
    expect(fs.existsSync(worktree)).toBe(false);
    expect((await execa('git', ['worktree', 'list', '--porcelain'], { cwd: h.repoDir })).stdout).not.toContain(worktree);
    expect((await execa('git', ['branch', '--list', 'crew/setup-interrupt-*'], { cwd: h.repoDir })).stdout).toContain('crew/setup-interrupt-');
  });
});
