import { AGENT_TOKEN_HEADER } from '../server/api/security.js';

function fail(message: string): never {
  console.error(message);
  process.exit(1);
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
