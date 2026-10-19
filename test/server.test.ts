import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCrewDatabase, type CrewDatabase } from '../src/server/db/index.js';
import { EventBus } from '../src/server/events/index.js';
import { startServer, type RunningServer } from '../src/server/index.js';

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
    const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/health',
          method: 'GET',
          headers: {
            Host: 'evil.attacker.com',
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(status).toBe(403);
    expect(body).toContain('Forbidden');
  });

  it('streams board events over SSE (/api/board/:id/events)', async () => {
    const boardId = 'board-sse-1';

    const response = await fetch(`${server.url}/api/board/${boardId}/events`, {
      headers: {
        host: `127.0.0.1:${server.port}`,
        accept: 'text/event-stream',
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
        host: `127.0.0.1:${server.port}`,
        accept: 'text/event-stream',
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
