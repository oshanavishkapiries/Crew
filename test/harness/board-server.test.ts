import * as fs from 'node:fs';
import * as http from 'node:http';
import { execa } from 'execa';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import { startServer } from '../../src/server/index.js';
import * as schema from '../../src/server/db/schema.js';

let h: PipelineHarness;
const ui = path.resolve('dist/ui');
const backup = path.resolve('dist/ui-board-test-backup');
const human = () => ({ 'X-Crew-Secret': h.server.perStartSecret });
const request = (route: string, init?: RequestInit) => fetch(h.server.url + route, init);
async function freshKey(): Promise<string> {
  const res = await request('/api/session/key', { method: 'POST', headers: human() });
  expect(res.status).toBe(200);
  return (await res.json() as { key: string }).key;
}
async function login(key: string): Promise<Response> {
  return request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
}
async function cookie(): Promise<string> {
  const res = await login(await freshKey());
  expect(res.status).toBe(204);
  return res.headers.get('set-cookie')!.split(';')[0];
}
beforeEach(async () => { h = await createPipelineHarness(); });
afterEach(async () => { await h.cleanup(); });

describe('Board server prerequisites', () => {
  it('exchanges a single-use key once, guards cookie mutations and logs out', async () => {
    for (const route of ['/api/boards', '/api/agents', `/api/agents/${h.agentId}`, '/api/roles', `/api/board/${h.boardId}/events`, '/api/runs/missing/stream']) expect((await request(route)).status).toBe(401);
    expect((await request('/api/session')).status).toBe(401);
    expect((await request('/api/session/key', { method: 'POST' })).status).toBe(401);
    expect((await login('wrong')).status).toBe(401);
    expect((await request('/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' })).status).toBe(401);
    expect((await request('/api/session', { headers: { Cookie: 'crew_session=invalid' } })).status).toBe(401);
    const key = await freshKey();
    const results = await Promise.all([login(key), login(key)]);
    expect(results.map(r => r.status).sort()).toEqual([204, 401]);
    const loggedIn = results.find(r => r.status === 204)!;
    const setCookie = loggedIn.headers.get('set-cookie')!;
    expect(setCookie.includes('HttpOnly')).toBe(true);
    expect(setCookie.includes('SameSite=Strict')).toBe(true);
    expect(setCookie.includes('Path=/')).toBe(true);
    const headers = { Cookie: setCookie.split(';')[0] };
    expect((await request('/api/session', { headers })).status).toBe(204);
    expect((await request('/api/boards', { headers })).status).toBe(200);
    expect((await request('/api/control/stop-all', { method: 'POST', headers })).status).toBe(403);
    expect((await request('/api/control/stop-all', { method: 'POST', headers: { ...headers, 'X-Crew-Board': '1' } })).status).toBe(200);
    const wrongHost = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: h.server.port, path: '/api/boards', headers: { ...headers, Host: 'evil.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.end();
    });
    expect(wrongHost).toBe(403);
    expect((await request('/api/session', { method: 'DELETE', headers })).status).toBe(403);
    expect((await request('/api/session', { method: 'DELETE', headers: { ...headers, 'X-Crew-Board': '1' } })).status).toBe(204);
    expect((await request('/api/session', { headers })).status).toBe(401);
  });

  it('prints a working single-use fragment URL from the real crew start command', async () => {
    const home = path.join(h.repoDir, 'fresh-home');
    const child = execa(process.execPath, [path.resolve('dist/cli.js'), 'start', '--port', '0'], {
      cwd: h.repoDir, env: { CREW_HOME: home, PATH: process.env.PATH }, extendEnv: false, reject: false,
    });
    try {
      const loginUrl = await new Promise<string>((resolve, reject) => {
        let output = '';
        child.stdout!.on('data', chunk => {
          output += chunk.toString();
          const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#key=[a-f0-9]+/);
          if (match) resolve(match[0]);
        });
        void child.then(() => reject(new Error('Server exited before printing its Board URL')), reject);
      });
      const parsed = new URL(loginUrl);
      const response = await fetch(parsed.origin + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: parsed.hash.slice(5) }) });
      expect(response.status).toBe(204);
      const info = fs.readFileSync(path.join(home, 'server.json'), 'utf8');
      expect(info.includes(parsed.hash.slice(5))).toBe(false);
    } finally { child.kill('SIGTERM'); await child; }
    expect(fs.existsSync(path.join(home, 'server.json'))).toBe(false);
  });

  it('rejects agent tokens on session and persona endpoints, even with human credentials', async () => {
    const headers = { ...human(), 'X-Crew-Agent-Token': h.agentToken, 'Content-Type': 'application/json' };
    for (const [route, method] of [['/api/boards', 'GET'], ['/api/agents', 'GET'], [`/api/agents/${h.agentId}`, 'GET'], ['/api/roles', 'GET'], ['/api/session', 'GET'], ['/api/session', 'DELETE'], ['/api/session', 'POST'], ['/api/session/key', 'POST'], [`/api/agents/${h.agentId}`, 'PATCH']] as const) {
      for (const credentials of [headers, { 'X-Crew-Agent-Token': h.agentToken, 'Content-Type': 'application/json' }]) {
        expect((await request(route, { method, headers: credentials, ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}) })).status).toBe(403);
      }
    }
  });

  it('crew open repairs a used key or lost cookie, prints a fresh fragment URL and handles browser failure', async () => {
    const first = await cookie();
    const browser = path.join(h.repoDir, 'browser-stub');
    fs.writeFileSync(browser, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const successful = await h.runCrew(['open'], { BROWSER: browser });
    expect(successful.exitCode).toBe(0);
    expect(successful.stderr).toBe('');
    const result = await h.runCrew(['open'], { BROWSER: '/nonexistent/crew-browser' });
    expect(result.exitCode).toBe(0);
    const url = result.stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#key=([^\s]+)/);
    expect(Boolean(url)).toBe(true);
    expect(result.stderr).toContain('browser');
    const response = await login(url![1]);
    expect(response.status).toBe(204);
    expect((await login(url![1])).status).toBe(401);
    expect((await request('/api/session', { headers: { Cookie: first } })).status).toBe(204);
    expect(fs.statSync(path.join(h.crewHomeDir, 'server.json')).mode & 0o777).toBe(0o600);
    const info = JSON.parse(fs.readFileSync(path.join(h.crewHomeDir, 'server.json'), 'utf8'));
    expect(Object.keys(info).sort()).toEqual(['pid', 'secret', 'url']);
    expect((await h.runCrew(['open'], { CREW_AGENT_TOKEN: h.agentToken })).exitCode).toBe(1);
  });

  it('crew open explains recovery for missing, malformed and unreachable server discovery', async () => {
    const home = path.join(h.repoDir, 'missing-home');
    const missing = await h.runCrew(['open'], { CREW_HOME: home });
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain('crew start');
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'server.json'), 'invalid JSON', { mode: 0o600 });
    const malformed = await h.runCrew(['open'], { CREW_HOME: home });
    expect(malformed.exitCode).toBe(1);
    expect(malformed.stderr).toContain('Failed to read');
    fs.writeFileSync(path.join(home, 'server.json'), JSON.stringify({ url: 'http://127.0.0.1:0', secret: 'unused-test-value', pid: process.pid }));
    const unreachable = await h.runCrew(['open'], { CREW_HOME: home });
    expect(unreachable.exitCode).toBe(1);
    expect(unreachable.stderr).toContain('crew start');
    // Repair the discovery file through a real start and retry is covered by the start/restart cases.
  });

  it('invalidates cookies and unused keys on restart and recovers with crew open', async () => {
    const oldCookie = await cookie();
    const key = await freshKey();
    await h.server.close();
    const restarted = await startServer({ port: 0, db: h.db, eventBus: h.eventBus, scheduler: h.scheduler, runner: h.runner, dispatcher: h.dispatcher, worktreeManager: h.worktreeManager });
    try {
      expect((await fetch(restarted.url + '/api/session', { headers: { Cookie: oldCookie } })).status).toBe(401);
      expect((await fetch(restarted.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) })).status).toBe(401);
      const opened = await h.runCrew(['open'], { BROWSER: '/nonexistent/crew-browser' });
      expect(opened.exitCode).toBe(0);
      const newKey = opened.stdout.match(/#key=([^\s]+)/)![1];
      expect((await fetch(restarted.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: newKey }) })).status).toBe(204);
    } finally { await restarted.close(); }
  });

  it('returns Board resource shapes, validates persona edits and exposes complete task details', async () => {
    const session = await cookie();
    const headers = { Cookie: session, 'X-Crew-Board': '1', 'Content-Type': 'application/json' };
    expect((await request('/api/session/key', { method: 'POST', headers })).status).toBe(401);
    expect((await request(`/api/agents/${h.agentId}`, { method: 'PATCH', headers: { Cookie: session }, body: '{"name":"bad"}' })).status).toBe(403);
    const boards = await (await request('/api/boards', { headers })).json() as { boards: unknown[] };
    expect(boards.boards[0]).toMatchObject({ id: h.boardId, workspaceId: h.workspaceId, currentPhase: 'dispatch', stopped: false, workspace: { id: h.workspaceId, name: 'Harness Workspace' } });
    const agents = await (await request('/api/agents', { headers })).json() as { agents: Record<string, unknown>[] };
    expect(agents.agents[0]).toMatchObject({ id: h.agentId, name: 'Fake Backend Agent', roleId: h.roleId, personality: '', systemPrompt: '', status: 'idle' });
    expect('tokenHash' in agents.agents[0]).toBe(false);
    expect((await (await request('/api/roles', { headers })).json() as { roles: unknown[] }).roles[0]).toMatchObject({ id: h.roleId, name: 'backend', defaultPrompt: 'You are a backend test agent.' });
    const edit = await request(`/api/agents/${h.agentId}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'Ada', personality: 'precise', systemPrompt: 'Check assumptions.' }) });
    expect(edit.status).toBe(200);
    const agent = (await (await request(`/api/agents/${h.agentId}`, { headers })).json() as { agent: Record<string, unknown> }).agent;
    expect(agent).toMatchObject({ name: 'Ada', personality: 'precise', systemPrompt: 'Check assumptions.' });
    expect('tokenHash' in agent).toBe(false);
    for (const body of ['null', '[]', '{}', '{"roleId":"other"}', '{"name":" "}', '{"personality":3}', '{"systemPrompt":null}']) {
      expect((await request(`/api/agents/${h.agentId}`, { method: 'PATCH', headers, body })).status).toBe(400);
    }
    expect((await request('/api/agents/missing', { headers })).status).toBe(404);
    const repaired = await request(`/api/agents/${h.agentId}`, { method: 'PATCH', headers, body: '{"name":"Grace"}' });
    expect(repaired.status).toBe(200);
    expect((await request('/api/agents/missing', { method: 'PATCH', headers, body: '{"name":"Ada"}' })).status).toBe(404);
    await h.createTask({ id: 'blocker', title: 'Blocker', description: 'first' });
    await h.createTask({ id: 'detail', title: 'Detail', description: 'second', blockedByIds: ['blocker'] });
    h.db.db.insert(schema.runs).values({ id: 'detail-run', taskId: 'detail', agentId: h.agentId, adapter: 'fake', startedAt: new Date() }).run();
    h.db.db.insert(schema.messages).values({ id: 'detail-msg', taskId: 'detail', type: 'comment', body: 'progress', createdAt: new Date() }).run();
    h.db.db.insert(schema.verificationResults).values({ id: 'detail-result', runId: 'detail-run', step: 'test', passed: true, createdAt: new Date() }).run();
    h.db.db.insert(schema.mergeQueueItems).values({ id: 'detail-merge', taskId: 'detail', position: 1, status: 'merged', commitSha: 'abc123', createdAt: new Date() }).run();
    await h.createTask({ id: 'branch-commits', title: 'Branch commits', description: 'history' });
    await h.runTaskWithAgent('branch-commits', [{ type: 'git', args: ['commit', '--allow-empty', '-m', 'Agent work'] }]);
    const branchDetail = await (await request('/api/tasks/branch-commits', { headers })).json() as { commits: { sha: string; subject: string; source: string }[] };
    expect(branchDetail.commits).toEqual([{ sha: expect.stringMatching(/^[a-f0-9]{40}$/), subject: 'Agent work', source: 'branch' }]);
    const detail = await (await request('/api/tasks/detail', { headers })).json();
    expect(detail).toMatchObject({ task: { id: 'detail' }, messages: [{ id: 'detail-msg' }], runs: [{ id: 'detail-run' }], verificationResults: [{ id: 'detail-result', passed: true }], dependencies: [{ taskId: 'detail', blockedByTaskId: 'blocker' }], commits: [{ sha: 'abc123', source: 'merge' }] });
  });

  it('serves fallback and fake dist/ui, isolates API routes, blocks traversal and symlinks, caches only hashed assets', async () => {
    if (fs.existsSync(ui)) fs.renameSync(ui, backup);
    try {
      expect(await (await request('/')).text()).toContain('npm run build:ui');
      fs.mkdirSync(path.join(ui, '_next/static/chunks'), { recursive: true });
      fs.writeFileSync(path.join(ui, 'index.html'), '<h1>Fake Board</h1>');
      fs.writeFileSync(path.join(ui, 'team.html'), '<h1>Fake Team</h1>');
      fs.mkdirSync(path.join(ui, 'memory'));
      fs.writeFileSync(path.join(ui, 'memory/index.html'), '<h1>Fake Memory</h1>');
      fs.writeFileSync(path.join(ui, '_next/static/chunks/app-a1b2c3d4.js'), 'console.log("board")');
      fs.writeFileSync(path.join(ui, 'plain.css'), 'body{}');
      fs.symlinkSync(path.join(h.crewHomeDir, 'server.json'), path.join(ui, 'leak.json'));
      expect(await (await request('/')).text()).toBe('<h1>Fake Board</h1>');
      expect(await (await request('/board/details')).text()).toBe('<h1>Fake Board</h1>');
      expect(await (await request('/team')).text()).toBe('<h1>Fake Team</h1>');
      expect(await (await request('/memory/')).text()).toBe('<h1>Fake Memory</h1>');
      const js = await request('/_next/static/chunks/app-a1b2c3d4.js');
      expect(js.headers.get('content-type')).toContain('javascript');
      expect(js.headers.get('cache-control')).toContain('immutable');
      const css = await request('/plain.css');
      expect(css.headers.get('content-type')).toContain('text/css');
      expect(css.headers.get('cache-control')).not.toContain('immutable');
      expect((await request('/')).headers.get('cache-control')).not.toContain('immutable');
      expect((await request('/api/not-real')).status).toBe(404);
      expect((await request('/_next/missing.js')).status).toBe(404);
      expect((await request('/leak.json')).status).toBe(403);
      expect((await request('/%2e%2e%2fserver.json')).status).toBe(403);
      expect((await request('/bad%ZZ')).status).toBe(400);
      fs.unlinkSync(path.join(ui, 'index.html'));
      const incomplete = await request('/');
      expect(incomplete.status).toBe(503);
      expect(await incomplete.text()).toContain('npm run build:ui');
      fs.writeFileSync(path.join(ui, 'index.html'), '<h1>Rebuilt Board</h1>');
      expect(await (await request('/')).text()).toBe('<h1>Rebuilt Board</h1>');
    } finally {
      if (fs.existsSync(ui)) fs.rmSync(ui, { recursive: true });
      if (fs.existsSync(backup)) fs.renameSync(backup, ui);
    }
  });

  it('streams cookie-authenticated local and global events once without leaking other boards', async () => {
    const controller = new AbortController();
    const headers = { Cookie: await cookie() };
    const response = await request(`/api/board/${h.boardId}/events`, { headers, signal: controller.signal });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain('event: connected');
    h.eventBus.publishBoardEvent('foreign-board', { type: 'foreign_event', data: {} });
    h.eventBus.publishBoardEvent('*', { type: 'rate_limited', data: { tool: 'fake' } });
    h.eventBus.publishBoardEvent(h.boardId, { type: 'task_progress', data: { taskId: 'test', message: 'hello' } });
    await request('/api/control/stop-all', { method: 'POST', headers: { ...headers, 'X-Crew-Board': '1' } });
    await request('/api/control/resume', { method: 'POST', headers: { ...headers, 'X-Crew-Board': '1' } });
    try {
      while (!text.includes('"stopped":false')) text += decoder.decode((await reader.read()).value);
      expect(text.match(/event: rate_limited/g)).toHaveLength(1);
      expect(text.match(/event: task_progress/g)).toHaveLength(1);
      expect(text).not.toContain('foreign_event');
      expect(text).toContain('"stopped":true');
    } finally { controller.abort(); await reader.cancel().catch(() => {}); }
    const runController = new AbortController();
    const run = await request('/api/runs/fake-run/stream', { headers, signal: runController.signal });
    expect(run.status).toBe(200);
    runController.abort();
  });
});
