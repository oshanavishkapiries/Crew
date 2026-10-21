import { AGENT_TOKEN_HEADER } from '../../server/api/security.js';
import { printAgentInstruction } from '../client.js';

async function request<T = unknown>(endpoint: string, token: string, method = 'GET') {
  const url = process.env.CREW_SERVER_URL || 'http://127.0.0.1:4000';
  const response = await fetch(`${url}${endpoint}`, { method, headers: { [AGENT_TOKEN_HEADER]: token } });
  printAgentInstruction(response);
  if (!response.ok) throw new Error(`crew Pull request failed: ${response.status} ${await response.text()}`);
  return await response.json() as T;
}

function agentToken(token = process.env.CREW_AGENT_TOKEN): string {
  if (!token) throw new Error('Set CREW_AGENT_TOKEN in this terminal; crew join also accepts --token. Tokens are never saved by Crew CLI.');
  return token;
}

export async function handleJoin(options: { token?: string }) {
  console.log(JSON.stringify(await request('/api/agents/join', agentToken(options.token), 'POST'), null, 2));
}

export async function handleNext(options: { wait?: string | number }) {
  const wait = Number(options.wait ?? 90);
  if (!Number.isFinite(wait) || wait < 0) throw new Error('--wait must be a nonnegative number of seconds; capped at 85.');
  const token = agentToken();
  // Resolve identity from the authenticated token, never from locally stored credentials.
  const identity = await request<{ agentId: string }>('/api/agents/join', token, 'POST');
  const data = await request<{ runId?: string; task: { id: string }; workDir: string }>(`/api/agents/${encodeURIComponent(identity.agentId)}/next-task?wait=${Math.min(wait, 85)}`, token);
  console.log(JSON.stringify(data, null, 2));
  if (data.runId) console.log(`Set CREW_TASK_ID=${data.task.id} and CREW_RUN_ID=${data.runId}. Change directory to ${JSON.stringify(data.workDir)}. Follow the prompt and its completion command (crew done for work, crew review for review, crew phase done for a phase). After done clear context and run crew join again.`);
}
