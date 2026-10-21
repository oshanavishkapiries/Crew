import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const transpile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const apiModule = url(transpile(await readFile(new URL('../lib/api.ts', import.meta.url), 'utf8')));
const sessionModule = url(transpile((await readFile(new URL('../lib/session.ts', import.meta.url), 'utf8')).replace("'./api'", JSON.stringify(apiModule))));
const { establishSession } = await import(sessionModule);

test('fragment is removed before exchange and concurrent mounts share one POST', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const location = { hash: '#key=synthetic-fixture', pathname: '/', search: '' };
  const replaced = [];
  globalThis.window = { location, history: { replaceState: (...args) => { replaced.push(args); location.hash = ''; } } };
  const calls = [];
  let resolve;
  globalThis.fetch = (path, init) => {
    assert.equal(location.hash, '');
    calls.push({ path, init });
    return new Promise(done => { resolve = done; });
  };
  try {
    const a = establishSession();
    const b = establishSession();
    assert.equal(a, b);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, '/api/session');
    assert.equal(calls[0].init.method, 'POST');
    assert.equal(calls[0].init.body, JSON.stringify({ key: 'synthetic-fixture' }));
    assert.equal(replaced[0][2], '/');
    resolve(new Response(null, { status: 204 }));
    await Promise.all([a, b]);
    const check = establishSession();
    assert.equal(calls.length, 2);
    assert.equal(calls[1].init.method, 'GET');
    resolve(new Response(null, { status: 204 }));
    await check;
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});

test('a fresh fragment exchanges its key even when an older session check is in flight', async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const location = { hash: '', pathname: '/', search: '' };
  globalThis.window = { location, history: { replaceState: () => { location.hash = ''; } } };
  const calls = [];
  const responses = [];
  globalThis.fetch = (path, init) => { calls.push(init); return new Promise(resolve => responses.push(resolve)); };
  try {
    const old = establishSession();
    location.hash = '#key=new-synthetic-fixture';
    const fresh = establishSession();
    assert.notEqual(old, fresh);
    assert.equal(location.hash, '');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[0].signal.aborted, true);
    responses.forEach(resolve => resolve(new Response(null, { status: 204 })));
    await Promise.all([old, fresh]);
  } finally { responses.forEach(resolve => resolve(new Response(null, { status: 204 }))); globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});
