/** GET /api/agents, /api/roles and /api/status; never include tokenHash. */
export interface CrewAgent {
  id: string;
  workspaceId: string;
  roleId: string;
  name: string;
  systemPrompt: string;
  personality: string;
  cliType: string;
  mode: string;
  status: string;
  lastHeartbeatAt: string | null;
}
export interface CrewRole {
  id: string;
  name: string;
  isBuiltin: boolean;
}
export interface TeamStatus {
  stopped: boolean;
  agents: { id: string; name: string; cliType: string; status: string }[];
  liveRuns: { id: string; taskId: string; agentId: string }[];
  rateLimits: { cliType: string; [key: string]: unknown }[];
}
