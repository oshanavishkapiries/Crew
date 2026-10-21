export interface PermissionProfile {
  /** Set by Runner only for a linked merge conflict sub-task. */
  conflictResolution?: boolean;
  /** Runner supplies this only for phase tasks in their own worktree. */
  phaseOutputPath?: string;
  mode?: 'standard' | 'full' | 'read-only' | 'orchestrator';
  allowCommands?: string[];
  denyCommands?: string[];
  allowBash?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
  allowNetwork?: boolean;
}

export interface AgentEvent {
  type: string;
  data: unknown;
  sessionId?: string;
  isError?: boolean;
  rateLimitResetTime?: string;
  timestamp: string;
}

export interface AgentAdapter {
  id: 'claude-code' | 'codex' | 'fake' | 'antigravity';
  detect(): Promise<{ installed: boolean; version?: string; headless: boolean }>;
  buildSpawn(opts: {
    prompt: string;
    workDir: string;
    permissions: PermissionProfile;
    taskId?: string;
    serverUrl?: string;
    agentToken?: string;
    settingsPath?: string;
    stopHook?: boolean;
  }): { command: string; args: string[]; env: Record<string, string> };
  /** Optional run-local parser for stateful JSONL adapters. */
  createOutputParser?(): (chunk: string) => AgentEvent[];
  parseOutput(chunk: string): AgentEvent[];
  isRateLimit(event: AgentEvent): boolean;
  buildResume?(opts: {
    sessionId: string;
    prompt: string;
    workDir: string;
    permissions: PermissionProfile;
    taskId?: string;
    serverUrl?: string;
    agentToken?: string;
    settingsPath?: string;
    stopHook?: boolean;
  }): { command: string; args: string[]; env: Record<string, string> };
  installExtras?(workDir: string): Promise<void>;
}
