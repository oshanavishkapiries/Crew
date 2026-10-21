import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/task-logic.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { appendLog, parseHistory, renderEvent, splitDiff, selectLogRun, runLogPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
test('long runs bound both event count and individual payload size', () => {
  let state = [];
  for (let i = 0; i < 1200; i++) state = appendLog(state, { type: 'text', text: `${i} ${'x'.repeat(20000)}` });
  assert.equal(state.length, 500);
  assert.ok(state[0].text.startsWith('700 '));
  assert.ok(state.every(entry => entry.text.length <= 8000));
});
test('history preserves text and tool calls as distinct entries, tolerating non-JSON', () => {
  const entries = parseHistory('plain output\n{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"tool_use","name":"Read","input":{"file":"a.ts"}}]}}\n');
  assert.equal(entries[0].text, 'plain output');
  assert.equal(entries[1].type, 'text');
  assert.equal(entries[1].text, 'hello');
  assert.equal(entries[2].type, 'tool');
  assert.match(entries[2].text, /Read/);
  assert.equal(renderEvent('tool_call', { tool: 'done', result: 'ok' })[0].type, 'tool');
});
test('diffs group files, classify headers correctly and truncate large output', () => {
  const parsed = splitDiff('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n-old\n+new\ndiff --git a/b.ts b/b.ts\n+second');
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].lines[2].kind, 'meta');
  assert.equal(parsed.files[0].lines[3].kind, 'deletion');
  assert.equal(parsed.files[0].lines[4].kind, 'addition');
  assert.equal(splitDiff('a'.repeat(250001)).truncated, true);
});

test('reconnect snapshot retains events arriving in flight and ignores stale responses', async () => {
  const { createLogBuffer } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  const buffer = createLogBuffer();
  const first = buffer.begin();
  buffer.receive({type:'text',text:'first live'});
  buffer.finish(first, [{type:'text',text:'history'}]);
  const older = buffer.begin();
  buffer.receive({type:'text',text:'during reconnect'});
  const newer = buffer.begin();
  assert.equal(buffer.finish(older, []), false);
  assert.equal(buffer.finish(newer, [{type:'text',text:'new history'}]), true);
  assert.deepEqual(buffer.entries().map(entry => entry.text), ['new history','during reconnect']);
});

test('a diff with thousands of tiny lines also has a bounded DOM', () => {
  const parsed = splitDiff('+x\n'.repeat(4000));
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.files.reduce((total, file) => total + file.lines.length, 0) <= 3000);
});

test('run history selection stays on an older run while latest advances; request pins task/run/tail', () => {
  const runs = [{id:'old'}, {id:'live'}];
  assert.equal(selectLogRun(runs, 'latest').id, 'live');
  assert.equal(selectLogRun([...runs, {id:'new'}], 'old').id, 'old');
  assert.equal(selectLogRun(runs, 'missing'), undefined);
  assert.equal(selectLogRun([], 'latest'), undefined);
  const url = new URL(runLogPath('a/b', 'old / run', 262144), 'http://localhost');
  assert.equal(url.pathname, '/api/tasks/a%2Fb/logs');
  assert.equal(url.searchParams.get('run'), 'old / run');
  assert.equal(url.searchParams.get('tail'), '262144');
});
