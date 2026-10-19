import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export function getCrewHome(): string {
  if (process.env.CREW_HOME && process.env.CREW_HOME.trim() !== '') {
    return path.resolve(process.env.CREW_HOME.trim());
  }
  return path.join(os.homedir(), '.crew');
}

export function getCrewDbPath(): string {
  return path.join(getCrewHome(), 'crew.db');
}

export function getCrewLogsDir(): string {
  return path.join(getCrewHome(), 'logs');
}

export function getCrewWorktreesDir(): string {
  return path.join(getCrewHome(), 'worktrees');
}

export function ensureCrewHome(): void {
  const home = getCrewHome();
  const logs = getCrewLogsDir();
  const worktrees = getCrewWorktreesDir();

  for (const dir of [home, logs, worktrees]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
