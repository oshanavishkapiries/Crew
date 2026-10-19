import * as crypto from 'node:crypto';
import { execa } from 'execa';
import type { AgentAdapter, AgentEvent, PermissionProfile } from './types.js';

export const BASE_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(crew *)',
];

export const FIXED_DENIED_TOOLS = [
  'Bash(git push *)',
  'Bash(git push)',
  'Bash(git remote *)',
  'Bash(git remote)',
  'Bash(sudo *)',
  'Bash(sudo)',
  'Bash(rm -rf / *)',
  'Bash(rm -rf /*)',
  'Bash(rm -rf ~ *)',
  'Bash(rm -rf ~)',
];

export const MINIMUM_CLAUDE_CODE_VERSION = '2.1.0';

export class ClaudeCodeAdapter implements AgentAdapter {
  id: 'claude-code' = 'claude-code';

  constructor(private options: { maxBudgetUsd?: number } = {}) {}

  async detect(): Promise<{ installed: boolean; version?: string; headless: boolean }> {
    try {
      const result = await execa('claude', ['--version'], { reject: false });
      if (result.exitCode !== 0) {
        return { installed: false, headless: false };
      }
      const stdout = result.stdout.trim();
      const match = stdout.match(/(\d+\.\d+\.\d+)/);
      const version = match ? match[1] : stdout;
      return {
        installed: true,
        version,
        headless: true,
      };
    } catch {
      return { installed: false, headless: false };
    }
  }

  private resolveTools(permissions: PermissionProfile): {
    allowedTools: string[];
    disallowedTools: string[];
    permissionMode: string;
  } {
    const isFull = permissions.mode === 'full';
    const permissionMode = isFull ? 'acceptEdits' : 'dontAsk';

    const allowed = [...BASE_ALLOWED_TOOLS];
    if (isFull) {
      allowed.push('Bash(*)');
    }

    if (permissions.allowCommands) {
      for (const cmd of permissions.allowCommands) {
        const pattern = cmd.includes(' ') || cmd.includes('*') ? `Bash(${cmd})` : `Bash(${cmd} *)`;
        allowed.push(pattern);
        if (!cmd.includes('*')) {
          allowed.push(`Bash(${cmd})`);
        }
      }
    }

    if (permissions.allowedTools) {
      allowed.push(...permissions.allowedTools);
    }

    const disallowed = [...FIXED_DENIED_TOOLS];
    if (permissions.denyCommands) {
      for (const cmd of permissions.denyCommands) {
        const pattern = cmd.includes(' ') || cmd.includes('*') ? `Bash(${cmd})` : `Bash(${cmd} *)`;
        disallowed.push(pattern);
        if (!cmd.includes('*')) {
          disallowed.push(`Bash(${cmd})`);
        }
      }
    }

    if (permissions.deniedTools) {
      disallowed.push(...permissions.deniedTools);
    }

    return {
      allowedTools: Array.from(new Set(allowed)),
      disallowedTools: Array.from(new Set(disallowed)),
      permissionMode,
    };
  }

  buildSpawn(opts: {
    prompt: string;
    workDir: string;
    permissions: PermissionProfile;
    taskId?: string;
    serverUrl?: string;
    agentToken?: string;
    sessionId?: string;
  }): { command: string; args: string[]; env: Record<string, string> } {
    const sessionId = opts.sessionId || crypto.randomUUID();
    const { allowedTools, disallowedTools, permissionMode } = this.resolveTools(opts.permissions);

    const args: string[] = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--session-id',
      sessionId,
      '--permission-mode',
      permissionMode,
      '--permission-prompts',
      'none',
      '--allowedTools',
      allowedTools.join(' '),
      '--disallowedTools',
      disallowedTools.join(' '),
    ];

    if (this.options.maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', String(this.options.maxBudgetUsd));
    }

    return {
      command: 'claude',
      args,
      env: {
        CREW_TASK_ID: opts.taskId || '',
        CREW_SERVER_URL: opts.serverUrl || '',
        CREW_AGENT_TOKEN: opts.agentToken || '',
        CREW_SESSION_ID: sessionId,
      },
    };
  }

  buildResume(opts: {
    sessionId: string;
    prompt: string;
    workDir: string;
    permissions: PermissionProfile;
    taskId?: string;
    serverUrl?: string;
    agentToken?: string;
  }): { command: string; args: string[]; env: Record<string, string> } {
    const { allowedTools, disallowedTools, permissionMode } = this.resolveTools(opts.permissions);

    const args: string[] = [
      '-p',
      '--resume',
      opts.sessionId,
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      permissionMode,
      '--permission-prompts',
      'none',
      '--allowedTools',
      allowedTools.join(' '),
      '--disallowedTools',
      disallowedTools.join(' '),
    ];

    if (this.options.maxBudgetUsd !== undefined) {
      args.push('--max-budget-usd', String(this.options.maxBudgetUsd));
    }

    return {
      command: 'claude',
      args,
      env: {
        CREW_TASK_ID: opts.taskId || '',
        CREW_SERVER_URL: opts.serverUrl || '',
        CREW_AGENT_TOKEN: opts.agentToken || '',
        CREW_SESSION_ID: opts.sessionId,
      },
    };
  }

  parseOutput(chunk: string): AgentEvent[] {
    const lines = chunk.split('\n');
    const events: AgentEvent[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) continue;

      try {
        const obj = JSON.parse(trimmed);
        if (!obj.type) continue;

        let rateLimitResetTime: string | undefined;
        if (obj.rate_limit_info?.resetsAt) {
          rateLimitResetTime = new Date(obj.rate_limit_info.resetsAt * 1000).toISOString();
        } else if (obj.resetsAt) {
          rateLimitResetTime =
            typeof obj.resetsAt === 'number'
              ? new Date(obj.resetsAt * 1000).toISOString()
              : new Date(obj.resetsAt).toISOString();
        }

        const isError = Boolean(
          obj.is_error ||
            obj.type === 'error' ||
            obj.subtype === 'permission_denied' ||
            (obj.type === 'result' && obj.is_error),
        );

        events.push({
          type: obj.type,
          data: obj,
          sessionId: obj.session_id,
          isError,
          rateLimitResetTime,
          timestamp: obj.timestamp || new Date().toISOString(),
        });
      } catch {
        // Not a JSON line
      }
    }

    return events;
  }

  isRateLimit(event: AgentEvent): boolean {
    const data = event.data as any;
    if (!data) return false;

    // 1. rate_limit_event with non-allowed status
    if (event.type === 'rate_limit_event') {
      const info = data.rate_limit_info;
      if (info && info.status !== 'allowed') {
        return true;
      }
      if (info && info.overageStatus === 'rejected' && (info.utilization ?? 0) >= 1) {
        return true;
      }
    }

    // 2. error event with rate_limit_error or code 429
    if (event.type === 'error') {
      const err = data.error;
      if (err?.type === 'rate_limit_error' || err?.code === 429) {
        return true;
      }
      if (typeof err?.message === 'string' && /rate[-_ ]?limit/i.test(err.message)) {
        return true;
      }
    }

    // 3. result event with rate_limit terminal reason or subtype
    if (event.type === 'result') {
      if (data.terminal_reason === 'rate_limit' || data.subtype === 'rate_limit') {
        return true;
      }
    }

    // 4. API error status 429
    if (data.api_error_status === 429) {
      return true;
    }

    return false;
  }
}
