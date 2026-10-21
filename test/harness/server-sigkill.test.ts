import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { execa } from 'execa';
import { expect, it } from 'vitest';
import { createCrewDatabase } from '../../src/server/db/index.js';
import * as schema from '../../src/server/db/schema.js';

// This is deliberately an OS-process experiment: the real built CLI/server and
// Claude adapter, with only the paid claude executable replaced by a local stub.
it('reaps the surviving agent after server SIGKILL so a new start runs exactly one Orchestrator (D77)', async () => {
  const repo = fs.mkdtempSync('/tmp/crew-kill-repo-');
  const home = fs.mkdtempSync('/tmp/crew-kill-home-');
  const bin = path.join(home, 'stub-bin'); fs.mkdirSync(bin);
  const cli = path.resolve('dist/cli.js');
  const env = { ...process.env, CREW_HOME: home, PATH: `${bin}:${process.env.PATH}`, CREW_AGENT_TOKEN: '', CREW_SECRET: '', CREW_SERVER_URL: '' };
  const human = (...args: string[]) => execa(process.execPath, [cli, ...args], { cwd: repo, env, timeout: 15000 });
  const git = (...args: string[]) => execa('git', args, { cwd: repo });
  let server: ChildProcess | undefined;
  const agents: number[] = [];
  let db: ReturnType<typeof createCrewDatabase> | undefined;
  function alive(pid: number) { try { process.kill(pid, 0); return true; } catch { return false; } }
  function changed(predicate: () => boolean) {
    return new Promise<void>((resolve, reject) => {
      const watcher = fs.watch(home, () => { if (predicate()) finish(); });
      const timer = setTimeout(() => { watcher.close(); reject(new Error('Timed out waiting for child readiness')); }, 15000);
      function finish() { clearTimeout(timer); watcher.close(); resolve(); }
      if (predicate()) finish();
    });
  }
  async function start() {
    const child = spawn(process.execPath, [cli, 'start', '--port', '0'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    server = child;
    await new Promise<void>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`Server failed to listen: ${output}`)), 15000);
      child.stdout!.on('data', chunk => { output += chunk; if (output.includes('Crew server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
      child.stderr!.on('data', chunk => { output += chunk; });
    });
    return child;
  }
  try {
    await git('init', '-b', 'main'); await git('config', 'user.name', 'Kill Test'); await git('config', 'user.email', 'kill@crew.local');
    fs.writeFileSync(path.join(repo, 'README.md'), 'Kill fixture\n'); await git('add', '.'); await git('commit', '-m', 'Fixture');
    await human('init'); await git('add', '.'); await git('commit', '-m', 'Crew config');
    fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
if (process.argv.includes('--version')) { console.log('2.1.305'); process.exit(0); }
process.stdout.on('error', () => {});
fs.writeFileSync(process.env.CREW_HOME + '/agent-' + process.pid, String(process.pid));
setInterval(() => {}, 60000);
`, { mode: 0o755 });
    db = createCrewDatabase({ dbPath: path.join(home, 'crew.db') });
    const board = db.db.select().from(schema.boards).get()!;
    const firstReady = changed(() => fs.readdirSync(home).some(f => f.startsWith('agent-')));
    const firstServer = await start(); await firstReady;
    const oldPid = Number(fs.readdirSync(home).find(f => f.startsWith('agent-'))!.slice(6)); agents.push(oldPid);
    const task = db.db.select().from(schema.tasks).get()!;
    expect(task).toMatchObject({ kind: 'phase', creationPhase: 'grill', status: 'doing' });
    const killed = once(firstServer, 'exit'); firstServer.kill('SIGKILL'); await killed;
    expect(alive(oldPid)).toBe(true);
    const secondReady = changed(() => fs.readdirSync(home).filter(f => f.startsWith('agent-')).length === 2);
    await start(); await secondReady;
    const newPid = Number(fs.readdirSync(home).find(f => f.startsWith('agent-') && f !== `agent-${oldPid}`)!.slice(6)); agents.push(newPid);
    // The startup reaper killed the old agent group before the Dispatcher started a replacement.
    await expect.poll(() => alive(oldPid)).toBe(false);
    expect(alive(newPid)).toBe(true);
    expect(db.db.select().from(schema.tasks).all()).toHaveLength(1);
    expect(db.db.select().from(schema.tasks).get()).toMatchObject({ status: 'doing', retries: 0 });
    expect(db.db.select().from(schema.boards).get()?.currentPhase).toBe('grill');
    const runs = db.db.select().from(schema.runs).all().filter(r => r.taskId === task.id);
    expect(runs.filter(r => !r.endedAt)).toHaveLength(1);
    expect(runs.find(r => r.pid === oldPid)).toMatchObject({ exitReason: 'stopped' });
    await human('stop-all'); await expect.poll(() => alive(newPid)).toBe(false);
    // The replacement run is stopped; resume lets a recovered run produce its output.
    fs.writeFileSync(path.join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
fs.writeFileSync('phase-output.md', 'Recovered grill output');
execFileSync(process.execPath, [${JSON.stringify(cli)}, 'phase', 'done', '--output', 'phase-output.md'], { env: process.env });
fs.writeFileSync(process.env.CREW_HOME + '/recovered', 'yes');
`, { mode: 0o755 });
    const recovered = changed(() => fs.existsSync(path.join(home, 'recovered')));
    await human('resume'); await recovered;
    const draft = db.db.select().from(schema.phaseOutputs).get()!;
    expect(draft).toMatchObject({ taskId: task.id, status: 'draft', body: 'Recovered grill output' });
    await human('stop-all');
    await human('approve', '--board', board.id, '--draft', draft.id);
    expect(db.db.select().from(schema.boards).get()?.currentPhase).toBe('spec');
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) { const exit = once(server, 'exit'); server.kill('SIGTERM'); await exit; }
    for (const pid of agents) { try { process.kill(-pid, 'SIGKILL'); } catch {} }
    db?.close();
    fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(home, { recursive: true, force: true });
  }
}, 60000);
