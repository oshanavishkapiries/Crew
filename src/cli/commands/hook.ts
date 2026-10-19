import * as fs from 'node:fs';
import * as path from 'node:path';
import { getCrewHome } from '../../server/config.js';

export async function handleHook(event: string): Promise<void> {
  if (event !== 'stop') {
    process.exit(0);
  }

  // Read stdin if available (Claude Code passes JSON to hooks)
  let stopHookActive = false;
  if (!process.stdin.isTTY) {
    try {
      const input = fs.readFileSync(0, 'utf8');
      if (input.trim()) {
        const parsed = JSON.parse(input);
        if (parsed.stop_hook_active === true) {
          stopHookActive = true;
        }
      }
    } catch {}
  }

  // If Claude Code indicates stop_hook_active is true, allow stopping immediately (D36)
  if (stopHookActive) {
    process.exit(0);
  }

  const serverUrl = process.env.CREW_SERVER_URL || 'http://127.0.0.1:4000';
  const agentToken = process.env.CREW_AGENT_TOKEN;
  const taskId = process.env.CREW_TASK_ID;
  const runId = process.env.CREW_RUN_ID || process.env.CREW_SESSION_ID || taskId;
  const crewHome = process.env.CREW_HOME || getCrewHome();

  if (!taskId || !agentToken) {
    process.exit(0);
  }

  // Check block count for this run (D36: blocks at most 2 times per run)
  const hookStopsDir = path.join(crewHome, 'hook-stops');
  const countFile = path.join(hookStopsDir, `${runId}.txt`);
  let count = 0;
  if (fs.existsSync(countFile)) {
    try {
      count = parseInt(fs.readFileSync(countFile, 'utf8').trim(), 10) || 0;
    } catch {}
  }

  if (count >= 2) {
    // Already blocked 2 times for this run, allow stopping
    process.exit(0);
  }

  // Ask server for task status
  try {
    const res = await fetch(`${serverUrl}/api/tasks/${taskId}`, {
      headers: {
        'X-Crew-Agent-Token': agentToken,
      },
    });

    if (!res.ok) {
      // Safe fallback if server cannot be reached
      process.exit(0);
    }

    const data = (await res.json()) as any;
    const status = data?.task?.status;

    // Allows stopping when status is anything but doing (e.g. verifying, blocked, etc.)
    if (status !== 'doing') {
      process.exit(0);
    }

    // Block while status is doing
    if (!fs.existsSync(hookStopsDir)) {
      fs.mkdirSync(hookStopsDir, { recursive: true });
    }
    fs.writeFileSync(countFile, String(count + 1), 'utf8');

    console.error("Call `crew done` when the work is finished, or `crew ask` if you're blocked.");
    process.exit(2);
  } catch {
    // Fail-safe: allow on error
    process.exit(0);
  }
}
