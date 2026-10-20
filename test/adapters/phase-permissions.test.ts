import fs from 'node:fs';
import { expect, it } from 'vitest';
import { ClaudeCodeAdapter } from '../../src/adapters/claude-code.js';
it('scopes the phase output Edit rule in spawn and resume without a broad Edit denial or write grant', () => {
  const adapter = new ClaudeCodeAdapter();
  const options = { prompt: 'Phase', workDir: '/tmp/phase', permissions: { mode: 'orchestrator' as const, phaseOutputPath: '/tmp/phase/phase-output.md' } };
  for (const command of [adapter.buildSpawn(options), adapter.buildResume({ ...options, sessionId: 'session' })]) {
    expect(command.args[command.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
    expect(command.args).toContain('--setting-sources');
    expect(command.args[command.args.indexOf('--setting-sources') + 1]).toBe('');
    const allow = command.args[command.args.indexOf('--allowedTools') + 1];
    expect(allow).toContain('Edit(//tmp/phase/phase-output.md)'); expect(allow.split(' ')).not.toContain('Edit'); expect(allow).not.toContain('Write');
    const deny = command.args[command.args.indexOf('--disallowedTools') + 1]; expect(deny.split(' ')).not.toContain('Edit'); expect(deny).toContain('Bash(git push)');
  }
});
it('records real dontAsk allowed/denied Edit tool results and an authenticated real crew phase done POST', () => {
  const fixture = JSON.parse(fs.readFileSync(new URL('../fixtures/claude-code/phase-output-dontask.json', import.meta.url), 'utf8'));
  expect(fixture.version).toBe('2.1.300'); expect(fixture.args[fixture.args.indexOf('--permission-mode') + 1]).toBe('dontAsk');
  expect(fixture.output).toBe('OUTPUT_AFTER\n'); expect(fixture.other).toBe('OTHER_BEFORE\n');
  expect(fixture.tools.filter((tool: any) => tool.type === 'tool_use' && tool.name === 'Edit')).toHaveLength(2);
  expect(fixture.tools.some((tool: any) => tool.type === 'tool_result' && tool.is_error)).toBe(true);
  expect(fixture.permission_denials).toHaveLength(1);
  expect(fixture.calls).toEqual([{ method: 'POST', path: '/api/tasks/fixture-phase/phase-done', output: 'OUTPUT_AFTER\n', agentAuthenticated: true }]);
});
