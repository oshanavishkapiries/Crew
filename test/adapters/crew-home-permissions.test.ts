import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';

afterEach(() => vi.unstubAllEnvs());

it.each(['standard', 'full', 'read-only', 'orchestrator'] as const)('denies Crew home reads in %s spawn and resume, resolved each time', mode => {
  vi.stubEnv('CREW_HOME', process.env.CREW_HOME);
  const adapter = new ClaudeCodeAdapter();
  const options = { prompt: 'Read', workDir: '/tmp/work', permissions: { mode, allowedTools: ['Read'] } };
  for (const home of [undefined, '/tmp/custom crew-home', 'relative-crew-home']) {
    if (home === undefined) delete process.env.CREW_HOME;
    else vi.stubEnv('CREW_HOME', home);
    const resolved = home ? path.resolve(home) : path.join(os.homedir(), '.crew');
    for (const command of [adapter.buildSpawn(options), adapter.buildResume({ ...options, sessionId: 'session' })]) {
      const deny = command.args[command.args.indexOf('--disallowedTools') + 1];
      for (const name of ['server.json', 'crew.db', 'crew.db-wal', 'crew.db-shm', 'claude-settings.json']) expect(deny).toContain(`Read(/${resolved}/${name})`);
      expect(deny).toContain(`Read(/${resolved}/logs/**)`);
      // Worktrees live under the home; agents must be able to read their own.
      expect(deny).not.toContain(`Read(/${resolved}/**)`);
      expect(deny).not.toContain('worktrees');
      expect(command.args[command.args.indexOf('--allowedTools') + 1]).toContain('Read');
    }
  }
});

it('records a real dontAsk probe: Crew state denied, own worktree and normal files readable', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/claude-code/crew-home-read-dontask.json', import.meta.url), 'utf8'));
  expect(fixture.version).toMatch(/^2\.1\./);
  expect(fixture.timedOut).toBe(false);
  expect(fixture.total_cost_usd).toBeLessThanOrEqual(0.50);
  expect(fixture.args[fixture.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
  expect(fixture.permission_denials).toHaveLength(1);
  expect(fixture.permission_denials[0].tool_name).toBe('Read');
  expect(fixture.permission_denials[0].tool_input.file_path).toContain('/server.json');
  const results = fixture.tools.filter((tool: any) => tool.type === 'tool_result');
  expect(results).toHaveLength(3);
  expect(results[0].is_error).toBe(true);
  expect(results[1].is_error).not.toBe(true);
  expect(JSON.stringify(results[1].content)).toContain('WORKTREE_READ_PROBE');
  expect(results[2].is_error).not.toBe(true);
  expect(JSON.stringify(results[2].content)).toContain('NORMAL_READ_PROBE');
});
