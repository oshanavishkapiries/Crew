import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa, type ResultPromise } from 'execa';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createCrewDatabase, type CrewDatabase } from '../../src/server/db/index.js';
import * as schema from '../../src/server/db/schema.js';
import { startServer, type RunningServer } from '../../src/server/index.js';
import { FakeAdapter } from '../../src/adapters/fake.js';
import type { PermissionProfile } from '../../src/adapters/types.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

const cli = path.resolve('dist/cli.js');
const temporary: string[] = [];
const children: ResultPromise[] = [];
const databases: CrewDatabase[] = [];
let server: RunningServer | undefined;
let harness: PipelineHarness | undefined;
const originalHome = process.env.CREW_HOME;
afterEach(async () => {
  await server?.runner.killAll();
  await server?.close(); server = undefined;
  await harness?.cleanup(); harness = undefined;
  for (const child of children.splice(0)) { child.kill('SIGTERM'); await child.catch(() => {}); }
  for (const db of databases.splice(0)) db.close();
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  if (originalHome === undefined) delete process.env.CREW_HOME; else process.env.CREW_HOME = originalHome;
});
async function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-config-')); temporary.push(root);
  const cwd = path.join(root, 'repo'); const home = path.join(root, 'home'); fs.mkdirSync(cwd); fs.mkdirSync(home);
  for (const args of [['init', '-b', 'main'], ['config', 'user.email', 'test@crew.local'], ['config', 'user.name', 'Test']]) await execa('git', args, { cwd });
  fs.writeFileSync(path.join(cwd, 'README.md'), 'initial\n');
  await execa('git', ['add', '.'], { cwd }); await execa('git', ['commit', '-m', 'initial'], { cwd });
  const run = (args: string[], where = cwd) => execa(process.execPath, [cli, ...args], { cwd: where, env: { CREW_HOME: home }, reject: false, timeout: 10000 });
  return { cwd, home, run, config: path.join(cwd, 'crew.config.ts') };
}
async function start(cwd: string, home: string) {
  const child = execa(process.execPath, [cli, 'start', '--port', '0'], { cwd, env: { CREW_HOME: home }, reject: false }); children.push(child);
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`start timed out: ${output}`)), 10000);
    child.stdout!.on('data', (chunk) => { output += chunk; if (output.includes('Crew server listening at')) { clearTimeout(timer); resolve(); } });
    child.then((result) => { clearTimeout(timer); reject(new Error(`start exited: ${result.stderr}`)); }, reject);
  });
  return { child };
}
function open(home: string) { const db = createCrewDatabase({ dbPath: path.join(home, 'crew.db') }); databases.push(db); return db; }

