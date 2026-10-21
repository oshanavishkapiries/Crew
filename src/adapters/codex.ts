import { execa } from 'execa';
import type { AgentAdapter, AgentEvent, PermissionProfile } from './types.js';

export const MINIMUM_CODEX_VERSION = '0.163.0';
type SpawnOptions = Parameters<AgentAdapter['buildSpawn']>[0];

/** D88: command allow/deny lists are prompt rules, not per-command Codex enforcement. */
export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex' as const;
  private parse = this.createOutputParser();

  async detect() {
    try {
      const result = await execa('codex', ['--version'], { reject: false });
      const version = result.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];
      const [major, minor] = (version || '0.0.0').split('.').map(Number);
      return { installed: result.exitCode === 0, version, headless: result.exitCode === 0 && (major > 0 || minor >= 163) };
    } catch {
      return { installed: false, headless: false };
    }
  }

  private options(permissions: PermissionProfile, workDir: string): string[] {
    const sandbox = permissions.mode === 'full' ? 'danger-full-access' : permissions.mode === 'read-only' && permissions.allowNetwork === false ? 'read-only' : 'workspace-write';
    return ['--ignore-user-config', '--ignore-rules', '-s', sandbox, '-C', workDir,
      '-c', 'approval_policy="never"',
      '-c', `sandbox_workspace_write.network_access=${permissions.allowNetwork !== false}`,
      // Keep Crew's environment available to shell commands, including the task token.
      '-c', 'shell_environment_policy.inherit="all"'];
  }

  private env(opts: SpawnOptions): Record<string, string> {
    return { CREW_TASK_ID: opts.taskId || '', CREW_SERVER_URL: opts.serverUrl || '', CREW_AGENT_TOKEN: opts.agentToken || '' };
  }

  buildSpawn(opts: SpawnOptions) {
    return { command: 'codex', args: ['exec', ...this.options(opts.permissions, opts.workDir), '--json', '-'], env: this.env(opts) };
  }

  buildResume(opts: SpawnOptions & { sessionId: string }) {
    // -s and -C belong to exec, not its resume subcommand (verified on 0.163.0).
    return { command: 'codex', args: ['exec', ...this.options(opts.permissions, opts.workDir), 'resume', '--json', opts.sessionId, '-'], env: { ...this.env(opts), CREW_SESSION_ID: opts.sessionId } };
  }

  /** One parser per run: a shared adapter can serve concurrent sessions safely. */
  createOutputParser(): (chunk: string) => AgentEvent[] {
    let pending = '';
    let sessionId: string | undefined;
    return (chunk: string) => {
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      // Runner also hands adapters complete JSON objects without a trailing newline.
      try { JSON.parse(pending); lines.push(pending); pending = ''; } catch { /* partial line */ }
      const events: AgentEvent[] = [];
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          if (!data || typeof data.type !== 'string') continue;
          if (data.type === 'thread.started' && typeof data.thread_id === 'string') sessionId = data.thread_id;
          const reset = data.error?.resets_at ?? data.resets_at;
          const resetDate = reset === undefined ? undefined : new Date(typeof reset === 'number' ? reset * 1000 : reset);
          events.push({ type: data.type, data, sessionId,
            isError: data.type === 'error' || data.type === 'turn.failed' || data.item?.type === 'error',
            rateLimitResetTime: resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.toISOString() : undefined,
            timestamp: new Date().toISOString() });
        } catch { /* ignore diagnostics and malformed JSONL */ }
      }
      return events;
    };
  }

  parseOutput(chunk: string): AgentEvent[] { return this.parse(chunk); }

  isRateLimit(event: AgentEvent): boolean {
    const data = event.data as any;
    if (!data || !['error', 'turn.failed', 'item.completed'].includes(event.type)) return false;
    const error = data.error || (data.item?.type === 'error' ? data.item : data);
    return error.code === 429 || error.status === 429 || ['rate_limit_exceeded', 'rate_limit_error', 'usage_limit_reached'].includes(error.code) ||
      (typeof error.message === 'string' && /rate[-_ ]?limit|usage limit|too many requests|\b429\b/i.test(error.message));
  }
}

/** These restrictions are advisory; Codex has no per-command tool allow/deny list. */
export function codexPermissionInstructions(profile: PermissionProfile): string {
  return [
    'Crew permission rules: never git push, change remotes, use sudo, run destructive commands, write outside this worktree, or read Crew server.json, crew.db, logs or credentials.',
    'Call crew done (or crew ask / crew review / crew phase done as appropriate) before ending. Codex turn completion alone does not complete the Crew task.',
    profile.mode === 'read-only' ? 'Review only: do NOT create, edit, delete or move any file. Use read/search, git diff/log/show and crew review commands only. (The sandbox allows writes so crew can reach the local API; this rule is your restriction.)' : '',
    profile.mode === 'orchestrator' ? `Plan only: use read/search, git diff/log/show/status and crew commands. Write only ${profile.phaseOutputPath || 'the designated phase output file'}.` : '',
    profile.allowCommands?.length ? `Additional permitted command prefixes: ${profile.allowCommands.join(', ')}.` : '',
    profile.denyCommands?.length ? `Forbidden command prefixes: ${profile.denyCommands.join(', ')}.` : '',
    profile.allowNetwork === false ? 'Do not access the network except the local Crew API needed for crew commands.' : 'Network access is enabled so crew commands can reach the local Crew API. Use it for nothing else unless the task requires it.',
  ].filter(Boolean).join('\n');
}
