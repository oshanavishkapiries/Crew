import { getHumanAction } from '../client.js';

interface StatusResponse {
  stopped: boolean;
  agents: Array<{ id: string; name: string; cliType: string; status: string }>;
  liveRuns: Array<{ id: string; taskId: string; agentId: string; sessionId?: string; pid?: number }>;
  rateLimits: Array<{ cliType: string; isPaused: boolean; resetTime?: number; backoffStep: number }>;
  taskCounts: Record<string, number>;
  totalTasks: number;
}

export async function handleStatus(): Promise<void> {
  const status = await getHumanAction<StatusResponse>('/api/status');

  console.log(`=== Crew Status ===`);
  console.log(`Dispatch: ${status.stopped ? 'PAUSED (stopped)' : 'ACTIVE'}`);

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

  console.log(`\nTasks Summary (${status.totalTasks} total):`);
  if (Object.keys(status.taskCounts).length === 0) {
    console.log(`  None`);
  } else {
    for (const [state, count] of Object.entries(status.taskCounts)) {
      console.log(`  ${state}: ${count}`);
    }
  }
}
