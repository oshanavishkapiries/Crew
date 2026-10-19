export interface PermissionProfile {
  mode?: 'standard' | 'full' | 'read-only';
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
