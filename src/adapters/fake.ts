import type { AgentAdapter, AgentEvent, PermissionProfile } from './types.js';

export interface FakeScriptStep {
  type: 'update' | 'done' | 'ask' | 'edit_file' | 'custom_command' | 'rate_limit';
  message?: string;
  result?: string;
  filePath?: string;
  content?: string;
  command?: string;
}

export class FakeAdapter implements AgentAdapter {
  id: 'fake' = 'fake';
  private scriptedSteps: FakeScriptStep[] = [];

  constructor(scriptedSteps: FakeScriptStep[] = []) {
    this.scriptedSteps = scriptedSteps;
  }

  setScript(steps: FakeScriptStep[]): void {
    this.scriptedSteps = steps;
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
    const stepsJson = JSON.stringify(this.scriptedSteps);
    // Node one-liner that executes the script steps and emits structured JSON lines to stdout
    const script = `
      import { execSync } from 'node:child_process';
      import * as fs from 'node:fs';
      import * as path from 'node:path';

      const steps = ${stepsJson};
      const taskId = process.env.CREW_TASK_ID || '';
      const serverUrl = process.env.CREW_SERVER_URL || '';
      const token = process.env.CREW_AGENT_TOKEN || '';

      console.log(JSON.stringify({ type: 'start', data: { prompt: ${JSON.stringify(opts.prompt)} }, timestamp: new Date().toISOString() }));

      for (const step of steps) {
        if (step.type === 'update') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'update', message: step.message }, timestamp: new Date().toISOString() }));
          execSync(\`node \${process.env.CREW_CLI_PATH || 'dist/cli.js'} update "\${step.message || 'update'}"\`, { stdio: 'inherit', env: process.env });
        } else if (step.type === 'edit_file' && step.filePath) {
          fs.writeFileSync(step.filePath, step.content || '', 'utf-8');
          console.log(JSON.stringify({ type: 'file_edit', data: { file: step.filePath }, timestamp: new Date().toISOString() }));
        } else if (step.type === 'rate_limit') {
          console.log(JSON.stringify({ type: 'rate_limit', isError: true, rateLimitResetTime: new Date(Date.now() + 60000).toISOString(), timestamp: new Date().toISOString() }));
        } else if (step.type === 'done') {
          console.log(JSON.stringify({ type: 'tool_call', data: { tool: 'done', result: step.result }, timestamp: new Date().toISOString() }));
          execSync(\`node \${process.env.CREW_CLI_PATH || 'dist/cli.js'} done --result "\${step.result || 'done'}"\`, { stdio: 'inherit', env: process.env });
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
    return this.buildSpawn({
      prompt: opts.prompt,
      workDir: opts.workDir,
      permissions: opts.permissions,
      taskId: opts.taskId,
      serverUrl: opts.serverUrl,
      agentToken: opts.agentToken,
    });
  }
}
