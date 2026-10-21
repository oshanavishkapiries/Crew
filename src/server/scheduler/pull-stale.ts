import { eq } from 'drizzle-orm';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import { systemClock, type Clock, type Runner } from '../runner/index.js';
import type { Scheduler } from './index.js';

export const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;
export function staleAfterMs(config: Record<string, unknown> | null) {
  return typeof config?.staleAfterMs === 'number' ? config.staleAfterMs : DEFAULT_STALE_AFTER_MS;
}
export function pullStatus(agent: typeof schema.agents.$inferSelect, now: number, window: number, running: boolean) {
  if (agent.mode !== 'pull') return agent.status;
  if (['stale', 'stopped', 'rate-limited'].includes(agent.status)) return agent.status;
  if (!agent.lastHeartbeatAt || now - agent.lastHeartbeatAt.getTime() >= window) return 'disconnected';
  return running ? 'running' : 'connected';
}

/** One configured window of grace after server start/resume; persisted activity is never rewritten. */
export class PullStaleScanner {
  private timer: ReturnType<Clock['setTimeout']>;
  private graceSince: number;
  private closed = true;
  private unsubscribe?: () => void;
  constructor(private options: { db: CrewDatabase; scheduler: Scheduler; runner: Runner; eventBus: EventBus; isStopped: () => boolean; clock?: Clock; intervalMs?: number }) {
    this.graceSince = this.clock.now();
  }
  private get clock() { return this.options.clock ?? systemClock; }
  start() {
    if (!this.closed) return;
    this.closed = false;
    this.graceSince = this.clock.now();
    this.unsubscribe = this.options.eventBus.subscribeBoardEvents('*', event => {
      if (event.type === 'control_changed' && (event.data as { stopped?: boolean }).stopped === false) this.graceSince = this.clock.now();
    });
    const tick = () => {
      if (this.closed) return;
      this.scanOnce();
      this.timer = this.clock.setTimeout(tick, this.options.intervalMs ?? 5000);
    };
    this.timer = this.clock.setTimeout(tick, this.options.intervalMs ?? 5000);
  }
  stop() { this.closed = true; this.clock.clearTimeout(this.timer); this.unsubscribe?.(); }
  scanOnce(): string[] {
    if (this.options.isStopped()) return [];
    const { db, scheduler, runner } = this.options;
    const now = this.clock.now();
    const affected: string[] = [];
    for (const agent of db.db.select().from(schema.agents).where(eq(schema.agents.mode, 'pull')).all()) {
      const workspace = db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, agent.workspaceId)).get();
      const window = staleAfterMs(workspace?.config ?? null);
      if (now - this.graceSince < window) continue;
      affected.push(...scheduler.requeueStalePull(agent.id, new Date(now - window), new Date(now), taskIds => {
        for (const taskId of taskIds) runner.endPullRun(taskId, 'stale', agent.id);
      }));
    }
    return affected;
  }
}
