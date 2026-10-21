import { getHumanAction, getServerInfo } from '../client.js';
import { SECRET_HEADER } from '../../server/api/security.js';

interface LogsResponse {
  content: string;
  missing?: boolean;
  truncated?: boolean;
  offset?: number;
  logPath: string | null;
  runId: string | null;
  exitReason?: string;
  exitCode?: number;
}

export async function handleLogs(taskId: string, options: { follow?: boolean; run?: string; tail?: string; list?: boolean } = {}): Promise<void> {
  if (options.list) {
    if (options.run !== undefined || options.tail !== undefined || options.follow) throw new Error('Use --list alone, then crew logs <task> --run <id> to read a run.');
    const data = await getHumanAction<{ runs: Array<{ id: string; adapter: string; agentId: string; startedAt: string; endedAt: string | null; exitReason: string | null; exitCode: number | null }> }>(`/api/tasks/${encodeURIComponent(taskId)}`);
    if (!data.runs.length) console.log(`No runs found for task ${taskId}.`);
    for (const run of data.runs) console.log(`${run.id} · ${run.adapter} · ${run.agentId} · ${run.startedAt} — ${run.endedAt ?? 'running'} · ${run.exitReason ?? 'in progress'}${run.exitCode !== null ? ` (code ${run.exitCode})` : ''}`);
    return;
  }
  const query = new URLSearchParams();
  if (options.run !== undefined) query.set('run', options.run);
  if (options.tail !== undefined) {
    if (!/^\d+$/.test(options.tail) || !Number.isSafeInteger(Number(options.tail)) || Number(options.tail) < 1 || Number(options.tail) > 2048)
      throw new Error('--tail must be an integer from 1 to 2048 KiB. Correct --tail and retry crew logs.');
    query.set('tail', String(Number(options.tail) * 1024));
  }
  const data = await getHumanAction<LogsResponse>(`/api/tasks/${encodeURIComponent(taskId)}/logs${query.size ? `?${query}` : ''}`);
  if (data.truncated) console.error(`Log truncated: showing the tail from byte ${data.offset}. Use --tail 2048 for a larger tail; the complete file is under <crewHome>/logs.`);
  if (data.missing) console.log(`Log file missing for run ${data.runId}. Restore its file under <crewHome>/logs, then retry crew logs.`);

  if (data.content) {
    process.stdout.write(data.content);
    if (!data.content.endsWith('\n')) {
      process.stdout.write('\n');
    }
  }

  if (!options.follow) {
    if (!data.content && !data.missing) {
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
