/** Subset of wire fields read from src/server/api/app.ts and db/schema.ts. */
export interface CrewTask {
  id: string;
  boardId: string;
  kind: "phase" | "work";
  creationPhase: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string;
  status: string;
  assigneeAgentId: string | null;
  assigneeAgentName?: string;
  roleId: string | null;
  parentTaskId: string | null;
  createdAt: string;
}
export interface CrewMessage {
  id: string;
  taskId: string;
  fromAgentId: string | null;
  type: string;
  body: string;
  createdAt: string;
}
export interface TaskDetail {
  task: CrewTask;
  messages: CrewMessage[];
  dependencies: { taskId: string; blockedByTaskId: string }[];
}
export interface PhaseSnapshot {
  board: { id: string; workspaceId: string; currentPhase: string };
  workspace: {
    id: string;
    name: string;
    config?: { maxTicketsPerPhase?: number } | null;
  };
  task?: CrewTask;
  draft?: { id: string; body: string; phase: string; status: string };
  problem?: string;
  instructions: string;
}
