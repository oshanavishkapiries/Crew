import type { BoardSummary, PhaseStatus } from './types';
// Exact scheduler names; queued belongs to merge items, not tasks.
export const taskStatuses = ['todo', 'ready', 'doing', 'verifying', 'review', 'merge-queue', 'merged', 'blocked', 'escalated', 'cancelled'] as const;
export type TaskStatus = typeof taskStatuses[number];
export interface BoardTask {
  id: string; boardId: string; title: string; description: string; acceptanceCriteria: string;
  status: TaskStatus; kind: 'work' | 'phase'; retries: number;
  staleAgentId?: string; assigneeAgentId: string | null; assigneeAgentName?: string; reviewerAgentId: string | null;
  branch: string | null; updatedAt: string; createdAt: string;
}
export interface Dependency { taskId: string; blockedByTaskId: string }
export interface StatusResponse {
  stopped: boolean; phases: PhaseStatus[];
  agents: { id: string; name: string; cliType: string; status: string; mode: "spawn" | "pull"; lastHeartbeatAt: string | null }[];
  liveRuns: { id: string; taskId: string; agentId: string; sessionId?: string; pid?: number }[];
  rateLimits: { cliType: string; isPaused: boolean; resetTime?: number; backoffStep: number }[];
}
export interface QueueResponse {
  items: { id: string; taskId: string; status: string; position: number; taskStatus: string; title: string }[];
  warnings: { workspaceId: string; message: string }[]; stopped: boolean;
}
export interface BoardData {
  tasks?: BoardTask[]; status?: StatusResponse; queue?: QueueResponse; board?: BoardSummary;
  dependencies: Dependency[]; runStarts: Record<string, string>; errors: Record<string, string>; revision: number;
}
