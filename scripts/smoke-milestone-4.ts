/** Manual only: real Claude Code calls. Do not include this script in npm test. */
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
import { eq } from 'drizzle-orm';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';
import { EventBus } from '../src/server/events/index.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { Runner } from '../src/server/runner/index.js';
import { Dispatcher } from '../src/server/scheduler/dispatcher.js';
import { WorktreeManager } from '../src/server/worktree/index.js';
import { startServer, type RunningServer } from '../src/server/index.js';

async function runSmoke(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const previousHome = process.env.CREW_HOME;
  const controller = new AbortController();
  const { signal } = controller;
  const timeout = setTimeout(() => controller.abort(new Error('Smoke exceeded its 8 minute wall-clock limit')), 8 * 60 * 1000);
  let db: CrewDatabase | undefined;
  let server: RunningServer | undefined;
  let runner: Runner | undefined;
  let dispatcher: Dispatcher | undefined;
  let repo = '';
  let crewHome = '';
  let printed = false;
  let releaseMerge: (() => void) | undefined;
  let hardExit: NodeJS.Timeout | undefined;
  let unsubscribe: (() => void) | undefined;
  // Fail even if a subprocess cannot be reaped during shutdown.
  const onAbort = () => {
    process.exitCode = 1;
    hardExit = setTimeout(() => { console.error('Smoke cleanup exceeded 15 seconds'); process.exit(1); }, 15000);
    hardExit.unref();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  async function bounded<T>(operation: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let abort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
    });
    try { return await Promise.race([operation(), interrupted]); }
    finally { signal.removeEventListener('abort', abort); }
  }
  const git = async (...args: string[]) => (await execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, timeout: 15000, cancelSignal: signal,
  })).stdout;
  async function diagnostics(): Promise<void> {
    if (repo) {
      const log = await execa('git', ['-c', 'core.hooksPath=/dev/null', 'log', '--oneline', 'main'], { cwd: repo, timeout: 10000 });
      console.log('\nFinal git log --oneline:\n' + log.stdout);
    }
    if (server) {
      const queue = await execa(process.execPath, [path.join(root, 'dist/cli.js'), 'queue'], {
        cwd: repo, timeout: 10000,
        env: { CREW_HOME: crewHome, CREW_SERVER_URL: server.url, CREW_SECRET: server.perStartSecret },
      });
      console.log('\ncrew queue:\n' + queue.stdout);
    }
    printed = true;
  }

  try {
    console.log('Milestone 4 manual smoke: real Claude Code authors and reviewer; $0.50 cap per run, expected 6 small runs, 8 minute timeout.');
    await execa('npm', ['run', 'build'], { cwd: root, timeout: 60000, cancelSignal: signal });
    const detection = await execa('claude', ['--version'], { timeout: 10000, cancelSignal: signal });
    console.log('Claude Code: ' + detection.stdout);
    repo = fs.mkdtempSync('/tmp/crew-smoke4-repo-');
    crewHome = fs.mkdtempSync('/tmp/crew-smoke4-home-');
    process.env.CREW_HOME = crewHome;
    console.log(`Throwaway repo: ${repo}\nCREW_HOME: ${crewHome}`);
    await git('init', '-b', 'main');
    await git('config', 'user.name', 'Crew Smoke Tester');
    await git('config', 'user.email', 'smoke@crew.local');
    fs.writeFileSync(path.join(repo, 'features.txt'), 'features=none\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), '.setup-done\n');
    fs.writeFileSync(path.join(repo, 'verify.cjs'), `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      assert.equal(fs.readFileSync('.setup-done', 'utf8'), 'ok\\n');
      const features = fs.readFileSync('features.txt', 'utf8').trim();
      assert.ok(['features=alpha', 'features=beta', 'features=alpha,beta'].includes(features), features);
      console.log('setup=ok;' + features);
    `);
    await git('add', '.');
    await git('commit', '-m', 'Smoke fixture');
    const base = await git('rev-parse', 'main');
    assert.equal(await git('branch', '--show-current'), 'main');
    assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');

    db = createCrewDatabase({ dbPath: path.join(crewHome, 'crew.db') });
    const eventBus = new EventBus();
    const worktreeManager = new WorktreeManager(db);
    const scheduler = new Scheduler(db, eventBus, { maxRetries: 0, worktreeManager });
    // Use the existing adapter option; this script does not change its implementation.
    const adapter = new ClaudeCodeAdapter({ maxBudgetUsd: 0.50 });
    runner = new Runner({ db, eventBus, scheduler, adapters: { 'claude-code': adapter }, crewHome,
      serverUrl: 'http://127.0.0.1:0', maxRuntimeMs: 90000, noOutputTimeoutMs: 60000 });
    dispatcher = new Dispatcher({ db, eventBus, scheduler, runner, crewHome, maxParallelAgents: 2 });
    server = await startServer({ db, eventBus, scheduler, worktreeManager, runner, dispatcher,
      port: 0, startVerifier: true, startDispatcher: false, startMergeQueue: false });
    const now = new Date();
    const workspaceId = 'smoke4-workspace';
    const boardId = 'smoke4-board';
    const first = 'smoke4-alpha';
    const second = 'smoke4-beta';
    db.db.insert(schema.workspaces).values({ id: workspaceId, name: 'Merge smoke', repoPath: repo,
      defaultBranch: 'main', config: { worktreeSetup: 'echo ok > .setup-done', maxDepth: 1,
        verifyCommands: [{ name: 'smoke-content', command: 'node verify.cjs', paths: ['features.txt'] }] }, createdAt: now }).run();
    db.db.insert(schema.boards).values({ id: boardId, workspaceId, currentPhase: 'dispatch', createdAt: now }).run();
    db.db.insert(schema.roles).values([
      { id: 'developer', name: 'developer', defaultPrompt: 'Make only the requested tiny file edit, then crew done. Do not ask questions.', permissionProfile: { mode: 'full' }, isBuiltin: false, createdAt: now },
      { id: 'reviewer', name: 'reviewer', defaultPrompt: 'Read the diff and acceptance criteria. If correct call crew review approve --feedback "Checked features and acceptance criteria". Otherwise call crew review changes with concise feedback. Never call crew done.', permissionProfile: { mode: 'read-only' }, isBuiltin: false, createdAt: now },
    ]).run();
    for (const [id, roleId] of [['author-alpha', 'developer'], ['author-beta', 'developer'], ['reviewer-agent', 'reviewer']]) {
      const token = 'crew_agent_' + crypto.randomBytes(24).toString('hex');
      db.db.insert(schema.agents).values({ id, workspaceId, roleId, name: id, cliType: 'claude-code', status: 'idle',
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'), createdAt: now }).run();
      runner.registerAgentToken(id, token);
    }
    let runCount = 0;
    runner.on('run_started', run => {
      console.log(`[run] ${run.taskId}: ${run.agentId}`);
      if (++runCount > 6) controller.abort(new Error('More than 6 agent runs; refusing an expensive retry loop'));
    });
    const cleaned = new Set<string>();
    unsubscribe = eventBus.subscribeBoardEvents(boardId, event => {
      if (event.type === 'merge_item_changed') {
        const item = event.data as typeof schema.mergeQueueItems.$inferSelect;
        if (item.status === 'merged') cleaned.add(item.taskId);
      }
      if (event.type === 'task_status_changed') {
        const data = event.data as { taskId: string; to: string };
        console.log(`[task] ${data.taskId}: ${data.to}`);
        if (['escalated', 'cancelled', 'blocked'].includes(data.to)) controller.abort(new Error(`${data.taskId} became ${data.to}`));
      }
    });
    const task = (id: string) => db!.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
    const item = (id: string) => db!.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, id)).get();
    function waitUntil(predicate: () => boolean): Promise<void> {
      return bounded(() => new Promise<void>(resolve => {
        if (predicate()) { resolve(); return; }
        const unsub = eventBus.subscribeBoardEvents(boardId, () => { if (predicate()) { finish(); resolve(); } });
        const abort = () => finish();
        function finish() { unsub(); signal.removeEventListener('abort', abort); }
        signal.addEventListener('abort', abort, { once: true });
      }));
    }
    for (const [id, feature, assigneeAgentId] of [[first, 'alpha', 'author-alpha'], [second, 'beta', 'author-beta']]) {
      await scheduler.createTask({ id, boardId, roleId: 'developer', assigneeAgentId, title: `Add ${feature} feature`,
        description: `Change the sole line of features.txt to exactly features=${feature} followed by a newline. Change no other files. Run node verify.cjs, then crew done. If this is a later conflict-resolution task, preserve both alpha and beta in the canonical line features=alpha,beta.`,
        acceptanceCriteria: `features.txt includes ${feature}. On conflict resolution preserve both features as features=alpha,beta. All other tracked files remain unchanged.` });
    }
    // Both branches start at the same base. Hold the first ref update until both
    // authors and reviews finish, guaranteeing order and a same-line conflict.
    await scheduler.transitionTask(first, 'doing');
    await scheduler.transitionTask(second, 'doing');
    assert.equal(await git('rev-parse', task(first)!.branch!), base);
    assert.equal(await git('rev-parse', task(second)!.branch!), base);
    const mergeGate = new Promise<void>(resolve => { releaseMerge = resolve; });
    server.mergeQueue.hooks.beforeRefUpdate = async current => { if (current.id === first) await mergeGate; };
    server.mergeQueue.start();
    for (const id of [first, second]) {
      await bounded(() => runner!.runTask(id));
      await waitUntil(() => task(id)?.status === 'merge-queue');
    }
    releaseMerge!();
    server.mergeQueue.hooks.beforeRefUpdate = undefined;
    dispatcher.start();
    await waitUntil(() => {
      const childId = item(second)?.conflictTaskId;
      return !!childId && [first, second, childId].every(id => task(id)?.status === 'merged') && cleaned.has(first) && cleaned.has(childId);
    });
    await bounded(() => new Promise<void>(resolve => {
      if (!runner!.getLiveRuns().length) { resolve(); return; }
      const check = () => { if (!runner!.getLiveRuns().length) { runner!.off('run_ended', check); resolve(); } };
      runner!.on('run_ended', check);
      signal.addEventListener('abort', () => runner!.off('run_ended', check), { once: true });
    }));

    // Every claim below is an assertion, not an informational print.
    assert.equal(task(first)?.status, 'merged');
    assert.equal(task(second)?.status, 'merged');
    const childId = item(second)?.conflictTaskId;
    assert.ok(childId, 'Second task did not create a linked conflict sub-task');
    const child = task(childId);
    assert.ok(child && child.parentTaskId === second && child.status === 'merged');
    const runs = db.db.select().from(schema.runs).all();
    assert.ok(runs.some(r => r.taskId === childId && r.kind === 'work' && r.exitReason === 'done' && r.adapter === 'claude-code' && r.pid), 'Conflict was not resolved by a completed real agent run');
    const results = db.db.select().from(schema.verificationResults).all();
    for (const id of [first, second, childId]) {
      const reviews = runs.filter(r => r.taskId === id && r.kind === 'review' && r.adapter === 'claude-code' && r.agentId === 'reviewer-agent' && r.exitReason === 'done' && r.pid && r.endedAt);
      assert.ok(reviews.some(r => results.some(v => v.runId === r.id && v.step === 'review' && v.passed && v.output && !/^skipped/i.test(v.output))), `${id} has no real Reviewer verdict`);
      assert.ok(!results.some(v => runs.some(r => r.id === v.runId && r.taskId === id) && v.step === 'review' && /^skipped/i.test(v.output ?? '')), `${id} skipped review`);
      assert.ok(!fs.existsSync(task(id)!.worktreePath!), `${id} worktree was not cleaned`);
      assert.equal(await git('branch', '--list', task(id)!.branch!), '', `${id} branch was not cleaned`);
    }
    for (const [id, expected] of [[first, 'setup=ok;features=alpha'], [second, 'setup=ok;features=beta'], [childId, 'setup=ok;features=alpha,beta']]) {
      assert.ok(results.some(v => runs.some(r => r.id === v.runId && r.taskId === id && r.kind === 'work') && v.step === 'smoke-content' && v.passed && v.output === expected), `${id}: setup/author verify output missing`);
    }
    assert.ok(results.some(v => runs.some(r => r.id === v.runId && r.taskId === childId) && v.step === 'merge:smoke-content' && v.passed && v.output === 'setup=ok;features=alpha,beta'), 'Final rebased verification missing');
    assert.equal(await git('show', 'main:features.txt'), 'features=alpha,beta');
    assert.equal(fs.readFileSync(path.join(repo, 'features.txt'), 'utf8'), 'features=alpha,beta\n');
    const integration = path.join(crewHome, 'integration', workspaceId);
    assert.equal(fs.readFileSync(path.join(integration, '.setup-done'), 'utf8'), 'ok\n');
    const verify = await execa(process.execPath, ['verify.cjs'], { cwd: integration, timeout: 10000, cancelSignal: signal });
    assert.equal(verify.stdout, 'setup=ok;features=alpha,beta');
    assert.equal(await git('branch', '--show-current'), 'main');
    assert.equal(await git('status', '--porcelain=v1', '--untracked-files=all'), '');
    assert.equal(await git('rev-list', '--count', `${base}..main`), '2');
    assert.equal(await git('log', '--format=%s', `${base}..main`), `Rebase + resolve: Add beta feature\nAdd alpha feature`);
    for (const id of [first, childId]) {
      const sha = item(id)?.commitSha;
      assert.ok(sha, `No persisted merge commit for ${id}`);
      await git('merge-base', '--is-ancestor', sha, 'main');
      assert.ok((await git('show', '-s', '--format=%B', sha)).includes(`Crew-Task: ${id}`));
      assert.equal(await git('diff-tree', '--no-commit-id', '--name-only', '-r', sha), 'features.txt');
    }
    assert.equal(item(second)?.commitSha, item(childId)?.commitSha);
    await diagnostics();
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timeout);
    releaseMerge?.();
    unsubscribe?.();
    dispatcher?.setStopped(true);
    dispatcher?.stop();
    const shutdown = await Promise.allSettled([server?.mergeQueue.stopAll(), server?.verifier.stopAll(), server?.worktreeManager.stopAllSetup(), runner?.killAll('stopped')]);
    if (!printed) await diagnostics().catch(error => console.error('Diagnostics failed:', error));
    await server?.close();
    db?.close();
    signal.removeEventListener('abort', onAbort);
    if (hardExit) clearTimeout(hardExit);
    if (previousHome === undefined) delete process.env.CREW_HOME; else process.env.CREW_HOME = previousHome;
    if (repo) console.log(`Artifacts retained: ${repo} and ${crewHome}`);
    const failure = shutdown.find(result => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
  }
  console.log('\nMilestone 4 smoke passed: both tasks merged, real conflict agent and Reviewer verdicts, setup, verification and expected main commits asserted.');
}

runSmoke().catch(error => { console.error('Milestone 4 smoke failed:', error); process.exitCode = 1; });
