import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/agent-logic.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { agentState, relativeHeartbeat } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('retired, paused and disconnected states override old live-run data', () => {
  for (const state of ['stale', 'stopped', 'rate-limited', 'disconnected']) assert.equal(agentState(state, true), state);
  assert.equal(agentState('connected', true), 'running');
  assert.equal(agentState('connected', false), 'connected');
});
test('relative heartbeat handles missing, malformed, future and elapsed times', () => {
  const now = Date.parse('2026-10-22T10:00:00Z');
  assert.equal(relativeHeartbeat(null, now), 'Not reported');
  assert.equal(relativeHeartbeat('invalid', now), 'Not reported');
  assert.equal(relativeHeartbeat('2026-10-22T10:00:01Z', now), 'just now');
  assert.equal(relativeHeartbeat('2026-10-22T09:59:45Z', now), '15s ago');
  assert.equal(relativeHeartbeat('2026-10-22T09:58:00Z', now), '2m ago');
  assert.equal(relativeHeartbeat('2026-10-22T08:00:00Z', now), '2h ago');
});
