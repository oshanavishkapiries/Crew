import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../lib/api.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('cookie transport, mutation header, JSON and empty responses', async () => {
  const original = globalThis.fetch;
  try {
    const calls = [];
    globalThis.fetch = async (path, init) => { calls.push({ path, init }); return init.method === 'POST' ? new Response(null, { status: 204 }) : Response.json({ boards: [] }); };
    assert.deepEqual(await api('/api/boards'), { boards: [] });
    assert.equal(calls[0].init.credentials, 'same-origin');
    assert.equal(calls[0].init.headers.has('X-Crew-Board'), false);
    assert.equal(await api('/api/session', { method: 'POST', body: JSON.stringify({ key: 'test-only' }) }), undefined);
    assert.equal(calls[1].init.headers.get('X-Crew-Board'), '1');
    assert.equal(calls[1].init.headers.get('Content-Type'), 'application/json');
  } finally { globalThis.fetch = original; }
});

test('server error message and unauthorized event, including plain text errors', async () => {
  const original = globalThis.fetch;
  const originalWindow = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target;
  let unauthorized = 0;
  target.addEventListener('crew:unauthorized', () => unauthorized++);
  try {
    globalThis.fetch = async () => Response.json({ error: 'Session expired' }, { status: 401 });
    await assert.rejects(api('/api/boards'), error => error instanceof ApiError && error.status === 401 && error.message === 'Session expired');
    assert.equal(unauthorized, 1);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    await assert.rejects(api('/api/boards'), error => error instanceof ApiError && error.message === 'Unavailable');
    globalThis.fetch = async () => { throw new TypeError('network'); };
    await assert.rejects(api('/api/boards'), error => error instanceof ApiError && error.status === 0);
    await assert.rejects(api('https://example.com/api/boards'), error => error instanceof ApiError);
    globalThis.fetch = async () => new Response('Not JSON');
    await assert.rejects(api('/api/boards'), error => error instanceof ApiError);

  } finally { globalThis.fetch = original; globalThis.window = originalWindow; }
});
