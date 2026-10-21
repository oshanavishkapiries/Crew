import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/board-logic.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { createCoalescer, dependencyPath } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('event bursts coalesce and events during a request schedule one follow-up', async () => {
  const timers = [];
  const pending = [];
  let calls = 0;
  const coalescer = createCoalescer(() => { calls++; return new Promise(resolve => pending.push(resolve)); }, cb => { timers.push(cb); return () => timers.splice(timers.indexOf(cb), 1); });
  for (let i = 0; i < 100; i++) coalescer.invalidate();
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(calls, 1);
  for (let i = 0; i < 100; i++) coalescer.invalidate();
  assert.equal(timers.length, 0);
  pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(calls, 2);
  coalescer.invalidate();
  coalescer.dispose();
  pending.shift()();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 0);
});

test('dependency geometry uses card edges and container-relative coordinates', () => {
  const path = dependencyPath({ left: 20, top: 30, width: 100, height: 60 }, { left: 300, top: 110, width: 100, height: 60 });
  assert.ok(path.startsWith('M 120 60 '));
  assert.ok(path.endsWith('300 140'));
  assert.ok(!path.includes('NaN'));
  assert.notEqual(path, dependencyPath({ left: 20, top: 30, width: 100, height: 60 }, { left: 400, top: 110, width: 100, height: 60 }));
});

test('a resumed live run invalidates detail even with an unchanged task timestamp', async () => {
  const { needsTaskSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
  assert.equal(needsTaskSnapshot('same-time', { version: 'same-time', runs: [{ id: 'ended-run' }] }, ['resumed-run']), true);
  assert.equal(needsTaskSnapshot('same-time', { version: 'same-time', runs: [{ id: 'resumed-run' }] }, ['resumed-run']), false);
});
