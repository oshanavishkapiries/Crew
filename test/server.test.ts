import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET_HEADER } from '../src/server/api/security.js';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import { EventBus } from '../src/server/events/index.js';
import { startServer, type RunningServer } from '../src/server/index.js';

// fetch() always sends the URL's own Host, so a forged Host header needs a raw request
function rawGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('Server and SSE endpoints (D13, PRD)', () => {
  let server: RunningServer;
  let eventBus: EventBus;
  let db: CrewDatabase;
  let tempDir: string;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-server-test-'));
    process.env.CREW_HOME = tempDir;

    db = createCrewDatabase({ inMemory: true });
    eventBus = new EventBus();

    // Start server on random available port (0 allows OS to pick free port)
    server = await startServer({
      port: 0,
      host: '127.0.0.1',
      db,
      eventBus,
    });
  });

  afterAll(async () => {
    await server.close();
    db.close();
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('responds 200 to /health with valid localhost Host header', async () => {
    const res = await fetch(`${server.url}/health`, {
      headers: {
        host: `127.0.0.1:${server.port}`,
      },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('rejects requests with invalid Host header (403 Forbidden, D13)', async () => {
    for (const host of ['evil.attacker.com', 'localhost.evil.com', '127.0.0.1.nip.io:4000']) {
      const { status, body } = await rawGet(server.port, '/health', { Host: host });
      expect(status, host).toBe(403);
      expect(body).toContain('Forbidden');
    }
  });

  it('accepts the bracketed IPv6 loopback Host header', async () => {
    const { status } = await rawGet(server.port, '/health', { Host: `[::1]:${server.port}` });
    expect(status).toBe(200);
  });

  it('rejects SSE streams without the per-start secret (401, D13)', async () => {
    for (const path of ['/api/board/board-1/events', '/api/runs/run-1/stream']) {
      const missing = await fetch(`${server.url}${path}`);
      expect(missing.status, path).toBe(401);

      const wrong = await fetch(`${server.url}${path}`, { headers: { [SECRET_HEADER]: 'not-the-secret' } });
      expect(wrong.status, path).toBe(401);
    }
  });

  it('rejects task reads without credentials (401, D13)', async () => {
    const res = await fetch(`${server.url}/api/tasks/any-task`);
    expect(res.status).toBe(401);
  });

  it('streams board events over SSE (/api/board/:id/events)', async () => {
    const boardId = 'board-sse-1';

    const response = await fetch(`${server.url}/api/board/${boardId}/events`, {
      headers: {
        accept: 'text/event-stream',
        [SECRET_HEADER]: server.perStartSecret,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();

    // Read initial connection event
    const firstChunk = await reader!.read();
    const firstText = decoder.decode(firstChunk.value);
    expect(firstText).toContain('event: connected');

    // Trigger board event via event bus
    setTimeout(() => {
      eventBus.publishBoardEvent(boardId, {
        type: 'task_created',
        data: { taskId: 'task-100', title: 'New Task' },
      });
    }, 50);

    // Read the triggered event
    const secondChunk = await reader!.read();
    const secondText = decoder.decode(secondChunk.value);

    expect(secondText).toContain('event: task_created');
    expect(secondText).toContain('task-100');

    await reader!.cancel();
  });

  it('streams run events over SSE (/api/runs/:id/stream)', async () => {
    const runId = 'run-sse-1';

    const response = await fetch(`${server.url}/api/runs/${runId}/stream`, {
      headers: {
        accept: 'text/event-stream',
        [SECRET_HEADER]: server.perStartSecret,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();

    const firstChunk = await reader!.read();
    const firstText = decoder.decode(firstChunk.value);
    expect(firstText).toContain('event: connected');

    setTimeout(() => {
      eventBus.publishRunEvent(runId, {
        type: 'output_chunk',
        data: { text: 'Compiling TypeScript...' },
      });
    }, 50);

    const secondChunk = await reader!.read();
    const secondText = decoder.decode(secondChunk.value);

    expect(secondText).toContain('event: output_chunk');
    expect(secondText).toContain('Compiling TypeScript...');

    await reader!.cancel();
  });
});
