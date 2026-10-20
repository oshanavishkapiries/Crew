import type { AgentAdapter, AgentEvent, PermissionProfile } from './types.js';

export interface FakeScriptStep {
  type:
    | 'update'
    | 'done'
    | 'ask'
    | 'review'
    | 'edit_file'
    | 'symlink'
    | 'git'
    | 'custom_command'
    | 'rate_limit'
    | 'hang'
    | 'sleep'
    | 'exit';
  message?: string;
  result?: string;
  action?: 'approve' | 'changes';
  feedback?: string;
  filePath?: string;
  targetPath?: string;
  content?: string;
  command?: string;
  args?: string[];
  durationMs?: number;
  exitCode?: number;
  rateLimitResetTime?: string;
}

export class FakeAdapter implements AgentAdapter {
  id: 'fake' = 'fake';
  public refuseResume = false;
  private scriptedSteps: FakeScriptStep[] = [];
  private runScripts: FakeScriptStep[][] = [];
  private resumeSteps?: FakeScriptStep[];

  constructor(scriptedSteps: FakeScriptStep[] = []) {
    this.scriptedSteps = scriptedSteps;
  }

  setScript(steps: FakeScriptStep[]): void {
    this.scriptedSteps = steps;
  }

  setRunScripts(scripts: FakeScriptStep[][]): void {
    this.runScripts = scripts.map((s) => [...s]);
  }

  setResumeScript(steps: FakeScriptStep[]): void {
    this.resumeSteps = steps;
  }

  async detect(): Promise<{ installed: boolean; version?: string; headless: boolean }> {
    return { installed: true, version: '1.0.0-fake', headless: true };
  }

  buildSpawn(opts: {
    prompt: string;
    workDir: string;
    permissions: PermissionProfile;
    taskId?: string;
    serverUrl?: string;
    agentToken?: string;
  }): { command: string; args: string[]; env: Record<string, string> } {
    const steps = this.runScripts.length > 0 ? this.runScripts.shift()! : this.scriptedSteps;
    const stepsJson = JSON.stringify(steps);
    // Node script that executes the script steps and emits structured JSON lines to stdout
    const script = `
      import { execFileSync } from 'node:child_process';
      import * as fs from 'node:fs';
      import * as path from 'node:path';

      const steps = ${stepsJson};
      const taskId = process.env.CREW_TASK_ID || '';
      const serverUrl = process.env.CREW_SERVER_URL || '';
      const token = process.env.CREW_AGENT_TOKEN || '';
      const cliPath = process.env.CREW_CLI_PATH || 'dist/cli.js';
      const sessionId = process.env.CREW_SESSION_ID || '';
      // No shell: messages reach crew exactly as written, quotes and $() included
      const crew = (...args) => execFileSync(process.execPath, [cliPath, ...args], { stdio: 'inherit', env: process.env });

      console.log(JSON.stringify({ type: 'start', data: { prompt: ${JSON.stringify(opts.prompt)} }, sessionId, timestamp: new Date().toISOString() }));

      for (const step of steps) {
        if (step.type === 'update') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'update', message: step.message }, timestamp: new Date().toISOString() }));
          crew('update', '--', step.message || 'update');
        } else if (step.type === 'edit_file' && step.filePath) {
          const resolvedPath = path.isAbsolute(step.filePath) ? step.filePath : path.resolve(step.filePath);
          const parentDir = path.dirname(resolvedPath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }
          fs.writeFileSync(resolvedPath, step.content || '', 'utf-8');
          console.log(JSON.stringify({ type: 'file_edit', data: { file: resolvedPath }, timestamp: new Date().toISOString() }));
        } else if (step.type === 'symlink' && step.filePath && step.targetPath) {
          const resolvedPath = path.isAbsolute(step.filePath) ? step.filePath : path.resolve(step.filePath);
          fs.symlinkSync(step.targetPath, resolvedPath);
          console.log(JSON.stringify({ type: 'symlink', data: { file: resolvedPath, target: step.targetPath }, timestamp: new Date().toISOString() }));
        } else if (step.type === 'git' && step.args) {
          execFileSync('git', step.args, { stdio: 'inherit', env: process.env });
        } else if (step.type === 'custom_command' && step.command) {
          execFileSync('sh', ['-c', step.command], { stdio: 'inherit' });
          console.log(JSON.stringify({ type: 'custom_command', data: { command: step.command }, timestamp: new Date().toISOString() }));
        } else if (step.type === 'rate_limit') {
          const payload = {
            type: 'rate_limit',
            isError: true,
            sessionId,
            rateLimitResetTime: step.rateLimitResetTime,
            timestamp: new Date().toISOString(),
          };
          console.log(JSON.stringify(payload));
          await new Promise((r) => setTimeout(r, 10000));
        } else if (step.type === 'done') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'done', result: step.result }, timestamp: new Date().toISOString() }));
          crew('done', '--result', step.result || 'done');
        } else if (step.type === 'review') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'review', action: step.action, feedback: step.feedback }, timestamp: new Date().toISOString() }));
          if (step.action === 'approve') {
            crew('review', 'approve');
          } else if (step.action === 'changes') {
            crew('review', 'changes', '--feedback', step.feedback || 'Changes requested');
          }
        } else if (step.type === 'ask') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'ask', question: step.message }, timestamp: new Date().toISOString() }));
          crew('ask', '--', step.message || 'need input');
        } else if (step.type === 'sleep') {
          const ms = step.durationMs || 1000;
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'sleep', durationMs: ms }, timestamp: new Date().toISOString() }));
          await new Promise(r => setTimeout(r, ms));
        } else if (step.type === 'exit') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'exit', exitCode: step.exitCode ?? 1 }, timestamp: new Date().toISOString() }));
          process.exit(step.exitCode ?? 1);
        } else if (step.type === 'hang') {
          const grandchild = execFileSync('sh', ['-c', 'sleep 3600 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf-8' }).trim();
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'hang', grandchildPid: grandchild }, timestamp: new Date().toISOString() }));
          setInterval(() => {}, 60000);
          await new Promise(() => {});
        }
      }

      console.log(JSON.stringify({ type: 'completion', data: { status: 'success' }, timestamp: new Date().toISOString() }));
    `;

    return {
      command: 'node',
      args: ['--input-type=module', '-e', script],
      env: {
        CREW_TASK_ID: opts.taskId || '',
        CREW_SERVER_URL: opts.serverUrl || '',
        CREW_AGENT_TOKEN: opts.agentToken || '',
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
        const parsed = JSON.parse(trimmed);
        if (parsed.type) {
          events.push({
            type: parsed.type,
            data: parsed.data ?? null,
            sessionId: parsed.sessionId,
            isError: Boolean(parsed.isError),
            rateLimitResetTime: parsed.rateLimitResetTime,
            timestamp: parsed.timestamp || new Date().toISOString(),
          });
        }
      } catch {
        // Not a JSON event line
      }
    }

    return events;
  }

  isRateLimit(event: AgentEvent): boolean {
    return event.type === 'rate_limit';
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
    if (this.refuseResume) {
      throw new Error('FakeAdapter: refused to resume session');
    }
    const previousSteps = this.scriptedSteps;
    if (this.resumeSteps) {
      this.scriptedSteps = this.resumeSteps;
    }
    try {
      return this.buildSpawn({
        prompt: opts.prompt,
        workDir: opts.workDir,
        permissions: opts.permissions,
        taskId: opts.taskId,
        serverUrl: opts.serverUrl,
        agentToken: opts.agentToken,
      });
    } finally {
      this.scriptedSteps = previousSteps;
    }
  }
}
