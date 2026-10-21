import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCrewHome } from '../server/config.js';
import { AGENT_TOKEN_HEADER, SECRET_HEADER } from '../server/api/security.js';

export function printAgentInstruction(response: Response) {
  const instruction = response.headers.get('X-Crew-Instruction');
  if (instruction) console.log(decodeURIComponent(instruction));
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

export interface ServerInfo {
  url: string;
  secret: string;
  pid?: number;
}

export function getServerInfo(fromFile = false): ServerInfo {
  if (process.env.CREW_AGENT_TOKEN) fail('This is a human command; agents cannot use human authentication.');
  if (!fromFile && process.env.CREW_SERVER_URL && process.env.CREW_SECRET) {
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
  let info: ServerInfo;
  try {
    info = JSON.parse(fs.readFileSync(infoPath, 'utf-8')) as ServerInfo;
  } catch (err) {
    fail(`Failed to read ${infoPath}: ${(err as Error).message}`);
  }
  // A crashed server (SIGKILL, power loss) can't delete its server.json: don't trust a dead pid
  if (info.pid !== undefined && !isProcessAlive(info.pid)) {
    fail(`${infoPath} is stale: the Crew server (pid ${info.pid}) is no longer running. Start one with 'crew start'.`);
  }
  return info;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * POST to one of the server's human endpoints, authenticated via X-Crew-Secret (D13, D25).
 */
export async function postHumanAction<T>(endpoint: string, body?: unknown, method: 'POST' | 'PATCH' = 'POST'): Promise<T> {
  const { url, secret } = getServerInfo();
  let res: Response;
  try {
    res = await fetch(`${url}${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        [SECRET_HEADER]: secret,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    fail(`Failed to connect to Crew server at ${url}: ${(err as Error).message}`);
  }

  printAgentInstruction(res);
  if (!res.ok) {
    fail(`Request failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/**
 * GET from one of the server's human endpoints, authenticated via X-Crew-Secret (D13, D25).
 */
export async function getHumanAction<T>(endpoint: string): Promise<T> {
  const { url, secret } = getServerInfo();
  let res: Response;
  try {
    res = await fetch(`${url}${endpoint}`, {
      method: 'GET',
      headers: {
        [SECRET_HEADER]: secret,
      },
    });
  } catch (err) {
    fail(`Failed to connect to Crew server at ${url}: ${(err as Error).message}`);
  }

  printAgentInstruction(res);
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
      `Error: crew ${command} needs the CREW_TASK_ID and CREW_AGENT_TOKEN environment variables. Crew sets them for spawn agents; Pull agents set them from crew next.`,
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

  printAgentInstruction(res);
  if (!res.ok) {
    fail(`crew ${command} failed: ${res.status} ${await res.text()}`);
  }

  return (await res.json()) as T;
}

/** Shared Orchestrator/human actions prefer the agent token in spawned processes. */
export async function postWorkflowAction<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.CREW_AGENT_TOKEN;
  if (!token) return postHumanAction<T>(endpoint, body);
  const url = process.env.CREW_SERVER_URL;
  if (!url || !process.env.CREW_TASK_ID) fail('This agent command needs CREW_SERVER_URL and CREW_TASK_ID.');
  let res: Response;
  try {
    res = await fetch(`${url}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', [AGENT_TOKEN_HEADER]: token },
      body: JSON.stringify({ ...body, taskId: process.env.CREW_TASK_ID }),
    });
  } catch (error) { fail(`Failed to connect to Crew server at ${url}: ${(error as Error).message}`); }
  if (!res.ok) fail(`Request failed: ${res.status} ${await res.text()}`);
  return await res.json() as T;
}
