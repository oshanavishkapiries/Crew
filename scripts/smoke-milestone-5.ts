/** Manual only: paid real Claude Code calls. Typechecked, never run by npm test. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { execa } from 'execa';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';

// Expected: 4 phase runs + 1 grill answer/resume + 3 authors + 3 reviews = 11.
// Plus 1 rejected tickets run; 3 author retries and their 3 extra review rounds;
// 6 Reviewer retries (one per possible round); 5 phase retries (four phases +
// rejected tickets replacement); 1 extra grill answer if grill is retried = 30.
// maxRetries=1 bounds author/phase retries; reviewers allow 2 runs per round.
const MAX_RUNS = 30;
const DEADLINE_MS = 20 * 60 * 1000;
const BUDGET_USD = 0.50;
const brief = `Build exactly three tiny independent files, no other product changes:
1. Alpha: backend role, alpha.txt containing alpha followed by newline.
2. Beta: backend role, beta.txt containing beta followed by newline.
3. Gamma: backend role, gamma.txt containing gamma followed by newline; blocked by Alpha.
Acceptance: exact content of each file. Keep verify.cjs and config unchanged.
Grill: if no human answer exists yet, ask exactly one question with crew ask.
After an answer/resume, use it and finish; do not ask again.
Spec: describe these three files and their acceptance criteria.
Tickets: create exactly these three work tickets with crew ticket create, use the
returned Alpha ID for Gamma's --blocked-by. Reuse existing tickets after rejection;
do not create more tickets. Ticket descriptions must instruct the worker to call
crew remember with a useful learning, run node verify.cjs and then crew done.
Integrate: inspect role memory with crew memory list --layer role, explicitly promote
at least one learning with crew memory promote ID, and write project and release
summaries into the output file. Use only agent commands; human approvals, answers,
stop-all/resume, memory delete and retry are performed by this script. Never call
human commands. Finish each phase by editing only phase-output.md and calling
crew phase done --output phase-output.md. Use simple separate Bash commands.`;

async function smoke() {
  const root = path.resolve(import.meta.dirname, '..');
  const cli = path.join(root, 'dist/cli.js');
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(() => controller.abort(new Error('20 minute smoke deadline exceeded')), DEADLINE_MS);
  let server: ChildProcess | undefined;
  let db: CrewDatabase | undefined;
  let repo = '', home = '';
  let env: NodeJS.ProcessEnv = {};
  let succeeded = false;
  const human = async (...args: string[]) => (await execa(process.execPath, [cli, ...args], {
    cwd: repo, env, timeout: 20000, cancelSignal: signal,
  })).stdout;
  const git = async (...args: string[]) => (await execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, timeout: 15000, cancelSignal: signal,
  })).stdout;
  async function diagnostics() {
    if (repo) console.log('\nFinal git log --oneline:\n' + (await execa('git', ['log', '--oneline', 'main'], { cwd: repo, timeout: 10000 })).stdout);
    if (server && server.exitCode === null && server.signalCode === null) {
      for (const args of [['status'], ['memory', 'list', '--workspace', db!.db.select().from(schema.workspaces).get()!.id]]) {
        const result = await execa(process.execPath, [cli, ...args], { cwd: repo, env, timeout: 10000, reject: false });
        console.log(`\ncrew ${args.join(' ')}:\n${result.stdout}\n${result.stderr}`);
      }
    }
  }
  try {
    console.log(`Milestone 5 PAID smoke: expected $1–$6 for 11–12 small runs; worst-case run caps total $${MAX_RUNS * BUDGET_USD}. ${MAX_RUNS} runs maximum, $${BUDGET_USD}/run, 20 minute deadline.`);
    await execa('npm', ['run', 'build'], { cwd: root, timeout: 60000, cancelSignal: signal });
    const actualClaude = (process.env.PATH ?? '').split(path.delimiter).map(dir => path.resolve(dir, 'claude')).find(file => {
      try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; }
    });
    assert.ok(actualClaude, 'claude must be installed and authenticated');
    console.log('Claude Code: ' + (await execa(actualClaude, ['--version'], { timeout: 10000, cancelSignal: signal })).stdout);
    repo = fs.mkdtempSync('/tmp/crew-smoke5-repo-'); home = fs.mkdtempSync('/tmp/crew-smoke5-home-');
    const bin = path.join(home, 'capped-bin'); fs.mkdirSync(bin);
    const slots = path.join(home, 'run-slots'); fs.mkdirSync(slots);
    // Derive the cap flags through the existing adapter option, so the launcher
    // does not duplicate its mapping. No agent is spawned by buildSpawn.
    const capped = new ClaudeCodeAdapter({ maxBudgetUsd: BUDGET_USD }).buildSpawn({
      prompt: '', workDir: repo, permissions: { mode: 'standard' },
    });
    const capIndex = capped.args.indexOf('--max-budget-usd');
    assert.ok(capIndex >= 0);
    const capFlags = capped.args.slice(capIndex, capIndex + 2);
    // CLI start constructs the normal adapter. This transparent executable adds
    // its existing budget flag, with atomic run-slot reservations across workers.
    // No adapter/config option or D28 product decision is introduced.
    fs.writeFileSync(path.join(bin, 'claude'), `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (!args.includes('--version')) {
  let slot = 0;
  for (let i = 1; i <= ${MAX_RUNS}; i++) {
    try { fs.mkdirSync(${JSON.stringify(slots)} + '/' + i); slot = i; break; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  if (!slot) { fs.writeFileSync(${JSON.stringify(path.join(home, 'cap-exceeded'))}, 'run cap'); process.exit(99); }
  args.push(...${JSON.stringify(capFlags)});
}
const result = spawnSync(${JSON.stringify(actualClaude)}, args, { stdio: 'inherit', env: process.env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
`, { mode: 0o755 });
    env = { ...process.env, CREW_HOME: home, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CREW_AGENT_TOKEN: '', CREW_SECRET: '', CREW_SERVER_URL: '' };
    console.log(`Throwaway repo: ${repo}\nCREW_HOME: ${home}`);
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Crew Smoke Tester'); await git('config', 'user.email', 'smoke@crew.local');
    fs.writeFileSync(path.join(repo, 'README.md'), '# Three tiny files\n');
    fs.writeFileSync(path.join(repo, 'verify.cjs'), `const fs = require('node:fs');
const assert = require('node:assert/strict');
for (const name of ['alpha', 'beta', 'gamma']) if (fs.existsSync(name + '.txt')) assert.equal(fs.readFileSync(name + '.txt', 'utf8'), name + '\\n');
console.log('contents verified');\n`);
    await git('add', '.'); await git('commit', '-m', 'Smoke fixture');
    await human('init');
    fs.writeFileSync(path.join(repo, 'crew.config.ts'), `export default ${JSON.stringify({
      maxParallelAgents: 2, maxRetries: 1, maxDepth: 0, maxRuntimeMs: 120000, noOutputTimeoutMs: 90000,
      permissions: { allowCommands: ['node verify.cjs', 'git status', 'git diff', 'git add', 'git commit'] },
      verifyCommands: [{ name: 'content', command: 'node verify.cjs' }],
      roles: {
        orchestrator: { defaultPrompt: brief },
        backend: { defaultPrompt: 'Implement only your requested tiny file. Call crew remember with a learning, run node verify.cjs, then crew done.' },
      },
    }, null, 2)};\n`);
    await git('add', '.'); await git('commit', '-m', 'Configure Crew smoke');
    const base = await git('rev-parse', 'main');
    assert.equal(await git('branch', '--show-current'), 'main'); assert.equal(await git('status', '--porcelain'), '');
    db = createCrewDatabase({ dbPath: path.join(home, 'crew.db') });
    const workspace = db.db.select().from(schema.workspaces).get()!;
    const board = db.db.select().from(schema.boards).get()!;
    const team = db.db.select().from(schema.agents).all();
    assert.equal(team.length, 4, 'init must create Orchestrator, two workers and Reviewer');
    server = spawn(process.execPath, [cli, 'start', '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server.stdout!.on('data', data => process.stdout.write(data)); server.stderr!.on('data', data => process.stderr.write(data));
    const ordered = ['grill', 'spec', 'tickets', 'dispatch', 'integrate', 'done'];
    const reached: string[] = [];
    const answered = new Set<string>();
    const approved = new Set<string>();
    let rejected = false;
    // Poll durable state because the actual CLI server is a separate process.
    // Every mutation below is a real human CLI command, never a direct DB write.
    for (;;) {
      signal.throwIfAborted();
      assert.ok(server.exitCode === null && server.signalCode === null, 'crew start exited unexpectedly');
      assert.ok(!fs.existsSync(path.join(home, 'cap-exceeded')), 'Agent run cap exceeded');
      const current: typeof schema.boards.$inferSelect = db.db.select().from(schema.boards).get()!;
      if (reached.at(-1) !== current.currentPhase) {
        assert.equal(current.currentPhase, ordered[reached.length], `Phase skipped or out of order: ${reached}`);
        reached.push(current.currentPhase); console.log(`[phase] ${current.currentPhase}`);
      }
      const tasks = db.db.select().from(schema.tasks).all();
      const runs = db.db.select().from(schema.runs).all();
      assert.ok(runs.length <= MAX_RUNS, 'Unexpected retry loop');
      for (const task of tasks.filter(t => t.status === 'escalated')) {
        // Automatic retries are bounded by config; exhausted escalations fail
        // instead of resetting the allowance through a human retry.
        assert.equal(task.kind, 'phase', `Worker escalated: ${task.id}; inspect crew results`);
        // An exhausted automatic retry already consumed this task's allowance.
        // Do not reset its budget via unbounded human retries.
        throw new Error(`Orchestrator ${task.id} exhausted its configured retry; inspect logs, then crew retry ${task.id}`);
      }
      for (const task of tasks.filter(t => t.status === 'blocked')) {
        assert.equal(task.kind, 'phase', 'Worker unexpectedly asked a question');
        const questions = db.db.select().from(schema.messages).all().filter(m => m.taskId === task.id && m.type === 'question');
        const question = questions.at(-1)!;
        if (!answered.has(question.id)) {
          assert.ok(answered.size < 2, 'More grill questions than the run-cap allowance');
          await human('answer', task.id, brief); answered.add(question.id);
        }
      }
      const draft = db.db.select().from(schema.phaseOutputs).all().find(o => o.boardId === board.id && o.phase === current.currentPhase && o.status === 'draft');
      if (draft && !approved.has(draft.id)) {
        // Wait for gate process exit so an approval never masks a live agent.
        if (!runs.some(r => r.taskId === draft.taskId && !r.endedAt)) {
          if (current.currentPhase === 'tickets' && !rejected) {
            await human('approve', '--board', board.id, '--draft', draft.id, '--reject', '--note', 'Reuse the same three tickets. Clarify that Gamma depends on Alpha; create no duplicates.'); rejected = true;
          } else {
            await human('approve', '--board', board.id, '--draft', draft.id);
          }
          approved.add(draft.id);
        }
      }
      if (current.currentPhase === 'done' && runs.every(r => r.endedAt)) break;
      await delay(250, undefined, { signal });
    }
    assert.deepEqual(reached, ordered); assert.ok(rejected); assert.ok(answered.size >= 1, 'Grill never asked the human');
    const tasks = db.db.select().from(schema.tasks).all();
    const work = tasks.filter(t => t.kind === 'work');
    assert.equal(work.length, 3); assert.ok(work.every(t => t.status === 'merged'));
    const dependencies = db.db.select().from(schema.taskDependencies).all(); assert.equal(dependencies.length, 1);
    const runs = db.db.select().from(schema.runs).all();
    const roles = db.db.select().from(schema.roles).all();
    const orchestrators = team.filter(a => roles.find(r => r.id === a.roleId)?.name === 'orchestrator');
    const reviewers = team.filter(a => roles.find(r => r.id === a.roleId)?.name === 'reviewer');
    assert.equal(reviewers.length, 1);
    for (const phase of ['grill', 'spec', 'tickets', 'integrate']) {
      assert.ok(tasks.some(t => t.kind === 'phase' && t.creationPhase === phase && runs.some(r => r.taskId === t.id && r.adapter === 'claude-code' && r.exitReason === 'done' && r.endedAt)), `No completed real ${phase} Orchestrator run`);
    }
    const results = db.db.select().from(schema.verificationResults).all();
    assert.equal(new Set(work.flatMap(t => runs.filter(r => r.taskId === t.id && r.kind === 'work').map(r => r.agentId))).size, 2, 'Both real workers must run');
    for (const task of work) {
      assert.ok(runs.some(r => r.taskId === task.id && r.kind === 'review' && r.agentId === reviewers[0].id && r.adapter === 'claude-code' && r.exitReason === 'done' && results.some(v => v.runId === r.id && v.step === 'review' && v.passed && !/^skipped/i.test(v.output ?? ''))), `No real Reviewer verdict: ${task.id}`);
      assert.ok(!results.some(v => runs.some(r => r.id === v.runId && r.taskId === task.id) && v.step === 'review' && /^skipped/i.test(v.output ?? '')), `Review skipped: ${task.id}`);
      const merge: typeof schema.mergeQueueItems.$inferSelect = db.db.select().from(schema.mergeQueueItems).all().find(i => i.taskId === task.id)!;
      assert.ok(merge?.commitSha); await git('merge-base', '--is-ancestor', merge.commitSha, 'main');
      assert.ok((await git('show', '-s', '--format=%B', merge.commitSha)).includes(`Crew-Task: ${task.id}`));
    }
    for (const name of ['alpha', 'beta', 'gamma']) assert.equal(await git('show', `main:${name}.txt`), name);
    assert.equal(await git('rev-list', '--count', `${base}..main`), '3');
    const memory = db.db.select().from(schema.memory).all();
    assert.ok(memory.some(m => m.layer === 'project' && m.source?.startsWith('phase:spec:')));
    assert.ok(memory.some(m => m.layer === 'project' && m.title === 'Project summary' && m.source?.startsWith('phase:integrate:')));
    assert.ok(memory.some(m => m.layer === 'project' && m.promotedAt && m.source?.startsWith('promotion:') && memory.some(original => original.layer === 'role' && original.promotedAt && m.source === `promotion:${original.id}:${original.source}`)));
    // Inspect structured tool inputs and permission_denials, not just exit codes.
    for (const run of runs) {
      assert.ok(run.logPath && fs.existsSync(run.logPath), `Missing run log ${run.id}`);
      const text = fs.readFileSync(run.logPath, 'utf8');
      const events = text.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
      let tools = 0;
      const toolInputs = new Map<string, Record<string, any>>();
      const worktree = tasks.find(t => t.id === run.taskId)?.worktreePath;
      const inWorktree = (file: string) => !!file && path.resolve(worktree ?? repo, file).startsWith(path.join(home, 'worktrees') + path.sep);
      function inspect(value: unknown): void {
        if (!value || typeof value !== 'object') return;
        const item = value as Record<string, any>;
        if (item.type === 'tool_use' || item.tool_name) {
          tools++;
          const tool = item.name ?? item.tool_name;
          const input = item.input ?? item.tool_input ?? {};
          if (item.id) toolInputs.set(item.id, { tool, input });
          if (orchestrators.some(a => a.id === run.agentId) && tool === 'Bash') {
            assert.ok(!/\bcrew\s+(?:approve|answer|cancel|retry|stop-all|resume|init|start|status|tasks|diff|logs|results|queue|worktree|memory\s+(?:delete|edit))\b/.test(input.command ?? ''), `Orchestrator attempted human command: ${input.command}`);
          }
          if (tool === 'Read' && item.tool_name) {
            const file = input.file_path ?? input.path ?? '';
            assert.ok(!inWorktree(file), `Agent denied reading its own worktree: ${file}`);
          }
        }
        const call = toolInputs.get(item.tool_use_id);
        if (item.is_error && call?.tool === 'Read' && /(?:denied|permission|not allowed)/i.test(JSON.stringify(item))) {
          assert.ok(!inWorktree(call.input.file_path ?? call.input.path ?? ''), `Read denied inside worktree: ${JSON.stringify(call.input)}`);
        }
        // Tool-error messages also catch denials absent from permission_denials.
        if ((item.is_error || item.type === 'permission_denial') && /(?:denied|permission|not allowed)/i.test(JSON.stringify(item))) {
          assert.ok(!JSON.stringify(item).includes(path.join(home, 'worktrees')), `Worktree permission error: ${JSON.stringify(item)}`);
        }
        for (const nested of Object.values(item)) {
          if (Array.isArray(nested)) nested.forEach(inspect); else if (typeof nested === 'object') inspect(nested);
        }
      }
      events.forEach(inspect);
      assert.ok(tools > 0, `No tool evidence in log ${run.id}; cannot assert command/Read permissions`);
    }
    await human('stop-all');
    // Check process groups too: the cap launcher is a parent of real Claude.
    const processes = (await execa('ps', ['-eo', 'pid=,pgid=,stat='], { timeout: 10000 })).stdout.split('\n').map(line => line.trim().split(/\s+/));
    for (const run of runs) if (run.pid) assert.ok(!processes.some(([pid, pgid, stat]) => (Number(pid) === run.pid || Number(pgid) === run.pid) && !stat.startsWith('Z')), `Agent process group remains: ${run.pid}`);
    assert.equal(await git('status', '--porcelain'), '');
    await diagnostics(); succeeded = true;
  } finally {
    clearTimeout(timer);
    // Cleanup must work after the deadline aborts the normal CLI helper.
    if (server && server.exitCode === null && server.signalCode === null) {
      await execa(process.execPath, [cli, 'stop-all'], { cwd: repo, env, timeout: 15000, reject: false }).catch(console.error);
      const exited = once(server, 'exit'); server.kill('SIGTERM');
      const force = setTimeout(() => server?.kill('SIGKILL'), 15000);
      try { await exited; } finally { clearTimeout(force); }
    }
    if (!succeeded) await diagnostics().catch(error => console.error('Diagnostics failed:', error));
    db?.close();
    if (repo) console.log(`Artifacts retained: ${repo} and ${home}`);
  }
  console.log('Milestone 5 smoke passed: ordered phases, three reviewed merges, sourced memory/promotion, safe agent commands and no agent processes asserted.');
}
smoke().catch(error => { console.error('Milestone 5 smoke failed:', error); process.exitCode = 1; });
