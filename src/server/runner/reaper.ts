import fs from 'node:fs';
import { eq, isNull } from 'drizzle-orm';
import path from 'node:path';
import type { CrewDatabase } from '../db/index.js';
import { getCrewHome } from '../config.js';
import * as schema from '../db/schema.js';

/** True when the process is alive and its environment names this task (guards against a reused PID). */
function isAgentOfTask(pid: number, taskId: string): 'yes' | 'no' | 'unknown' {
  if (process.platform !== 'linux') return 'unknown';
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return 'no';
  }
  try {
    const environment = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
    return environment.includes(`CREW_TASK_ID=${taskId}`) ? 'yes' : 'no';
  } catch {
    return 'no';
  }
}

/**
 * D77. Runs left unfinished by a server that died abruptly (SIGKILL, power loss) belong to nobody:
 * when `crew start` runs this, no run of this server exists yet. Kill an agent that is verifiably
 * still running for the same task and end the run row, so the Dispatcher's existing orphan
 * re-dispatch starts exactly one replacement without charging a retry. Call it before the
 * Dispatcher and Workflow start.
 */
export function reapStaleRuns(db: CrewDatabase, warn: (message: string) => void = console.warn): { killed: number; ended: number } {
  let killed = 0;
  let ended = 0;
  for (const run of db.db.select().from(schema.runs).where(isNull(schema.runs.endedAt)).all()) {
    if (run.pid) {
      const owner = isAgentOfTask(run.pid, run.taskId);
      if (owner === 'unknown') {
        warn(`Run ${run.id} (pid ${run.pid}) was left by a previous server and this platform cannot verify it; check for a stray agent process.`);
        continue;
      }
      if (owner === 'yes') {
        try { process.kill(-run.pid, 'SIGKILL'); } catch { try { process.kill(run.pid, 'SIGKILL'); } catch { /* already gone */ } }
        killed++;
      }
    }
    db.db.update(schema.runs).set({ endedAt: new Date(), exitReason: 'stopped' }).where(eq(schema.runs.id, run.id)).run();
    ended++;
  }
  return { killed, ended };
}

/** True when server.json names a server process that is still alive: its runs are live, not stale. */
export function anotherServerIsRunning(): boolean {
  try {
    const info = JSON.parse(fs.readFileSync(path.join(getCrewHome(), 'server.json'), 'utf8')) as { pid?: number };
    if (!info.pid || info.pid === process.pid) return false;
    process.kill(info.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}
