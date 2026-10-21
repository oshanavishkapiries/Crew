import type { BoardTask, Dependency } from './board-types';
export interface TaskRun { agent?: { id: string; name: string } | null; id: string; taskId: string; agentId: string; adapter: string; startedAt: string; endedAt: string | null; exitReason: string | null; exitCode: number | null; kind: string }
export interface TaskDetail {
  task: BoardTask; dependencies: Dependency[];
  runs: TaskRun[];
  messages: { id: string; fromAgentId: string | null; type: string; body: string; createdAt: string }[];
  verificationResults: { id: string; runId: string; step: string; passed: boolean; output: string | null; createdAt: string }[];
  commits: { sha: string; subject?: string; source: 'branch' | 'merge' }[];
}
export interface TaskLogs { missing?: boolean; truncated?: boolean; offset?: number; content: string; runId: string | null; exitReason?: string | null; exitCode?: number | null }
export interface TaskDiff { diff: string; branch?: string; baseBranch?: string; error?: string }
