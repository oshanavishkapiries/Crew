import { getHumanAction } from '../client.js';

interface StatusResponse {
  stopped: boolean;
  phases?: Array<{ boardId: string; phase: string; draftId?: string; taskId?: string; status?: string; problem?: string; ticketCounts?: Record<string, number> }>;
  mergeQueue?: { pending: number; warnings: Array<{ workspaceId: string; message: string }> };
  agents: Array<{ id: string; name: string; cliType: string; status: string }>;
  liveRuns: Array<{ id: string; taskId: string; agentId: string; sessionId?: string; pid?: number }>;
  rateLimits: Array<{ cliType: string; isPaused: boolean; resetTime?: number; backoffStep: number }>;
  taskCounts: Record<string, number>;
  totalTasks: number;
  verifyingTasks?: Array<{ id: string; title: string }>;
  reviewTasks?: Array<{ id: string; title: string; reviewerAgentId?: string | null }>;
}

export async function handleStatus(): Promise<void> {
  const status = await getHumanAction<StatusResponse>('/api/status');

  console.log(`=== Crew Status ===`);
  console.log(`Dispatch: ${status.stopped ? 'PAUSED (stopped)' : 'ACTIVE'}`);

  for (const phase of status.phases || []) {
    console.log(`Board ${phase.boardId}: ${phase.phase}`);
    if (phase.draftId) {
      console.log(`  Pending ${phase.phase} gate: ${phase.draftId}`);
      console.log(`  crew approve --board ${phase.boardId} --draft ${phase.draftId}`);
    }
    if (phase.taskId) {
      console.log(`  Phase task ${phase.taskId}: ${phase.status}`);
      if (['escalated', 'cancelled'].includes(phase.status || '')) console.log(`  Recovery: crew retry ${phase.taskId}`);
    }
    if (phase.problem) console.log(`  Attention: ${phase.problem}`);
    if (phase.phase === 'dispatch') {
      const counts = Object.entries(phase.ticketCounts || {});
      const total = counts.reduce((sum, [, count]) => sum + count, 0);
      console.log(`  Tickets (${total}): ${counts.map(([state, count]) => `${state}: ${count}`).join(', ') || 'none'}`);
    }
  }

  if (status.mergeQueue) {
    console.log(`Merge queue: ${status.mergeQueue.pending} pending`);
    for (const warning of status.mergeQueue.warnings) console.log(`  ${warning.workspaceId}: ${warning.message}`);
  }

  console.log(`\nAgents (${status.agents.length}):`);
  for (const agent of status.agents) {
    console.log(`  - ${agent.name} (${agent.id}): ${agent.status} [${agent.cliType}]`);
  }

  console.log(`\nLive Runs (${status.liveRuns.length}):`);
  if (status.liveRuns.length === 0) {
    console.log(`  None`);
  } else {
    for (const run of status.liveRuns) {
      console.log(`  - Run ${run.id}: Task ${run.taskId} (Agent: ${run.agentId}, PID: ${run.pid || 'n/a'})`);
    }
  }

  const pausedRateLimits = status.rateLimits.filter((r) => r.isPaused);
  if (pausedRateLimits.length > 0) {
    console.log(`\nRate Limit Pauses:`);
    for (const r of pausedRateLimits) {
      const resetStr = r.resetTime ? new Date(r.resetTime).toISOString() : 'unknown';
      console.log(`  - Tool ${r.cliType}: backoff step ${r.backoffStep}, resets at ${resetStr}`);
    }
  }

  if (status.verifyingTasks && status.verifyingTasks.length > 0) {
    console.log(`\nVerifying Tasks (${status.verifyingTasks.length}):`);
    for (const t of status.verifyingTasks) {
      console.log(`  - Task ${t.id}: ${t.title}`);
    }
  }

  if (status.reviewTasks && status.reviewTasks.length > 0) {
    console.log(`\nReview Tasks (${status.reviewTasks.length}):`);
    for (const t of status.reviewTasks) {
      const reviewer = t.reviewerAgentId ? ` (Reviewer: ${t.reviewerAgentId})` : '';
      console.log(`  - Task ${t.id}: ${t.title}${reviewer}`);
    }
  }

  console.log(`\nTasks Summary (${status.totalTasks} total):`);
  if (Object.keys(status.taskCounts).length === 0) {
    console.log(`  None`);
  } else {
    for (const [state, count] of Object.entries(status.taskCounts)) {
      console.log(`  ${state}: ${count}`);
    }
  }
}
