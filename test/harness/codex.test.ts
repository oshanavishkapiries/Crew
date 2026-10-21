import * as fs from 'node:fs';
import { once } from 'node:events';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { CodexAdapter } from '../../src/adapters/codex.js';
import { FakeAdapter } from '../../src/adapters/fake.js';
import type { AgentAdapter } from '../../src/adapters/types.js';
import type { Clock } from '../../src/server/runner/index.js';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

/** Real child + real crew CLI calls; only the paid Codex process is replaced.
 * The child emits Codex JSONL and the production Codex parser consumes it. */
class CodexProcessFake implements AgentAdapter {
  readonly id = 'codex' as const;
  constructor(private terminalRateLimit = false) {}
  readonly fake = new FakeAdapter();
  private wire = new CodexAdapter();
  detect = () => this.fake.detect();
  parseOutput = (chunk: string) => this.wire.parseOutput(chunk);
  createOutputParser = () => this.wire.createOutputParser();
  isRateLimit = (event: Parameters<AgentAdapter['isRateLimit']>[0]) => this.wire.isRateLimit(event);
  private wrap(config: ReturnType<AgentAdapter['buildSpawn']>) {
    config.args[2] = `
      import { randomUUID } from 'node:crypto';
      const wireSession = process.env.CREW_SESSION_ID || randomUUID();
      const originalLog = console.log;
      console.log = value => {
        let event; try { event = JSON.parse(value); } catch { return originalLog(value); }
        if (event.type === 'start') event = { type: 'thread.started', thread_id: wireSession };
        else if (event.type === 'completion') event = { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } };
        else if (event.type === 'rate_limit') {
          event = { type: 'turn.failed', error: { code: 'usage_limit_reached', message: 'Usage limit reached', resets_at: event.rateLimitResetTime } };
          if (${this.terminalRateLimit}) { process.stdout.write(JSON.stringify(event)); process.exit(1); }
          // One failed turn can carry both an error and a terminal failure event.
          originalLog(JSON.stringify({ type: 'error', ...event.error }));
        }
        else event = { type: 'item.completed', item: { id: 'item-test', type: 'command_execution', command: event.data?.tool || event.type, ...event.data } };
        originalLog(JSON.stringify(event));
      };
    ` + config.args[2];
    return config;
  }
  buildSpawn(opts: Parameters<AgentAdapter['buildSpawn']>[0]) { return this.wrap(this.fake.buildSpawn(opts)); }
  buildResume(opts: Parameters<NonNullable<AgentAdapter['buildResume']>>[0]) {
    const config = this.wrap(this.fake.buildResume(opts)); config.env.CREW_SESSION_ID = opts.sessionId; return config;
  }
}
class ManualClock implements Clock {
  private time = Date.now(); private sequence = 0;
  private timers = new Map<number, { due: number; cb: () => void }>();
  now() { return this.time; }
  setTimeout(cb: () => void, ms: number) { const id = ++this.sequence; this.timers.set(id, { due: this.time + ms, cb }); return id; }
  clearTimeout(id: any) { this.timers.delete(id); }
  advance(ms: number) { this.time += ms; for (const [id, timer] of [...this.timers]) if (timer.due <= this.time) { this.timers.delete(id); timer.cb(); } }
}
let h: PipelineHarness;
afterEach(async () => { await h?.cleanup(); });
async function setup(options: Parameters<typeof createPipelineHarness>[0] = {}, terminalRateLimit = false) {
  const adapter = new CodexProcessFake(terminalRateLimit);
  h = await createPipelineHarness({ ...options, adapters: { codex: adapter } });
  h.db.db.update(schema.agents).set({ cliType: 'codex' }).where(eq(schema.agents.id, h.agentId)).run();
  return adapter.fake;
}
const runs = (taskId: string) => h.db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).all();
const task = (id: string) => h.createTask({ id, title: id, description: 'Codex lifecycle', assigneeAgentId: h.agentId });
function waitForItem() {
  return new Promise<any>(resolve => {
    const unsubscribe = h.eventBus.subscribeRunEvents('*', event => {
      if (event.type === 'item.completed') { unsubscribe(); resolve((event.data as any).item); }
    });
  });
}

