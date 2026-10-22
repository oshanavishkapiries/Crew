/**
 * MANUAL / PAID: npm run smoke:m7. Typechecked, NEVER executed by npm test.
 * Both tools: 7 paid launches maximum (tool split depends on Reviewer choice), including
 * one deliberately stopped Codex launch. Four one-file tasks; zero author retries,
 * no Reviewer retries. $0.50 per Claude launch; Codex has no USD/token cap: tiny
 * prompts + 120s runtime / 90s silence caps. Global deadline 10 minutes.
 * Worst-case Claude portion <= $3.50; Codex billing is unknown, not included.
 * Missing/login-failed tools produce explicit skips. No provider-limit probes.
 * All fixtures, process groups and private connect prompts are temporary.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';
import { eq } from 'drizzle-orm';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { CodexAdapter } from '../src/adapters/codex.js';
import type { AgentAdapter } from '../src/adapters/types.js';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';
import { EventBus } from '../src/server/events/index.js';
import { Runner } from '../src/server/runner/index.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { WorktreeManager } from '../src/server/worktree/index.js';
import { loadWorkspaceConfigs, type ProjectConfig } from '../src/server/project-config.js';
import { startServer, type RunningServer } from '../src/server/index.js';

const MAX_RUNS = 7;
const DEADLINE_MS = 10 * 60 * 1000;
const CLAUDE_BUDGET_USD = 0.50;
// SQLite heartbeats have ONE SECOND precision; allow production 5s scans and grace.
const STALE_AFTER_MS = 5000;
type SpawnOptions = Parameters<AgentAdapter['buildSpawn']>[0];
type Assignment = { task: typeof schema.tasks.$inferSelect; runId: string; workDir: string; prompt: string };

async function smoke() {
  const root = path.resolve(import.meta.dirname, '..');
  const cli = path.join(root, 'dist/cli.js');
  const previousHome = process.env.CREW_HOME;
  const controller = new AbortController();
  const { signal } = controller;
  const deadline = setTimeout(() => controller.abort(new Error('10 minute deadline exceeded')), DEADLINE_MS);
  const interrupt = () => controller.abort(new Error('Smoke interrupted'));
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let db: CrewDatabase | undefined;
  let server: RunningServer | undefined;
  let runner: Runner | undefined;
  let repo = '', home = '', stage = 'preflight';
  let attempts = 0;
  const outcomes = new Map<number, string>();
  const sandboxEvidence: { taskId?: string; mode?: string; sandbox: string; network: boolean }[] = [];
  const reviewSnapshots = new Map<string, { head: string; status: string }>();
  const launches = new Map<string, number>();
  const transitions = new Map<string, Set<string>>();
  const secretValues: string[] = []; // Memory only. Never write connect output to a file.
  const safe = (value: string) => secretValues.reduce((text, secret) => text.split(secret).join('[redacted]'), value);
  function result(step: number, message: string) { outcomes.set(step, message); console.log(`[step ${step}] ${message}`); }
  function reserve(tool: string, options: SpawnOptions) {
    signal.throwIfAborted();
    const key = `${tool}:${options.taskId}:${options.permissions.mode}`;
    const count = (launches.get(key) ?? 0) + 1;
    // Two work launches only for the intentional Codex stop/resume. No model retry loops.
    if (attempts >= MAX_RUNS || count > (tool === 'codex' && options.taskId === 'codex-worker' && options.permissions.mode !== 'read-only' ? 2 : 1)) {
      const error = new Error('Paid launch/retry cap reached; refusing to spawn');
      controller.abort(error); throw error;
    }
    attempts++; launches.set(key, count);
    console.log(`[launch ${attempts}/${MAX_RUNS}] ${tool}, ${options.taskId}, ${options.permissions.mode}`);
  }
  class CappedClaude extends ClaudeCodeAdapter {
    buildSpawn(options: SpawnOptions) { reserve('claude-code', options); return super.buildSpawn(options); }
    buildResume(options: Parameters<ClaudeCodeAdapter['buildResume']>[0]) { reserve('claude-code', options); return super.buildResume(options); }
  }
  class CappedCodex extends CodexAdapter {
    private check<T extends ReturnType<CodexAdapter['buildSpawn']>>(options: SpawnOptions, config: T) {
      const sandbox = config.args[config.args.indexOf('-s') + 1];
      assert.equal(sandbox, 'workspace-write');
      assert.ok(config.args.includes('sandbox_workspace_write.network_access=true'));
      assert.ok(config.args.includes('approval_policy="never"'));
      assert.ok(config.args.includes('--ignore-user-config') && config.args.includes('--ignore-rules'));
      sandboxEvidence.push({ taskId: options.taskId, mode: options.permissions.mode, sandbox, network: true });
      return config; // The real adapter's exact command/args/env, unmodified.
    }
    buildSpawn(options: SpawnOptions) { reserve('codex', options); return this.check(options, super.buildSpawn(options)); }
    buildResume(options: Parameters<CodexAdapter['buildResume']>[0]) { reserve('codex', options); return this.check(options, super.buildResume(options)); }
  }
  const env = () => ({ ...process.env, CREW_HOME: home, CREW_AGENT_TOKEN: '', CREW_TASK_ID: '', CREW_RUN_ID: '', CREW_SECRET: '', CREW_SERVER_URL: server?.url ?? '' });
  async function crew(args: string[], extra: NodeJS.ProcessEnv = {}, cwd = repo, allowFailure = false) {
    // Never allow execa's verbose error object (which includes env/stdout) into diagnostics.
    const response = await execa(process.execPath, [cli, ...args], {
      cwd, env: { ...env(), ...extra }, timeout: 20000, cancelSignal: signal, reject: false,
    }).catch(() => { throw new Error(`crew ${args[0]} subprocess failed or timed out`); });
    if (!allowFailure) assert.equal(response.exitCode, 0, safe(`crew ${args[0]} failed: ${response.stderr}`));
    return response;
  }
  const git = async (...args: string[]) => (await execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, timeout: 15000, cancelSignal: signal,
  })).stdout;
  const task = (id: string) => db!.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get()!;
  const runs = (id?: string) => db!.db.select().from(schema.runs).all().filter(run => !id || run.taskId === id);
  async function waitUntil(label: string, predicate: () => boolean, timeout = 180000) {
    const until = Date.now() + timeout;
    while (!predicate()) {
      signal.throwIfAborted();
      assert.ok(Date.now() < until, `Timed out: ${label}`);
      assert.ok(!db!.db.select().from(schema.tasks).all().some(t => ['escalated', 'cancelled', 'blocked'].includes(t.status)), 'Task escalated, cancelled or blocked');
      await delay(100, undefined, { signal });
    }
  }
  async function connect(name: string) {
    const prompt = (await crew(['connect', name])).stdout;
    const token = /export CREW_AGENT_TOKEN='([^']+)'/.exec(prompt)?.[1];
    assert.ok(token, 'Private connect prompt missing token'); secretValues.push(token);
    assert.ok(prompt.includes('crew join') && prompt.includes('crew next'));
    return token;
  }
  async function next(token: string): Promise<Assignment> {
    await crew(['join'], { CREW_AGENT_TOKEN: token });
    const response = await crew(['next', '--wait', '1'], { CREW_AGENT_TOKEN: token });
    const assignment: Assignment = JSON.parse(response.stdout.split('\nSet CREW_TASK_ID=')[0]);
    assert.ok(assignment.runId && assignment.workDir && assignment.prompt, 'No Pull assignment');
    assert.equal(runs().find(r => r.id === assignment.runId)?.pid, null);
    return assignment;
  }
  async function done(token: string, assignment: Assignment) {
    const response = await crew(['done'], { CREW_AGENT_TOKEN: token, CREW_TASK_ID: assignment.task.id, CREW_RUN_ID: assignment.runId }, assignment.workDir);
    assert.match(response.stdout, /clear.*context.*join/i);
    assert.equal(runs().find(r => r.id === assignment.runId)?.exitReason, 'done');
    await crew(['join'], { CREW_AGENT_TOKEN: token });
  }
  function assertCodexCommand(run: typeof schema.runs.$inferSelect, command: RegExp, output?: RegExp) {
    assert.ok(run.logPath);
    const events = fs.readFileSync(run.logPath, 'utf8').split('\n').flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
    assert.ok(events.some(event => {
      const data = event.data ?? event;
      return data.type === 'item.completed' && data.item?.type === 'command_execution' &&
        command.test(data.item.command ?? '') && data.item.exit_code === 0 &&
        (!output || output.test(data.item.aggregated_output ?? ''));
    }), 'Missing successful real Codex CLI command evidence');
  }
  async function finish(id: string, expectedFile: string, reviewerAvailable: boolean, pullReviewer?: string) {
    if (pullReviewer) {
      await waitUntil('Pull review selected', () => task(id).status === 'review');
      const review = await next(pullReviewer);
      assert.equal(review.task.id, id);
      await crew(['review', 'approve', '--feedback', 'Tiny file acceptance checked by smoke terminal'], {
        CREW_AGENT_TOKEN: pullReviewer, CREW_TASK_ID: id, CREW_RUN_ID: review.runId,
      }, review.workDir);
    }
    await waitUntil('review and merge', () => task(id).status === 'merged');
    await waitUntil('worktree cleanup', () => !fs.existsSync(task(id).worktreePath!));
    await waitUntil('agent process exit', () => !runner!.getLiveRuns().some(r => r.taskId === id));
    assert.ok(transitions.get(id)?.has('merge-queue'), 'Task never reached merge-queue');
    const author = runs(id).find(r => r.kind === 'work' && r.exitReason === 'done');
    assert.ok(author?.endedAt);
    const review = runs(id).find(r => r.kind === 'review' && r.exitReason === 'done');
    const results = db!.db.select().from(schema.verificationResults).all().filter(v => runs(id).some(r => r.id === v.runId));
    assert.ok(results.some(v => v.step === 'diff' && v.passed));
    assert.ok(results.some(v => v.step === 'content' && v.passed));
    assert.ok(results.some(v => v.step === 'merge:content' && v.passed));
    if (reviewerAvailable || pullReviewer) {
      assert.ok(review?.endedAt && results.some(v => v.runId === review.id && v.step === 'review' && v.passed && !/^skipped/i.test(v.output ?? '')), 'Review did not approve');
    }
    const item = db!.db.select().from(schema.mergeQueueItems).all().find(i => i.taskId === id)!;
    assert.ok(item?.commitSha); await git('merge-base', '--is-ancestor', item.commitSha, 'main');
    assert.equal(await git('show', `main:${expectedFile}.txt`), expectedFile);
    assert.equal(await git('diff-tree', '--no-commit-id', '--name-only', '-r', item.commitSha), `${expectedFile}.txt`);
    assert.equal(task(id).retries, 0);
    assert.equal(await git('status', '--porcelain'), '');
    return { author, review };
  }
  async function toolReady(tool: 'claude' | 'codex') {
    try {
      const version = await execa(tool, ['--version'], { timeout: 10000, cancelSignal: signal, reject: false });
      const auth = await execa(tool, tool === 'claude' ? ['auth', 'status'] : ['login', 'status'], { timeout: 10000, cancelSignal: signal, reject: false });
      const loggedIn = tool === 'claude' ? JSON.parse(auth.stdout).loggedIn === true : /Logged in/i.test(auth.stdout + auth.stderr);
      // Use the already bounded version call; avoid a second unbounded detect subprocess.
      const [major, minor] = (version.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] ?? '0.0.0').split('.').map(Number);
      const supported = tool !== 'codex' || major > 0 || minor >= 163;
      const ready = version.exitCode === 0 && auth.exitCode === 0 && loggedIn && supported;
      console.log(`[preflight] ${tool}: ${ready ? version.stdout.trim() + ', authenticated' : 'missing, unsupported or unauthenticated; dependent steps skipped'}`);
      return ready;
    } catch { console.log(`[preflight] ${tool}: unavailable/authentication not confirmed; dependent steps skipped`); return false; }
  }
  try {
    console.log('Milestone 7 PAID smoke: maximum 7 launches; Claude $0.50/run; Codex cost unknown; 10 minute deadline. No automatic model retries.');
    const claude = await toolReady('claude'); const codex = await toolReady('codex');
    await execa('npm', ['run', 'build'], { cwd: root, timeout: 60000, cancelSignal: signal });
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke7-repo-'));
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke7-home-'));
    fs.chmodSync(home, 0o700); process.env.CREW_HOME = home;
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Crew Smoke Tester'); await git('config', 'user.email', 'smoke@crew.local');
    const team: NonNullable<ProjectConfig['team']> = [
      { name: 'Pull primary', role: 'backend', cliType: 'antigravity', mode: 'pull' },
      { name: 'Pull replacement', role: 'backend', cliType: 'antigravity', mode: 'pull' },
    ];
    if (codex) team.push({ name: 'Codex worker', role: 'codex-worker', cliType: 'codex' }, { name: 'Codex reviewer', role: 'reviewer', cliType: 'codex' });
    if (claude) team.push({ name: 'Claude author', role: 'claude-author', cliType: 'claude-code' }, { name: 'Claude reviewer', role: 'reviewer', cliType: 'claude-code' });
    if (!codex && !claude) team.push({ name: 'Terminal reviewer', role: 'reviewer', cliType: 'antigravity', mode: 'pull' });
    fs.writeFileSync(path.join(repo, 'README.md'), '# Four tiny files\n');
    fs.writeFileSync(path.join(repo, 'verify.cjs'), `const fs = require('node:fs'); const assert = require('node:assert/strict');
for (const name of ['codex', 'mixed', 'pull', 'stale']) if (fs.existsSync(name + '.txt')) assert.equal(fs.readFileSync(name + '.txt', 'utf8'), name + '\\n');
console.log('content verified');\n`);
    fs.writeFileSync(path.join(repo, 'crew.config.ts'), `export default ${JSON.stringify({
      team, staleAfterMs: STALE_AFTER_MS, maxRetries: 0, maxDepth: 0, maxParallelAgents: 1,
      maxRuntimeMs: 120000, noOutputTimeoutMs: 90000,
      permissions: { allowCommands: ['node verify.cjs', 'git status', 'git diff', 'git add', 'git commit'] },
      verifyCommands: [{ name: 'content', command: 'node verify.cjs' }],
      roles: {
        // Distinct fixture roles prevent an idle spawn worker reclaiming stale Pull work.
        'codex-worker': { defaultPrompt: 'Implement only the requested tiny file. Run node verify.cjs, then crew done. Use simple separate commands. No questions or extra edits.', permissionProfile: { mode: 'standard' } },
        'claude-author': { defaultPrompt: 'Implement only the requested tiny file. Run node verify.cjs, then crew done. Use simple separate commands. No questions or extra edits.', permissionProfile: { mode: 'standard' } },
        reviewer: { defaultPrompt: 'Inspect git diff/log/show and acceptance criteria. Do not edit any files. Call crew review approve --feedback "Exact tiny file accepted" if correct, otherwise crew review changes. Do not call crew done.' },
      },
    }, null, 2)};\n`);
    await git('add', '.'); await git('commit', '-m', 'Smoke 7 fixture');
    await crew(['init']);
    db = createCrewDatabase({ dbPath: path.join(home, 'crew.db') });
    await loadWorkspaceConfigs(db);
    // Fixture only: remove initialized defaults BEFORE the server can dispatch them.
    // Exercise config.team creation, while avoiding unrelated Orchestrator/default work.
    for (const agent of db.db.select().from(schema.agents).all()) if (!team.some(a => a.name === agent.name)) db.db.delete(schema.agents).where(eq(schema.agents.id, agent.id)).run();
    const agent = (name: string) => db!.db.select().from(schema.agents).all().find(a => a.name === name)!;
    const board = db.db.select().from(schema.boards).get()!;
    db.db.update(schema.boards).set({ currentPhase: 'dispatch' }).where(eq(schema.boards.id, board.id)).run();
    const eventBus = new EventBus();
    eventBus.subscribeBoardEvents(board.id, event => {
      if (event.type !== 'task_status_changed') return;
      const { taskId, to } = event.data as { taskId: string; to: string };
      const states = transitions.get(taskId) ?? new Set<string>(); states.add(to); transitions.set(taskId, states);
      console.log(`[task] ${taskId}: ${to}`);
    });
    const worktreeManager = new WorktreeManager(db);
    const scheduler = new Scheduler(db, eventBus, { worktreeManager });
    runner = new Runner({ db, eventBus, scheduler, crewHome: home, serverUrl: 'http://127.0.0.1:0',
      adapters: { 'claude-code': new CappedClaude({ maxBudgetUsd: CLAUDE_BUDGET_USD }), codex: new CappedCodex() } });
    const snapshot = (cwd: string) => ({
      head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 10000 }).trim(),
      status: execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, encoding: 'utf8', timeout: 10000 }).trim(),
    });
    runner.on('run_started', run => {
      if (runs().find(r => r.id === run.id)?.kind === 'review') reviewSnapshots.set(run.taskId, snapshot(task(run.taskId).worktreePath!));
    });
    server = await startServer({ db, eventBus, scheduler, runner, worktreeManager, port: 0,
      startDispatcher: true, startVerifier: true, startMergeQueue: true, startWorkflow: false });
    server.mergeQueue.hooks.beforeRefUpdate = async current => {
      const before = reviewSnapshots.get(current.id);
      if (before) { assert.equal(before.status, ''); assert.deepEqual(snapshot(current.worktreePath!), before, 'Reviewer changed author worktree before merge'); }
      else assert.ok(!claude && !codex, 'Missing real Reviewer snapshot');
    };
    async function create(id: string, file: string, assignee: string) {
      await scheduler.createTask({ id, boardId: board.id, roleId: agent(assignee).roleId, assigneeAgentId: agent(assignee).id,
        title: `Create ${file}.txt`, description: `Create only ${file}.txt with exactly ${file} followed by a newline. Leave all other files unchanged. Run node verify.cjs then crew done.`,
        acceptanceCriteria: `Only ${file}.txt changes, containing exactly ${file} followed by a newline.` });
    }
    if (codex) {
      stage = 'step 5 stop/resume';
      await create('codex-worker', 'codex', 'Codex worker');
      await waitUntil('live Codex process', () => runs('codex-worker').some(r => !!r.pid && !r.endedAt));
      const interrupted = runs('codex-worker')[0]; const branch = task('codex-worker').branch;
      await crew(['stop-all']);
      assert.equal(runs('codex-worker').find(r => r.id === interrupted.id)?.exitReason, 'stopped');
      assert.equal(task('codex-worker').retries, 0); assert.equal(task('codex-worker').status, 'doing');
      assert.equal(server.dispatcher.isStopped(), true); assert.equal(runner.getLiveRuns().length, 0);
      await crew(['resume']);
      assert.equal(task('codex-worker').branch, branch);
      result(5, 'RAN / PASS: live Codex stop-all/resume, zero retries, branch retained; no provider limit attempted.');
      stage = 'step 1 Codex worker';
      const completed = await finish('codex-worker', 'codex', claude || codex);
      assert.equal(completed.author.adapter, 'codex'); assert.ok(completed.author.pid && completed.author.sessionId);
      assertCodexCommand(completed.author, /crew\s+done\b/, /Task submitted for verification/);
      assert.ok(sandboxEvidence.some(e => e.taskId === 'codex-worker' && e.sandbox === 'workspace-write' && e.network));
      result(1, 'RAN / PASS: config Codex worker, real workspace-write/network-on adapter, HTTP done, verification, review, merge-queue and merge.');
    } else { result(1, 'SKIPPED: Codex missing/unsupported/not authenticated.'); result(5, 'SKIPPED: no authenticated Codex; no provider limit attempted.'); }
    if (codex && claude) {
      stage = 'step 2 mixed review';
      await create('mixed-review', 'mixed', 'Claude author');
      const completed = await finish('mixed-review', 'mixed', true);
      assert.equal(completed.author.adapter, 'claude-code'); assert.equal(completed.review?.adapter, 'codex');
      assert.ok(completed.review.pid && completed.review.sessionId);
      assertCodexCommand(completed.review, /crew\s+review\s+approve\b/);
      assert.ok(sandboxEvidence.some(e => e.taskId === 'mixed-review' && e.mode === 'read-only'));
      result(2, 'RAN / PASS: Claude author, real Codex Reviewer approval; clean unchanged author HEAD/status before merge.');
    } else result(2, 'SKIPPED: mixed-tool author/Reviewer needs both authenticated tools; single-tool review still used where available.');
    const pullReviewer = !claude && !codex ? await connect('Terminal reviewer') : undefined;
    stage = 'step 3 Pull completion';
    const primary = await connect('Pull primary');
    await create('pull-worker', 'pull', 'Pull primary');
    const first = await next(primary); assert.equal(first.task.id, 'pull-worker');
    fs.writeFileSync(path.join(first.workDir, 'pull.txt'), 'pull\n');
    await done(primary, first); await finish('pull-worker', 'pull', claude || codex, pullReviewer);
    assert.ok(runs('pull-worker').filter(r => r.agentId === agent('Pull primary').id).every(r => r.pid === null && r.adapter === 'antigravity'));
    result(3, 'RAN / PASS: private connect -> real CLI join/next/edit/done/rejoin, no spawned Pull process or pid, verification/review/merge.');
    stage = 'step 4 stale takeover';
    await create('stale-worker', 'stale', 'Pull primary');
    const silent = await next(primary); assert.equal(silent.task.id, 'stale-worker');
    fs.writeFileSync(path.join(silent.workDir, 'stale.txt'), 'preserved draft\n');
    const branch = task('stale-worker').branch;
    await waitUntil('production stale scan (5s window, 1s precision)', () => task('stale-worker').status === 'ready', 20000);
    assert.equal(task('stale-worker').retries, 0); assert.equal(task('stale-worker').branch, branch);
    assert.equal(task('stale-worker').worktreePath, silent.workDir);
    assert.equal(runs().find(r => r.id === silent.runId)?.exitReason, 'stale');
    assert.ok(await git('rev-parse', '--verify', `refs/heads/${branch}`));
    const replacement = await connect('Pull replacement');
    const takeover = await next(replacement);
    assert.equal(takeover.task.id, 'stale-worker'); assert.equal(takeover.workDir, silent.workDir);
    assert.notEqual(takeover.runId, silent.runId);
    assert.equal(fs.readFileSync(path.join(takeover.workDir, 'stale.txt'), 'utf8'), 'preserved draft\n');
    const late = await crew(['done'], { CREW_AGENT_TOKEN: primary, CREW_TASK_ID: silent.task.id, CREW_RUN_ID: silent.runId }, silent.workDir, true);
    assert.equal(late.exitCode, 1); assert.match(late.stderr, /retired as stale/i);
    fs.writeFileSync(path.join(takeover.workDir, 'stale.txt'), 'stale\n');
    await done(replacement, takeover); await finish('stale-worker', 'stale', claude || codex, pullReviewer);
    assert.ok(runs('stale-worker').filter(r => r.kind === 'work').every(r => r.pid === null));
    result(4, 'RAN / PASS: real-time stale scan, zero retries, branch/draft preserved, different Pull agent completes and merges, old run ID refused.');
    console.log('[sandbox] ' + JSON.stringify(sandboxEvidence));
    console.log(`[summary] ${attempts}/${MAX_RUNS} paid launches. All available steps passed; skipped steps above are not passes.`);
  } catch (error) {
    process.exitCode = 1;
    console.error(`[FAILED] ${stage}: ${safe(error instanceof Error ? error.message : 'unknown error')}`);
    // No prompts, child env, private stdout or raw model logs in failure diagnostics.
    if (db) console.error('[state] ' + JSON.stringify({ tasks: db.db.select().from(schema.tasks).all().map(t => ({ id: t.id, status: t.status, retries: t.retries })), runs: runs().map(r => ({ task: r.taskId, tool: r.adapter, kind: r.kind, exit: r.exitReason })) }));
  } finally {
    clearTimeout(deadline);
    const cleanupTimeout = setTimeout(() => { console.error('[FAILED] cleanup exceeded 20 seconds'); process.exit(1); }, 20000);
    try {
      server?.dispatcher.setStopped(true);
      await server?.close();
      const processes = (await execa('ps', ['-eo', 'pid=,pgid=,stat='], { timeout: 10000 })).stdout.split('\n').map(line => line.trim().split(/\s+/));
      for (const run of db ? runs() : []) if (run.pid) assert.ok(!processes.some(([pid, group, status]) => (Number(pid) === run.pid || Number(group) === run.pid) && !status.startsWith('Z')), 'Agent process group survived cleanup');
      // Report only numeric usage/cost fields, never model/tool text or tokens used as credentials.
      const usage: { tool: string; input: number; cached: number; output: number; usd: number | null }[] = [];
      for (const run of db ? runs() : []) if (run.logPath && fs.existsSync(run.logPath)) {
        for (const line of fs.readFileSync(run.logPath, 'utf8').split('\n')) {
          let event: any; try { event = JSON.parse(line); } catch { continue; }
          // Logs contain native JSONL; accept wrapped events too.
          const data = event.data ?? event;
          if (data.type === 'turn.completed' || data.type === 'result') usage.push({ tool: run.adapter,
            input: Number(data.usage?.input_tokens ?? 0), cached: Number(data.usage?.cached_input_tokens ?? data.usage?.cache_read_input_tokens ?? 0),
            output: Number(data.usage?.output_tokens ?? 0), usd: typeof data.total_cost_usd === 'number' ? data.total_cost_usd : null });
        }
      }
      console.log('[usage] ' + JSON.stringify(usage));
      console.log('[cleanup] server closed; no live agent process groups.');
    } catch { process.exitCode = 1; console.error('[FAILED] cleanup/process or usage verification failed'); }
    finally {
      db?.close();
      if (repo) fs.rmSync(repo, { recursive: true, force: true });
      if (home) fs.rmSync(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.CREW_HOME; else process.env.CREW_HOME = previousHome;
      clearTimeout(cleanupTimeout); process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      console.log('[cleanup] throwaway repo/home and private connect material removed.');
    }
    for (const step of [1, 2, 3, 4, 5]) if (!outcomes.has(step)) console.log(`[step ${step}] NOT COMPLETED: smoke failed before this step finished.`);
  }
}
smoke().catch(() => { console.error('Milestone 7 smoke failed outside the run; no private diagnostic data printed.'); process.exitCode = 1; });
