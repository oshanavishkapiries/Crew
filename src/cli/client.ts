import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCrewHome } from '../server/config.js';
import { AGENT_TOKEN_HEADER, SECRET_HEADER } from '../server/api/security.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface ServerInfo {
  url: string;
  secret: string;
  pid?: number;
}

export function getServerInfo(): ServerInfo {
  if (process.env.CREW_SERVER_URL && process.env.CREW_SECRET) {
    return {
      url: process.env.CREW_SERVER_URL,
      secret: process.env.CREW_SECRET,
      pid: process.pid,
    };
  }
  const infoPath = path.join(getCrewHome(), 'server.json');
  if (!fs.existsSync(infoPath)) {
    fail(`No running Crew server found at ${infoPath}. Start one with 'crew start'.`);
  }
  try {
    return JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  } catch (err) {
    fail(`Failed to read ${infoPath}: ${(err as Error).message}`);
  }
}

/**
 * POST to one of the server's human endpoints, authenticated via X-Crew-Secret (D13, D25).
 */
export async function postHumanAction<T>(endpoint: string, body?: unknown): Promise<T> {
  const { url, secret } = getServerInfo();
  let res: Response;
  try {
    res = await fetch(`${url}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: secret,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    fail(`Failed to connect to Crew server at ${url}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    fail(`Request failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/**
 * POST to one of the current task's agent endpoints. Crew gives a spawned agent its
 * server URL, task and token through env vars, never in the prompt (D13).
 */
export async function postTaskAction<T>(command: string, action: string, body: unknown): Promise<T> {
  const serverUrl = process.env.CREW_SERVER_URL || 'http://127.0.0.1:4000';
  const taskId = process.env.CREW_TASK_ID;
  const token = process.env.CREW_AGENT_TOKEN;

  if (!taskId || !token) {
    fail(
      `Error: crew ${command} needs the CREW_TASK_ID and CREW_AGENT_TOKEN environment variables. Crew sets them when it spawns an agent.`,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/tasks/${encodeURIComponent(taskId)}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [AGENT_TOKEN_HEADER]: token,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Failed to connect to Crew server at ${serverUrl}: ${(err as Error).message}`);
  }

  if (!res.ok) {
    fail(`crew ${command} failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as T;
}
