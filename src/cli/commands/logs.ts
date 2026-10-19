import { getHumanAction, getServerInfo } from '../client.js';
import { SECRET_HEADER } from '../../server/api/security.js';

interface LogsResponse {
  content: string;
  logPath: string | null;
  runId: string | null;
  exitReason?: string;
  exitCode?: number;
}

export async function handleLogs(taskId: string, options: { follow?: boolean } = {}): Promise<void> {
  const data = await getHumanAction<LogsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/logs`);

  if (data.content) {
    process.stdout.write(data.content);
    if (!data.content.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }

  if (!options.follow) {
    if (!data.content) {
      console.log(`No logs found for task ${taskId}.`);
    }
    return;
  }

  if (!data.runId) {
    console.log(`No active or recorded run found for task ${taskId}.`);
    return;
  }

  // If the run has already ended with an exitReason, no need to stream
  if (data.exitReason) {
    return;
  }

  // Follow live SSE stream
  const { url, secret } = getServerInfo();
  try {
    const res = await fetch(`${url}/api/runs/${encodeURIComponent(data.runId)}/stream`, {
      headers: {
        [SECRET_HEADER]: secret,
      },
    });

    if (!res.ok || !res.body) {
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const payload = line.slice(6);
          try {
            const event = JSON.parse(payload);
            if (event.type === 'run_ended') {
              return;
            }
          } catch {
            // plain text
          }
        }
      }
    }
  } catch {
    // Stream closed
  }
}