describe('Config and init', () => {
  it('initializes twice from a subdirectory without duplicating entities or overwriting the config', async () => {
    const r = await repo(); const nested = path.join(r.cwd, 'nested'); fs.mkdirSync(nested);
    expect((await r.run(['init'], nested)).exitCode).toBe(0);
    const db = open(r.home); const before = {
      workspaces: db.db.select().from(schema.workspaces).all(), boards: db.db.select().from(schema.boards).all(),
      roles: db.db.select().from(schema.roles).all(), agents: db.db.select().from(schema.agents).all(),
    };
    fs.appendFileSync(r.config, '\n// keep my configuration\n'); const bytes = fs.readFileSync(r.config);
    const again = await r.run(['init']); expect(again.exitCode).toBe(0); expect(again.stdout).toContain('crew start');
    expect(fs.readFileSync(r.config)).toEqual(bytes);
    expect(db.db.select().from(schema.workspaces).all()).toEqual(before.workspaces);
    expect(db.db.select().from(schema.boards).all()).toEqual(before.boards);
    expect(db.db.select().from(schema.roles).all()).toEqual(before.roles);
    expect(db.db.select().from(schema.agents).all()).toEqual(before.agents);
    expect(before.workspaces).toHaveLength(1); expect(before.workspaces[0].repoPath).toBe(fs.realpathSync(r.cwd));
    expect(before.workspaces[0].defaultBranch).toBe('main'); expect(before.boards[0].currentPhase).toBe('grill');
    expect(before.roles.map((role) => role.name).sort()).toEqual(['architect', 'backend', 'frontend', 'orchestrator', 'qa', 'reviewer']);
    expect(before.roles.every((role) => role.isBuiltin && role.defaultPrompt.length > 20)).toBe(true);
    expect(before.agents).toHaveLength(4); expect(before.agents.every((agent) => agent.cliType === 'claude-code' && agent.mode === 'spawn')).toBe(true);
    expect(before.agents.map((agent) => before.roles.find((role) => role.id === agent.roleId)!.name).sort()).toEqual(['backend', 'backend', 'orchestrator', 'reviewer']);
    expect(JSON.stringify(before)).not.toContain('crew_agent_');
  });

  it('loads real TypeScript config on each CLI start and replaces stored config, including imported changes', async () => {
    const r = await repo(); expect((await r.run(['init'])).exitCode).toBe(0);
    const db = open(r.home); const helper = path.join(r.cwd, 'settings.ts');
    fs.writeFileSync(helper, 'export const retries: number = 1;\n');
    fs.writeFileSync(r.config, `import { retries } from './settings.ts';\nexport default { maxRetries: retries, verifyCommands: [{ name: 'check', command: 'node verify.cjs', timeout: 1234, paths: ['*.ts'] }], worktreeSetup: 'echo ready', mergeStrategy: 'rebase', maxParallelAgents: 1, maxParallelVerifications: 1, maxRuntimeMs: 4567, noOutputTimeoutMs: 2345, maxDepth: 2, maxTicketsPerPhase: 4, memoryBudgetTokens: 2000, workflow: { gates: { spec: false } }, permissions: { allowCommands: ['npm test'] }, roles: { backend: { defaultPrompt: 'Project-specific backend instructions.' } } };\n`);
    let { child } = await start(r.cwd, r.home);
    const config = db.db.select().from(schema.workspaces).get()!.config!;
    expect(config).toMatchObject({ maxRetries: 1, mergeStrategy: 'rebase', worktreeSetup: 'echo ready', maxParallelAgents: 1, maxParallelVerifications: 1, maxRuntimeMs: 4567, noOutputTimeoutMs: 2345, maxDepth: 2, maxTicketsPerPhase: 4, memoryBudgetTokens: 2000, permissions: { allowCommands: ['npm test'] }, workflow: { gates: { spec: false } }, roles: { backend: { defaultPrompt: 'Project-specific backend instructions.' } } });
    expect(config.verifyCommands).toEqual([{ name: 'check', command: 'node verify.cjs', timeout: 1234, paths: ['*.ts'] }]);
    child.kill('SIGTERM'); await child;
    fs.writeFileSync(helper, 'export const retries: number = 2;\n');
    ({ child } = await start(r.cwd, r.home)); expect(db.db.select().from(schema.workspaces).get()!.config!.maxRetries).toBe(2);
    child.kill('SIGTERM'); await child;
    fs.writeFileSync(r.config, 'export default { mergeStrategy: "squash" };\n');
    ({ child } = await start(r.cwd, r.home)); expect(db.db.select().from(schema.workspaces).get()!.config).toMatchObject({ mergeStrategy: 'squash' });
    expect(db.db.select().from(schema.workspaces).get()!.config).not.toHaveProperty('worktreeSetup');
  });

  it.each([
    ['syntax', 'export default {\n  maxRetries: ,\n};', /crew\.config\.ts:2/],
    ['runtime', 'throw new Error("broken environment");\nexport default {};', /broken environment/],
    ['invalid value', 'export default { maxRetries: -1 };', /maxRetries/],
    ['unknown option', 'export default { maxRetires: 2 };', /maxRetires/],
  ])('stops start for a %s config error and recovers after the file is fixed', async (_label, content, diagnostic) => {
    const r = await repo(); await r.run(['init']); const db = open(r.home); const before = db.db.select().from(schema.workspaces).get()!.config;
    fs.writeFileSync(r.config, content);
    const bad = await r.run(['start', '--port', '0']); expect(bad.exitCode).not.toBe(0); expect(bad.stderr).toContain(r.config);
    expect(bad.stderr).toMatch(diagnostic); expect(bad.stderr).toContain('Fix'); expect(fs.existsSync(path.join(r.home, 'server.json'))).toBe(false);
    expect(db.db.select().from(schema.workspaces).get()!.config).toEqual(before);
    fs.writeFileSync(r.config, 'export default {};'); await start(r.cwd, r.home);
  });

  it('refuses init outside git and preserves an existing user config', async () => {
    const r = await repo(); const outside = path.join(r.home, 'outside'); fs.mkdirSync(outside);
    const bad = await r.run(['init'], outside); expect(bad.exitCode).not.toBe(0); expect(bad.stderr).toContain('git repository');
    fs.writeFileSync(r.config, '// user file\nexport default { maxRetries: 1 };\n'); const bytes = fs.readFileSync(r.config);
    expect((await r.run(['init'])).exitCode).toBe(0); expect(fs.readFileSync(r.config)).toEqual(bytes);
  });

  it('keeps two workspaces and their role overrides independent across CLI restart', async () => {
    const a = await repo(); const b = await repo();
    const runB = (args: string[]) => execa(process.execPath, [cli, ...args], { cwd: b.cwd, env: { CREW_HOME: a.home }, reject: false });
    await a.run(['init']); expect((await runB(['init'])).exitCode).toBe(0);
    fs.writeFileSync(a.config, `export default { roles: { backend: { defaultPrompt: 'Workspace A' }, specialist: { defaultPrompt: 'Specialist A', permissionProfile: { mode: 'standard', allowCommands: ['npm test'] } } } };`);
    fs.writeFileSync(b.config, `export default { roles: { backend: { defaultPrompt: 'Workspace B' }, specialist: { defaultPrompt: 'Specialist B' } } };`);
    const db = open(a.home); await start(a.cwd, a.home);
    const workspaces = db.db.select().from(schema.workspaces).all(); expect(workspaces).toHaveLength(2);
    expect(workspaces.find((workspace) => workspace.repoPath === a.cwd)!.config).toMatchObject({ roles: { backend: { defaultPrompt: 'Workspace A' }, specialist: { defaultPrompt: 'Specialist A', permissionProfile: { mode: 'standard', allowCommands: ['npm test'] } } } });
    expect(workspaces.find((workspace) => workspace.repoPath === b.cwd)!.config).toMatchObject({ roles: { backend: { defaultPrompt: 'Workspace B' }, specialist: { defaultPrompt: 'Specialist B' } } });
    expect(db.db.select().from(schema.roles).all()).toHaveLength(8);
    const custom = db.db.select().from(schema.roles).all().filter((role) => !role.isBuiltin);
    expect(custom.map((role) => role.defaultPrompt).sort()).toEqual(['Specialist A', 'Specialist B']);
    expect(custom[0].id).not.toBe(custom[1].id);
    expect(db.db.select().from(schema.agents).all()).toHaveLength(8);
  });

  it('initializes missing team and role entities for a previously registered milestone 4 workspace without duplicating its board', async () => {
    const r = await repo(); const db = open(r.home); const now = new Date();
    db.db.insert(schema.workspaces).values({ id: 'legacy-workspace', name: 'Keep name', repoPath: r.cwd, defaultBranch: 'main', config: { maxRetries: 2 }, createdAt: now }).run();
    db.db.insert(schema.boards).values({ id: 'legacy-board', workspaceId: 'legacy-workspace', currentPhase: 'dispatch', createdAt: now }).run();
    const before = db.db.select().from(schema.workspaces).get();
    expect((await r.run(['init'])).exitCode).toBe(0); expect((await r.run(['init'])).exitCode).toBe(0);
    expect(db.db.select().from(schema.workspaces).get()).toEqual(before);
    expect(db.db.select().from(schema.boards).all()).toHaveLength(1); expect(db.db.select().from(schema.boards).get()!.id).toBe('legacy-board');
    expect(db.db.select().from(schema.roles).all()).toHaveLength(6); expect(db.db.select().from(schema.agents).all()).toHaveLength(4);
  });

  it('removing a custom role from the file revokes its persisted permissions without deleting referenced identities', async () => {
    const r = await repo(); await r.run(['init']); const db = open(r.home);
    fs.writeFileSync(r.config, `export default { roles: { specialist: { defaultPrompt: 'Old privileged instructions', permissionProfile: { mode: 'full' } } } };`);
    const { child } = await start(r.cwd, r.home); child.kill('SIGTERM'); await child;
    const role = db.db.select().from(schema.roles).all().find((role) => role.name === 'specialist')!;
    expect(role.permissionProfile.mode).toBe('full');
    const workspace = db.db.select().from(schema.workspaces).get()!;
    db.db.insert(schema.agents).values({ id: 'keep-specialist', workspaceId: workspace.id, roleId: role.id, name: 'Existing specialist', cliType: 'claude-code', tokenHash: 'hash', createdAt: new Date() }).run();
    fs.writeFileSync(r.config, 'export default {};'); await start(r.cwd, r.home);
    const reset = db.db.select().from(schema.roles).where(eq(schema.roles.id, role.id)).get()!;
    expect(reset.permissionProfile).toEqual({ mode: 'standard' }); expect(reset.defaultPrompt).not.toContain('Old privileged instructions');
    expect(db.db.select().from(schema.agents).where(eq(schema.agents.id, 'keep-specialist')).get()!.roleId).toBe(role.id);
  });

  it('a real config cannot grant broad Git or global-option push prefixes to editing roles', async () => {
    const r = await repo(); await r.run(['init']); const db = open(r.home);
    fs.writeFileSync(r.config, `export default { permissions: { allowCommands: ['git', 'git -C .', 'git -C . push', 'git push', 'git diff', 'git add', 'npm test'] } };`);
    const { child } = await start(r.cwd, r.home); child.kill('SIGTERM'); await child;
    process.env.CREW_HOME = r.home; server = await startServer({ port: 0, db });
    const received: PermissionProfile[] = [];
    class RecordingAdapter extends FakeAdapter { override buildSpawn(options: Parameters<FakeAdapter['buildSpawn']>[0]) { received.push(structuredClone(options.permissions)); return super.buildSpawn(options); } }
    server.runner.registerAdapter('claude-code', new RecordingAdapter([{ type: 'done', result: 'checked' }]));
    const agent = db.db.select().from(schema.agents).all().find((agent) => agent.name === 'Developer 1')!;
    const board = db.db.select().from(schema.boards).get()!;
    await server.scheduler.createTask({ id: 'push-config', boardId: board.id, title: 'Safe config', description: 'Check effective permissions', assigneeAgentId: agent.id, roleId: agent.roleId });
    await server.scheduler.transitionTask('push-config', 'doing'); expect((await server.runner.runTask('push-config')).exitReason).toBe('done');
    expect(received[0].allowCommands).toEqual(['git diff', 'git add', 'npm test']);
  });

  it('uses configured reviewer prompts in the actual verification pipeline', async () => {
    harness = await createPipelineHarness({ startVerifier: true }); const h = harness;
    const role = h.addRole('project-reviewer', 'reviewer'); h.addAgent('project-reviewer-agent', role);
    h.db.db.update(schema.workspaces).set({ config: { roles: { reviewer: { defaultPrompt: 'Review against the project-specific contract.' } } } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
    const author = [{ type: 'edit_file' as const, filePath: 'review-config.txt', content: 'change' }, { type: 'done' as const, result: 'ready' }];
    h.fakeAdapter.setRunScripts([author, [{ type: 'review', action: 'approve' }]]);
    await h.createTask({ id: 'configured-review', title: 'Configured review', description: 'Check reviewer prompt' });
    await h.runTaskWithAgent('configured-review', author); await h.waitForTaskStatus('configured-review', 'merge-queue'); await h.waitForLiveRuns(0);
    const review = h.db.db.select().from(schema.runs).all().find((run) => run.kind === 'review')!;
    expect(review.prompt).toContain('Review against the project-specific contract.'); expect(review.exitReason).toBe('done');
  });

  it('passes the workspace role Stop hook setting to the adapter and creates the settings file', async () => {
    harness = await createPipelineHarness(); const h = harness;
    h.db.db.update(schema.workspaces).set({ config: { roles: { backend: { permissionProfile: { mode: 'standard', stopHook: true } } } } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
    const settings: (string | undefined)[] = [];
    class RecordingAdapter extends FakeAdapter { override buildSpawn(options: Parameters<FakeAdapter['buildSpawn']>[0] & { settingsPath?: string }) { settings.push(options.settingsPath); return super.buildSpawn(options); } }
    h.runner.registerAdapter('fake', new RecordingAdapter([{ type: 'done', result: 'checked' }]));
    await h.createTask({ id: 'configured-hook', title: 'Configured hook', description: 'Use role hook' }); await h.scheduler.transitionTask('configured-hook', 'doing'); await h.runner.runTask('configured-hook');
    expect(settings[0]).toBe(path.join(h.crewHomeDir, 'claude-settings.json')); expect(fs.existsSync(settings[0]!)).toBe(true);
    expect(JSON.parse(fs.readFileSync(settings[0]!, 'utf8')).hooks.Stop).toBeDefined();
  });

  it('the initialized default team authenticates with newly minted in-memory tokens after each server restart', async () => {
    const r = await repo(); await r.run(['init']); process.env.CREW_HOME = r.home; const db = open(r.home);
    const agent = db.db.select().from(schema.agents).all().find((agent) => agent.name === 'Developer 1')!;
    const board = db.db.select().from(schema.boards).get()!; let previousHash = agent.tokenHash;
    let previousToken: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      server = await startServer({ port: 0, db });
      expect(server.runner.getAgentToken(agent.id)).toBeUndefined();
      const fake = new FakeAdapter([{ type: 'update', message: `authenticated ${attempt}` }, { type: 'done', result: 'ready' }]); server.runner.registerAdapter('claude-code', fake);
      const task = await server.scheduler.createTask({ id: `restart-${attempt}`, boardId: board.id, title: 'Authenticate', description: 'Use the real CLI after restart', roleId: agent.roleId, assigneeAgentId: agent.id });
      await server.scheduler.transitionTask(task.id, 'doing'); const result = await server.runner.runTask(task.id);
      expect(result.exitReason).toBe('done');
      expect(db.db.select().from(schema.messages).all().some((message) => message.body === `authenticated ${attempt}`)).toBe(true);
      const hash = db.db.select().from(schema.agents).where(eq(schema.agents.id, agent.id)).get()!.tokenHash; expect(hash).not.toBe(previousHash); previousHash = hash;
      if (previousToken) {
        const response = await fetch(`${server.url}/api/tasks/${task.id}/report`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Crew-Agent-Token': previousToken }, body: JSON.stringify({ message: 'stale' }) }); expect(response.status).toBe(401);
      }
      previousToken = server.runner.getAgentToken(agent.id); expect(previousToken).toBeTruthy();
      await server.close(); server = undefined;
    }
  });

  it('enforces configured run timeouts and retry limits instead of constructor defaults', async () => {
    const timers = new Map<number, { delay: number; callback: () => void }>(); let nextTimer = 0;
    harness = await createPipelineHarness({ clock: { now: () => Date.now(), setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { delay, callback }); return id; }, clearTimeout: (id) => { timers.delete(id); } } });
    const h = harness;
    h.db.db.update(schema.workspaces).set({ config: { maxRuntimeMs: 1234, noOutputTimeoutMs: 789, maxRetries: 0 } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
    await h.createTask({ id: 'configured-timeout', title: 'Run timeout', description: 'Use configured limits' });
    h.fakeAdapter.setScript([{ type: 'hang' }]); await h.scheduler.transitionTask('configured-timeout', 'doing');
    let childPid = 0;
    const childStarted = new Promise<void>((resolve) => { const unsubscribe = h.eventBus.subscribeRunEvents('*', (event) => {
      const data = event.data as { grandchildPid?: number }; if (data?.grandchildPid) { childPid = data.grandchildPid; unsubscribe(); resolve(); }
    }); });
    const run = await h.runner.startRun({ taskId: 'configured-timeout' }); await childStarted;
    expect([...timers.values()].map((timer) => timer.delay)).toEqual(expect.arrayContaining([1234, 789]));
    [...timers.values()].find((timer) => timer.delay === 1234)!.callback();
    const result = await run.promise; expect(result.exitReason).toBe('timeout'); expect(h.getTask('configured-timeout')!.status).toBe('escalated');
    expect(h.getTask('configured-timeout')!.retries).toBe(1);
    expect(() => process.kill(run.pid!, 0)).toThrow(); expect(() => process.kill(childPid, 0)).toThrow();
    // The fake process handles SIGTERM; discard the unused kill-grace callback.
    timers.clear();
  });

  it('honours a workspace dispatch limit of one even when the process has three slots', async () => {
    harness = await createPipelineHarness({ maxParallelAgents: 3 }); const h = harness;
    h.db.db.update(schema.workspaces).set({ config: { maxParallelAgents: 1 } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
    h.addAgent('second-developer'); h.fakeAdapter.setScript([{ type: 'hang' }]);
    await h.createTask({ id: 'limit-first', title: 'First', description: 'First', assigneeAgentId: h.agentId });
    await h.createTask({ id: 'limit-second', title: 'Second', description: 'Second', assigneeAgentId: 'second-developer' });
    await h.dispatcher.dispatchOnce(); expect(h.runner.getLiveRuns()).toHaveLength(1);
    expect(h.getTask('limit-first')!.status).toBe('doing'); expect(h.getTask('limit-second')!.status).toBe('ready');
    await h.runCrew(['stop-all']); await h.waitForLiveRuns(0);
  });

  it('injects config role prompts and command prefixes into editing roles, with fixed push denial and isolated reviewer permissions', async () => {
    harness = await createPipelineHarness(); const h = harness;
    h.db.db.update(schema.workspaces).set({ config: { permissions: { allowCommands: ['npm test', 'git push'] }, roles: { backend: { defaultPrompt: 'Use project-specific conventions.' } } } }).where(eq(schema.workspaces.id, h.workspaceId)).run();
    const received: PermissionProfile[] = [];
    class RecordingAdapter extends FakeAdapter {
      override buildSpawn(options: Parameters<FakeAdapter['buildSpawn']>[0]) { received.push(structuredClone(options.permissions)); return super.buildSpawn(options); }
    }
    h.runner.registerAdapter('fake', new RecordingAdapter([{ type: 'done', result: 'done' }]));
    await h.createTask({ id: 'config-prompt', title: 'Config prompt', description: 'Apply config' }); await h.scheduler.transitionTask('config-prompt', 'doing');
    const result = await h.runner.runTask('config-prompt'); expect(result.exitReason).toBe('done');
    expect(h.db.db.select().from(schema.runs).get()!.prompt).toContain('Use project-specific conventions.');
    expect(received[0].allowCommands).toContain('npm test'); expect(received[0].allowCommands).not.toContain('git push');
    const role = h.addRole('reviewer', 'reviewer'); h.addAgent('reviewer-agent', role);
    await h.runner.startRun({ taskId: 'config-prompt', agentId: 'reviewer-agent', kind: 'review', prompt: 'Review' }).then((run) => run.promise);
    expect(received[1].mode).toBe('read-only'); expect(received[1].allowCommands).toEqual([]);
  });
});
