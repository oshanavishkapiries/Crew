import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
import { killProcessGroup } from '../runner/index.js';

export interface VerifyCommand {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  paths?: string[];
}

/** Shared shell runner for user-authored verification and worktree setup commands. */
export class CommandRunner {
  private activeCommands = new Map<string, { pid?: number; abort: () => Promise<void> }>();

  async cancel(taskId: string): Promise<void> {
    await this.activeCommands.get(taskId)?.abort();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.activeCommands.keys()].map((id) => this.cancel(id)));
  }

  async execute(
    cmd: VerifyCommand,
    worktreePath: string,
    taskId?: string,
  ): Promise<{ name: string; passed: boolean; output: string }> {
    const commandCwd = cmd.cwd ? path.resolve(worktreePath, cmd.cwd) : worktreePath;
    if (!fs.existsSync(commandCwd)) {
      return {
        name: cmd.name,
        passed: false,
        output: `Working directory does not exist: ${cmd.cwd}`,
      };
    }

    const timeoutMs = cmd.timeoutMs ?? 10 * 60 * 1000; // 10 minutes default
    const env: Record<string, string> = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      CI: '1',
    };

    let timer: NodeJS.Timeout | undefined;

    try {
      const subprocess = execa(cmd.command, {
        shell: true,
        cwd: commandCwd,
        env,
        extendEnv: false,
        detached: true,
        reject: false,
      });

      if (taskId) {
        this.activeCommands.set(taskId, {
          pid: subprocess.pid,
          abort: async () => {
            if (subprocess.pid) {
              await killProcessGroup(subprocess.pid, 'SIGTERM', 1000);
            }
            await subprocess.catch(() => {});
          },
        });
      }

      const timeoutPromise = new Promise<{ timedOut: boolean }>((resolve) => {
        timer = setTimeout(async () => {
          if (subprocess.pid) {
            await killProcessGroup(subprocess.pid, 'SIGTERM', 1000);
          }
          resolve({ timedOut: true });
        }, timeoutMs);
      });

      const outcome = await Promise.race([
        subprocess.then((res) => ({ res, timedOut: false })),
        timeoutPromise,
      ]);

      if (timer) {
        clearTimeout(timer);
      }

      if (outcome.timedOut) {
        try {
          await subprocess;
        } catch {}
        return {
          name: cmd.name,
          passed: false,
          output: `Command '${cmd.name}' timed out after ${timeoutMs / 1000}s`,
        };
      }

      const res = (outcome as any).res;
      const stdout = (res?.stdout || '').trim();
      const stderr = (res?.stderr || '').trim();
      const fullOutput = [stdout, stderr].filter(Boolean).join('\n');
      const passed = res?.exitCode === 0;

      return {
        name: cmd.name,
        passed,
        output: fullOutput || (passed ? 'Command passed' : `Command failed with exit code ${res?.exitCode}`),
      };
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      return {
        name: cmd.name,
        passed: false,
        output: `Command execution error: ${err.message}`,
      };
    } finally {
      if (taskId) {
        this.activeCommands.delete(taskId);
      }
    }
  }

}
