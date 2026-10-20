import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';
let h: PipelineHarness; let receiver: Server;
afterEach(async () => { if (receiver) await new Promise<void>(resolve => receiver.close(() => resolve())); await h?.cleanup(); });
it('sends the exact phase output file through the real CLI with agent credentials', async () => {
  h = await createPipelineHarness();
  const calls: any[] = [];
  receiver = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    calls.push({ url: req.url, token: req.headers['x-crew-agent-token'], secret: req.headers['x-crew-secret'], body: JSON.parse(body) });
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ success: true }));
  });
  await new Promise<void>(resolve => receiver.listen(0, '127.0.0.1', resolve));
  const port = (receiver.address() as { port: number }).port;
  const file = path.join(h.repoDir, 'phase-output.md'); fs.writeFileSync(file, '# Exact output\nUnicode: café\n');
  const result = await h.runCrew(['phase', 'done', '--output', file], { CREW_SERVER_URL: `http://127.0.0.1:${port}`, CREW_AGENT_TOKEN: h.agentToken, CREW_TASK_ID: 'phase-context' });
  expect(result.exitCode, result.stderr).toBe(0);
  expect(calls).toEqual([{ url: '/api/tasks/phase-context/phase-done', token: h.agentToken, secret: undefined, body: { output: '# Exact output\nUnicode: café\n' } }]);
});
