/** Wire shapes copied from src/server/api/app.ts (GET /api/status and board SSE). */
export interface PhaseStatus {
  boardId: string;
  phase: string;
  draftId?: string;
  taskId?: string;
  status?: string;
  problem?: string;
  ticketCounts: Record<string, number>;
  limits?: { maxParallelAgents: number; maxRetries: number; maxRuntimeMs: number };
}
export interface BoardConnectedEvent { boardId: string; timestamp: string }
export interface ApiErrorResponse { error: string }

/**
 * Copied from Track A's GET /api/boards response in src/server/api/app.ts
 * (read from its sibling checkout; confirm this shape when Track A merges).
 * Drizzle dates serialize as ISO strings through c.json().
 */
export interface BoardSummary {
  id: string;
  workspaceId: string;
  currentPhase: string;
  createdAt: string;
  workspace: { id: string; name: string; repoPath: string; defaultBranch: string };
  stopped: boolean;
}
export interface BoardsResponse { boards: BoardSummary[] }
