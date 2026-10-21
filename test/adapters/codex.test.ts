import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter, MINIMUM_CODEX_VERSION } from '../../src/adapters/codex.js';
const fixture = (name: string) => fs.readFileSync(path.resolve('test/fixtures/codex', `${name}.jsonl`), 'utf8');
const originalPath = process.env.PATH;
const temporary: string[] = [];
afterEach(() => { process.env.PATH = originalPath; for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe('Codex adapter contract (real 0.163.0 JSONL)', () => {
  it.each([['read-only', 'read-only'], ['standard', 'workspace-write'], ['orchestrator', 'workspace-write'], ['full', 'danger-full-access'], [undefined, 'workspace-write']] as const)('maps %s explicitly for spawn and resume', (mode, sandbox) => {
    const adapter = new CodexAdapter();
    const options = { prompt: 'private prompt', workDir: '/tmp/with space', permissions: { mode, allowCommands: ['npm test'], denyCommands: ['curl'] }, taskId: 'task', serverUrl: 'http://127.0.0.1:1234', agentToken: 'test-only-token' };
    for (const config of [adapter.buildSpawn(options), adapter.buildResume({ ...options, sessionId: 'thread-id' })]) {
      expect(config.command).toBe('codex');
      expect(config.args[config.args.indexOf('-s') + 1]).toBe(sandbox);
      expect(config.args[config.args.indexOf('-C') + 1]).toBe(options.workDir);
      expect(config.args).toContain('--json'); expect(config.args.at(-1)).toBe('-');
      expect(config.args).toContain('approval_policy="never"');
      expect(config.args).toContain('sandbox_workspace_write.network_access=false');
      expect(config.args).toContain('--ignore-user-config'); expect(config.args).toContain('--ignore-rules');
      expect(config.args.join(' ')).not.toContain(options.agentToken); expect(config.args.join(' ')).not.toContain(options.prompt);
      expect(config.env).toMatchObject({ CREW_TASK_ID: 'task', CREW_SERVER_URL: options.serverUrl, CREW_AGENT_TOKEN: options.agentToken });
    }
    const resume = adapter.buildResume({ ...options, sessionId: 'thread-id' });
    expect(resume.args.slice(-4)).toEqual(['resume', '--json', 'thread-id', '-']);
    expect(resume.env.CREW_SESSION_ID).toBe('thread-id');
  });
  it('maps explicit network access', () => {
    expect(new CodexAdapter().buildSpawn({ prompt: '', workDir: '/tmp', permissions: { allowNetwork: true } }).args).toContain('sandbox_workspace_write.network_access=true');
  });
  it('parses edit and resume fixtures, capturing the actual thread identity', () => {
    const events = new CodexAdapter().parseOutput(fixture('short-task'));
    const thread = (events[0].data as any).thread_id;
    expect(thread).toBeTruthy(); expect(events.every(event => event.sessionId === thread)).toBe(true);
    expect(events.some(event => (event.data as any).item?.type === 'command_execution')).toBe(true);
    expect(events.at(-1)?.type).toBe('turn.completed');
    const resumed = new CodexAdapter().parseOutput(fixture('resume'));
    expect(resumed[0].sessionId).toBe(thread); expect(resumed.at(-1)?.isError).toBe(false);
  });
  it('parses the real read-only response (CLI records no command-execution event)', () => {
    const events = new CodexAdapter().parseOutput(fixture('read-only'));
    expect(events.at(-1)?.type).toBe('turn.completed');
    expect(events.some(event => (event.data as any).item?.text?.includes('read-only'))).toBe(true);
  });
  it('handles split JSON, diagnostics, malformed lines and concurrent run parsers', () => {
    const adapter = new CodexAdapter(); const a = adapter.createOutputParser(); const b = adapter.createOutputParser();
    const raw = fixture('short-task'); const expected = adapter.createOutputParser()(raw);
    const actual = [];
    for (let i = 0; i < raw.length; i += 7) actual.push(...a(raw.slice(i, i + 7)));
    expect(actual.map(({ timestamp, ...event }) => event)).toEqual(expected.map(({ timestamp, ...event }) => event));
    expect(b('diagnostic\n{bad}\n{"type":"thread.started","thread_id":"other"}\n')[0].sessionId).toBe('other');
    expect(a('{"type":"turn.started"}')[0].sessionId).toBe(expected[0].sessionId);
  });
  it('recognizes clearly labelled synthetic rate-limit errors without treating ordinary tool failures as limits', () => {
    const adapter = new CodexAdapter(); const events = adapter.parseOutput(fixture('rate-limit-synthetic'));
    expect(events.map(event => adapter.isRateLimit(event))).toEqual([false, true, true]);
    expect(events[1].rateLimitResetTime).toBe(new Date(1792406400000).toISOString());
    for (const raw of ['{"type":"turn.failed","error":{"message":"Authentication required"}}', '{"type":"item.completed","item":{"type":"command_execution","aggregated_output":"rate limit", "exit_code":1}}']) expect(adapter.isRateLimit(adapter.parseOutput(raw)[0])).toBe(false);
  });
  it('detects missing, old, supported and failed executables without requiring installed or paid Codex', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-codex-detect-')); temporary.push(dir); process.env.PATH = dir;
    const adapter = new CodexAdapter(); expect(await adapter.detect()).toEqual({ installed: false, headless: false });
    for (const version of ['0.162.0', MINIMUM_CODEX_VERSION, '1.0.0']) {
      fs.writeFileSync(path.join(dir, 'codex'), `#!/bin/sh\necho codex-cli ${version}\n`, { mode: 0o755 });
      expect(await adapter.detect()).toEqual({ installed: true, version, headless: version !== '0.162.0' });
    }
    fs.writeFileSync(path.join(dir, 'codex'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expect((await adapter.detect()).headless).toBe(false);
  });
});