describe('Codex wiring through the pipeline (no paid agents)', () => {
  it('dispatches, captures the actual thread ID and answers via real session resume', async () => {
    const fake = await setup({ startDispatcher: true });
    fake.setScript([{ type: 'update', message: 'Checking' }, { type: 'ask', message: 'Which module system?' }]);
    fake.setResumeScript([{ type: 'edit_file', filePath: 'answer.txt', content: 'ESM\n' }, { type: 'done', result: 'Implemented ESM' }]);
    const ended = once(h.runner, 'run_ended'); await task('codex-ask'); await ended;
    expect(h.getTask('codex-ask')?.status).toBe('blocked');
    const first = runs('codex-ask')[0]; expect(first.sessionId).toBeTruthy(); expect(first.adapter).toBe('codex'); expect(first.exitReason).toBe('asked');
    const raw = fs.readFileSync(first.logPath!, 'utf8').split('\n').find(line => line.includes('thread.started'))!;
    expect(first.sessionId).toBe(JSON.parse(raw).thread_id);
    expect((await h.runCrew(['answer', 'codex-ask', 'Use ESM'])).exitCode).toBe(0);
    await h.waitForTaskStatus('codex-ask', 'verifying'); await h.waitForLiveRuns(0);
    const second = runs('codex-ask').find(run => run.id !== first.id)!;
    expect(runs('codex-ask').map(run => ({ sessionId: run.sessionId, resumedFromRunId: run.resumedFromRunId, reason: run.exitReason }))).toEqual([{ sessionId: first.sessionId, resumedFromRunId: null, reason: 'asked' }, { sessionId: first.sessionId, resumedFromRunId: first.id, reason: 'done' }]);
    expect(second.sessionId).toBe(first.sessionId); expect(second.resumedFromRunId).toBe(first.id); expect(second.exitReason).toBe('done');
    expect(second.prompt).toContain('Use ESM'); expect(second.prompt).toContain('never git push');
    expect(h.getTask('codex-ask')?.retries).toBe(0);
    expect(fs.readFileSync(`${h.getTask('codex-ask')!.worktreePath}/answer.txt`, 'utf8')).toBe('ESM\n');
  });

  it('pauses only Codex agents, applies exponential backoff and resumes without charging retries', async () => {
    const clock = new ManualClock(); const fake = await setup({ startDispatcher: true, clock });
    h.addAgent('other-codex', h.roleId, 'codex'); h.addAgent('other-tool');
    fake.setScript([{ type: 'rate_limit' }]); fake.setResumeScript([{ type: 'rate_limit' }]);
    let ended = once(h.runner, 'run_ended'); await task('codex-limit'); await ended;
    for (const id of [h.agentId, 'other-codex']) expect(h.db.db.select().from(schema.agents).where(eq(schema.agents.id, id)).get()?.status).toBe('rate-limited');
    expect(h.db.db.select().from(schema.agents).where(eq(schema.agents.id, 'other-tool')).get()?.status).toBe('idle');
    expect(h.runner.getRateLimitStatus('codex').resetTime).toBe(clock.now() + 60_000);
    clock.advance(59_999); expect(h.runner.getRateLimitStatus('codex').isPaused).toBe(true);
    ended = once(h.runner, 'run_ended'); clock.advance(1); await ended;
    expect(h.runner.getRateLimitStatus('codex').resetTime).toBe(clock.now() + 120_000);
    fake.setResumeScript([{ type: 'done', result: 'Recovered' }]); clock.advance(120_000);
    await h.waitForTaskStatus('codex-limit', 'verifying'); await h.waitForLiveRuns(0);
    const history = runs('codex-limit'); expect(history).toHaveLength(3);
    expect(new Set(history.map(run => run.sessionId)).size).toBe(1);
    expect(history.filter(run => run.exitReason === 'rate-limited')).toHaveLength(2);
    expect(h.getTask('codex-limit')?.retries).toBe(0); expect(h.runner.getRateLimitStatus('codex').backoffStep).toBe(0);
  });

  it('honours a reported reset time from a Codex structured error', async () => {
    const clock = new ManualClock(); const fake = await setup({ clock });
    fake.setScript([{ type: 'rate_limit', rateLimitResetTime: new Date(clock.now() + 45_000).toISOString() }]);
    await task('codex-reset'); await h.scheduler.transitionTask('codex-reset', 'doing');
    expect((await h.runner.runTask('codex-reset')).exitReason).toBe('rate-limited');
    expect(h.runner.getRateLimitStatus('codex').resetTime).toBe(clock.now() + 45_000);
    expect(h.getTask('codex-reset')?.retries).toBe(0);
  });

  it('handles a rate-limit event at process exit without a final newline', async () => {
    const clock = new ManualClock(); const fake = await setup({ clock }, true);
    fake.setScript([{ type: 'rate_limit' }]);
    await task('codex-final-limit'); await h.scheduler.transitionTask('codex-final-limit', 'doing');
    expect((await h.runner.runTask('codex-final-limit')).exitReason).toBe('rate-limited');
    expect(h.runner.getRateLimitStatus('codex').resetTime).toBe(clock.now() + 60_000);
    expect(h.getTask('codex-final-limit')?.retries).toBe(0);
  });

  it('stop-all kills the process group and keeps dispatch stopped until Resume', async () => {
    const fake = await setup({ startDispatcher: true }); fake.setScript([{ type: 'hang' }]);
    const item = waitForItem(); await task('codex-stop'); const child = await item;
    const ended = once(h.runner, 'run_ended'); expect((await h.runCrew(['stop-all'])).exitCode).toBe(0); await ended;
    expect(runs('codex-stop')[0].exitReason).toBe('stopped'); expect(h.getTask('codex-stop')?.retries).toBe(0);
    expect(() => process.kill(Number(child.grandchildPid), 0)).toThrow(); expect(h.dispatcher.isStopped()).toBe(true);
    fake.setScript([{ type: 'done', result: 'Continued' }]); fake.setResumeScript([{ type: 'done', result: 'Continued' }]);
    expect((await h.runCrew(['resume'])).exitCode).toBe(0); await h.waitForTaskStatus('codex-stop', 'verifying'); await h.waitForLiveRuns(0);
    expect(h.getTask('codex-stop')?.retries).toBe(0);
  });

  it.each(['timeout', 'no-output'] as const)('kills Codex and descendants on %s and charges a retry', async reason => {
    const clock = new ManualClock(); const fake = await setup({ clock, maxRuntimeMs: reason === 'timeout' ? 1000 : 10_000, noOutputTimeoutMs: reason === 'no-output' ? 1000 : 10_000 });
    fake.setScript([{ type: 'hang' }]); await task(`codex-${reason}`); await h.scheduler.transitionTask(`codex-${reason}`, 'doing');
    const item = waitForItem(); const running = h.runner.runTask(`codex-${reason}`); const child = await item;
    clock.advance(1001); const result = await running;
    expect(result.exitReason).toBe(reason); expect(h.getTask(`codex-${reason}`)?.retries).toBe(1);
    expect(() => process.kill(Number(child.grandchildPid), 0)).toThrow();
  });

  it('turn.completed without crew done uses the existing exit fallback and escalates after retries', async () => {
    const fake = await setup({ maxRetries: 0 }); fake.setScript([]);
    await task('codex-no-done'); await h.scheduler.transitionTask('codex-no-done', 'doing');
    expect((await h.runner.runTask('codex-no-done')).exitReason).toBe('exited');
    expect(h.getTask('codex-no-done')?.status).toBe('escalated'); expect(h.getTask('codex-no-done')?.retries).toBe(1);
    expect(h.getVerificationResults('codex-no-done')).toHaveLength(0);
  });
});
