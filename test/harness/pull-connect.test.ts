import { afterEach, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createPipelineHarness, type PipelineHarness } from './index.js';
import * as schema from '../../src/server/db/schema.js';
import { AGENT_TOKEN_HEADER, SECRET_HEADER, hashToken } from '../../src/server/api/security.js';
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function setup() {
  h = await createPipelineHarness();
  h.db.db.update(schema.agents).set({ mode: 'pull', cliType: 'antigravity' }).where(eq(schema.agents.id, h.agentId)).run();
}
const secret = () => ({ [SECRET_HEADER]: h.server.perStartSecret });
const url = () => h.server.url + `/api/agents/${h.agentId}/connect`;
function extractToken(prompt: string) {
  const token = /CREW_AGENT_TOKEN='([^']+)'/.exec(prompt)?.[1];
  expect(Boolean(token)).toBe(true); return token!;
}

it('human CLI connect by name/ID mints a private token, invalidates the old one, and does not store the plaintext', async () => {
  await setup();
  const name = h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!.name;
  const result = await h.runCrew(['connect', name]);
  expect(result.exitCode).toBe(0);
  const firstToken = extractToken(result.stdout);
  // Boolean assertions ensure a failure can never dump the private prompt/token to the test log.
  for (const text of ['crew *', 'crew join', 'crew next --wait 90', 'clear your context', 'CREW_RUN_ID', 'replaces the previous token']) expect(result.stdout.includes(text)).toBe(true);
  const row = h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!;
  expect(row.tokenHash === hashToken(firstToken)).toBe(true);
  expect(JSON.stringify(row).includes(firstToken)).toBe(false);
  const join = (token: string) => fetch(h.server.url + '/api/agents/join', { method: 'POST', headers: { [AGENT_TOKEN_HEADER]: token } });
  expect((await join(h.agentToken)).status).toBe(401);
  expect((await join(firstToken)).status).toBe(200);
  const second = await h.runCrew(['connect', h.agentId]); expect(second.exitCode).toBe(0);
  const secondToken = extractToken(second.stdout);
  expect(firstToken !== secondToken).toBe(true);
  expect((await join(firstToken)).status).toBe(401);
  expect((await join(secondToken)).status).toBe(200);
  expect(h.runner.getLiveRuns()).toHaveLength(0);
  const status = await h.runCrew(['status']);
  expect(status.stdout.includes('antigravity, pull')).toBe(true);
  expect(status.stdout.includes('connected')).toBe(true);
});

it('connect endpoint is human-only, cookie-CSRF protected, no-store and Pull-only', async () => {
  await setup();
  const before = h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!.tokenHash;
  for (const headers of [{}, { [AGENT_TOKEN_HEADER]: h.agentToken }, { [AGENT_TOKEN_HEADER]: h.agentToken, ...secret() }]) {
    const response = await fetch(url(), { method: 'POST', headers });
    expect([401, 403].includes(response.status)).toBe(true);
  }
  expect(h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!.tokenHash === before).toBe(true);
  const key = await fetch(h.server.url + '/api/session/key', { method: 'POST', headers: secret() }).then(r => r.json()) as { key: string };
  const session = await fetch(h.server.url + '/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(key) });
  const cookie = session.headers.get('set-cookie')!.split(';')[0];
  expect((await fetch(url(), { method: 'POST', headers: { Cookie: cookie } })).status).toBe(403);
  const response = await fetch(url(), { method: 'POST', headers: { Cookie: cookie, 'X-Crew-Board': '1' } });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  const token = extractToken((await response.json() as { prompt: string }).prompt);
  expect(token.length > 30).toBe(true);
  const spawnToken = h.addAgent('spawn');
  expect((await fetch(h.server.url + '/api/agents/spawn/connect', { method: 'POST', headers: secret() })).status).toBe(403);
  expect((await fetch(url(), { method: 'POST', headers: { [AGENT_TOKEN_HEADER]: spawnToken } })).status).toBe(403);
  const listed = await fetch(h.server.url + '/api/agents', { headers: secret() }).then(r => r.json()) as { agents: Record<string, unknown>[] };
  expect(listed.agents.every(a => !('tokenHash' in a))).toBe(true);
  expect(JSON.stringify(listed).includes(token)).toBe(false);
});

it('connect rejects ambiguous/unknown names and agent callers without minting a token', async () => {
  await setup(); const other = h.addAgent('duplicate');
  const name = h.db.db.select().from(schema.agents).where(eq(schema.agents.id, h.agentId)).get()!.name;
  h.db.db.update(schema.agents).set({ name }).where(eq(schema.agents.id, 'duplicate')).run();
  expect((await h.runCrew(['connect', name])).exitCode).toBe(1);
  expect((await h.runCrew(['connect', 'missing'])).exitCode).toBe(1);
  expect((await h.runCrew(['connect', h.agentId], { CREW_AGENT_TOKEN: other })).exitCode).toBe(1);
});
