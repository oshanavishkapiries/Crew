import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { eq, desc, asc, and } from 'drizzle-orm';
import { execa, type ResultPromise } from 'execa';
import type { AgentAdapter, AgentEvent, PermissionProfile } from '../../adapters/types.js';
import { ClaudeCodeAdapter } from '../../adapters/claude-code.js';
import { getCrewHome, getCrewLogsDir } from '../config.js';
import { findPackageRoot, type CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { ExitReason } from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import { hashToken } from '../api/security.js';
import type { Scheduler } from '../scheduler/index.js';

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, ms: number): any;
  clearTimeout(id: any): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

export function ensureCrewShim(crewHome: string): string {
  const binDir = path.join(crewHome, 'bin');
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }
  const root = findPackageRoot();
  const cliPath = path.join(root, 'dist', 'cli.js');
  const shimPath = path.join(binDir, 'crew');
  const shimContent = `#!/bin/sh\nexec node "${cliPath}" "$@"\n`;

  try {
    fs.writeFileSync(shimPath, shimContent, { mode: 0o755 });
    fs.chmodSync(shimPath, 0o755);
  } catch {
    // If chmod fails on some systems
  }
  return binDir;
}

export async function killProcessGroup(
  pid: number,
  signal: NodeJS.Signals = 'SIGTERM',
  gracePeriodMs = 5000,
  clock: Clock = systemClock,
): Promise<void> {
  try {
    process.kill(-pid, signal);
  } catch (err: any) {
    if (err.code !== 'ESRCH') {
      // Try direct kill if process group kill fails
      try {
        process.kill(pid, signal);
      } catch {
        // ESRCH
      }
    }
  }

  // Schedule SIGKILL after grace period
  clock.setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (err: any) {
      if (err.code !== 'ESRCH') {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // ESRCH
        }
      }
    }
  }, gracePeriodMs);
}

const ALLOWED_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'NODE_PATH',
  'NODE_OPTIONS',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'CLAUDE_CONFIG_DIR',
  'CREW_HOME',
];

export interface RunnerOptions {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  adapters?: Record<string, AgentAdapter>;
  clock?: Clock;
  maxRuntimeMs?: number; // default 30 min (D24)
  noOutputTimeoutMs?: number; // default 5 min (D24)
  killGracePeriodMs?: number; // default 5000 ms
  askGracePeriodMs?: number; // default 1000 ms
  serverUrl?: string;
  crewHome?: string;
}

export interface StartRunOptions {
  taskId: string;
  agentId?: string;
  adapter?: AgentAdapter;
  prompt?: string;
  resumedFromRunId?: string;
  sessionId?: string;
  isResume?: boolean;
}

export interface ActiveRun {
  id: string;
  taskId: string;
  agentId: string;
  adapterName: string;
  adapter: AgentAdapter;
  process: ResultPromise;
  pid?: number;
  sessionId?: string;
  isResume?: boolean;
  eventCount: number;
  logPath: string;
  logStream: fs.WriteStream;
  exitReason?: ExitReason;
  killed?: boolean;
  maxRuntimeTimer?: any;
  noOutputTimer?: any;
  promise: Promise<RunResult>;
}

export interface RunResult {
  runId: string;
  taskId: string;
  agentId: string;
  exitCode: number | null;
  exitReason: ExitReason;
  stdout: string;
}

export class Runner extends EventEmitter {
  private db: CrewDatabase;
  private eventBus: EventBus;
  private scheduler: Scheduler;
  private adapters: Map<string, AgentAdapter> = new Map();
  private clock: Clock;
  private maxRuntimeMs: number;
  private noOutputTimeoutMs: number;
  private killGracePeriodMs: number;
  private askGracePeriodMs: number;
  private serverUrl: string;
  private crewHome: string;

  private liveRuns: Map<string, ActiveRun> = new Map();
  private agentTokens: Map<string, string> = new Map();
  private backoffStepByTool: Map<string, number> = new Map();
  private rateLimitTimers: Map<string, any> = new Map();
  private rateLimitResetTimes: Map<string, number> = new Map();

  constructor(options: RunnerOptions) {
    super();
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.scheduler = options.scheduler;
    this.clock = options.clock || systemClock;
    this.maxRuntimeMs = options.maxRuntimeMs ?? 30 * 60 * 1000;
    this.noOutputTimeoutMs = options.noOutputTimeoutMs ?? 5 * 60 * 1000;
    this.killGracePeriodMs = options.killGracePeriodMs ?? 5000;
    this.askGracePeriodMs = options.askGracePeriodMs ?? 1000;
    this.serverUrl = options.serverUrl || 'http://127.0.0.1:4000';
    this.crewHome = options.crewHome || getCrewHome();

    if (options.adapters) {
      for (const [name, adapter] of Object.entries(options.adapters)) {
        this.registerAdapter(name, adapter);
      }
    }
    if (!this.adapters.has('claude-code')) {
      this.registerAdapter('claude-code', new ClaudeCodeAdapter());
    }

    this.loadRateLimits();

    // Subscribe to board events: when task moves to blocked (crew ask), end the process
    this.eventBus.subscribeBoardEvents('*', (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as { taskId: string; to: string };
        if (data && data.to === 'blocked') {
          this.handleTaskBlocked(data.taskId);
        }
      }
    });
  }

  registerAdapter(name: string, adapter: AgentAdapter): void {
    this.adapters.set(name, adapter);
  }

  getAdapter(name: string): AgentAdapter | undefined {
    return this.adapters.get(name);
  }

  registerAgentToken(agentId: string, token: string): void {
    this.agentTokens.set(agentId, token);
  }

  getAgentToken(agentId: string): string | undefined {
    return this.agentTokens.get(agentId);
  }

  getOrCreateAgentToken(agentId: string): string {
    const existing = this.agentTokens.get(agentId);
    if (existing) return existing;

    const token = 'crew_agent_' + crypto.randomBytes(16).toString('hex');
    this.db.db
      .update(schema.agents)
      .set({ tokenHash: hashToken(token) })
      .where(eq(schema.agents.id, agentId))
      .run();

    this.agentTokens.set(agentId, token);
    return token;
  }

  getLiveRuns(): ActiveRun[] {
    return Array.from(this.liveRuns.values());
  }

  getLiveRunByTaskId(taskId: string): ActiveRun | undefined {
    for (const run of this.liveRuns.values()) {
      if (run.taskId === taskId) return run;
    }
    return undefined;
  }

  getLiveRun(runId: string): ActiveRun | undefined {
    return this.liveRuns.get(runId);
  }

  async startRun(options: StartRunOptions): Promise<ActiveRun> {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, options.taskId)).get();
    if (!task) throw new Error(`Task not found: ${options.taskId}`);

    const agentId = options.agentId || task.assigneeAgentId;
    if (!agentId) throw new Error(`Task ${options.taskId} has no assignee agent`);

    const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const role = this.db.db.select().from(schema.roles).where(eq(schema.roles.id, agent.roleId)).get();

    const adapter = options.adapter || this.getAdapter(agent.cliType);
    if (!adapter) throw new Error(`No adapter registered for cliType: ${agent.cliType}`);

    const runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const agentToken = this.getOrCreateAgentToken(agentId);

    // Workspace & work directory
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
    const workspace = board
      ? this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()
      : undefined;
    const workDir = task.worktreePath || workspace?.repoPath || process.cwd();

    // Default prompt if not provided
    const prompt =
      options.prompt ||
      [
        role?.defaultPrompt || '',
        agent.personality ? `Persona: ${agent.personality}` : '',
        `Task: ${task.title}`,
        task.description ? `Description: ${task.description}` : '',
        task.acceptanceCriteria ? `Acceptance Criteria: ${task.acceptanceCriteria}` : '',
      ]
        .filter(Boolean)
        .join('\n\n');

    // Prepend crew shim to PATH
    const shimBinDir = ensureCrewShim(this.crewHome);

    // Session ID (D6: UUID generated by Crew)
    const sessionId = options.sessionId || crypto.randomUUID();

    // Minimal allowlisted environment
    const childEnv: Record<string, string> = {};
    for (const key of ALLOWED_ENV_VARS) {
      if (process.env[key] !== undefined) {
        childEnv[key] = process.env[key]!;
      }
    }
    childEnv.PATH = `${shimBinDir}:${process.env.PATH || ''}`;
    childEnv.CREW_SERVER_URL = this.serverUrl;
    childEnv.CREW_TASK_ID = task.id;
    childEnv.CREW_AGENT_TOKEN = agentToken;
    childEnv.CREW_SESSION_ID = sessionId;
    childEnv.CREW_CLI_PATH = path.join(findPackageRoot(), 'dist', 'cli.js');

    const permissionProfile: PermissionProfile = (role?.permissionProfile as PermissionProfile) || {
      mode: 'standard',
      allowCommands: [],
      denyCommands: [],
    };

    // Build spawn or resume command
    let spawnConfig: { command: string; args: string[]; env: Record<string, string> };
    if (options.isResume && options.sessionId && adapter.buildResume) {
      spawnConfig = adapter.buildResume({
        sessionId: options.sessionId,
        prompt,
        workDir,
        permissions: permissionProfile,
        taskId: task.id,
        serverUrl: this.serverUrl,
        agentToken,
      });
    } else {
      spawnConfig = adapter.buildSpawn({
        prompt,
        workDir,
        permissions: permissionProfile,
        taskId: task.id,
        serverUrl: this.serverUrl,
        agentToken,
      });
    }

    Object.assign(childEnv, spawnConfig.env);

    // Ensure logs directory exists
    const logsDir = getCrewLogsDir();
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, `${runId}.jsonl`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    // Insert Run in DB
    const startedAt = new Date();
    this.db.db
      .insert(schema.runs)
      .values({
        id: runId,
        taskId: task.id,
        agentId,
        adapter: agent.cliType,
        startedAt,
        sessionId,
        resumedFromRunId: options.resumedFromRunId || null,
        logPath,
        prompt,
      })
      .run();

    // Spawn process with prompt on stdin and detached: true
    const subprocess = execa(spawnConfig.command, spawnConfig.args, {
      cwd: workDir,
      env: childEnv,
      input: prompt,
      detached: true,
      reject: false,
    });

    const pid = subprocess.pid;
    if (pid) {
      this.db.db.update(schema.runs).set({ pid }).where(eq(schema.runs.id, runId)).run();
    }

    let capturedStdout = '';
    let lineBuffer = '';

    let resolvePromise!: (result: RunResult) => void;
    let rejectPromise!: (err: any) => void;
    const promise = new Promise<RunResult>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });

    const activeRun: ActiveRun = {
      id: runId,
      taskId: task.id,
      agentId,
      adapterName: agent.cliType,
      adapter,
      process: subprocess,
      pid,
      sessionId: sessionId || undefined,
      isResume: Boolean(options.isResume),
      eventCount: 0,
      logPath,
      logStream,
      promise,
    };

    this.liveRuns.set(runId, activeRun);
    this.db.db.update(schema.agents).set({ status: 'busy' }).where(eq(schema.agents.id, agentId)).run();
    this.emit('run_started', activeRun);

    // Reset no-output timer on every chunk
    const resetNoOutputTimer = () => {
      if (activeRun.noOutputTimer) {
        this.clock.clearTimeout(activeRun.noOutputTimer);
      }
      activeRun.noOutputTimer = this.clock.setTimeout(() => {
        this.handleTimeout(activeRun, 'no-output');
      }, this.noOutputTimeoutMs);
    };

    // Max runtime timer
    activeRun.maxRuntimeTimer = this.clock.setTimeout(() => {
      this.handleTimeout(activeRun, 'timeout');
    }, this.maxRuntimeMs);

    resetNoOutputTimer();

    // Handle stdout stream
    if (subprocess.stdout) {
      subprocess.stdout.on('data', (chunk: Buffer) => {
        resetNoOutputTimer();
        const text = chunk.toString();
        capturedStdout += text;
        lineBuffer += text;

        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          logStream.write(line + '\n');
          const events = adapter.parseOutput(line);
          activeRun.eventCount += events.length;
          for (const event of events) {
            if (event.sessionId && !activeRun.sessionId) {
              activeRun.sessionId = event.sessionId;
              this.db.db
                .update(schema.runs)
                .set({ sessionId: event.sessionId })
                .where(eq(schema.runs.id, runId))
                .run();
            }
            this.eventBus.publishRunEvent(runId, event);

            if (adapter.isRateLimit(event)) {
              this.handleRateLimit(activeRun, event);
            }
          }
        }
      });
    }

    if (subprocess.stderr) {
      subprocess.stderr.on('data', (chunk: Buffer) => {
        resetNoOutputTimer();
        const text = chunk.toString();
        logStream.write(`[stderr] ${text}\n`);
      });
    }

    // Process exit handler
    subprocess.then(
      async (result) => {
        this.cleanupTimers(activeRun);
        this.liveRuns.delete(runId);

        // Flush remaining buffer
        if (lineBuffer.trim()) {
          logStream.write(lineBuffer.trim() + '\n');
          const events = adapter.parseOutput(lineBuffer.trim());
          for (const event of events) {
            this.eventBus.publishRunEvent(runId, event);
          }
        }
        logStream.end();

        const endedAt = new Date();
        const exitCode = result.exitCode ?? 0;

        // Determine exitReason
        let exitReason: ExitReason = activeRun.exitReason || 'exited';
        const updatedTask = this.db.db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.id, task.id))
          .get();

        if (!activeRun.exitReason) {
          if (updatedTask?.status === 'verifying') {
            exitReason = 'done';
          } else if (updatedTask?.status === 'blocked') {
            exitReason = 'asked';
          } else if (activeRun.isResume && activeRun.eventCount === 0) {
            exitReason = 'resume-failed';
          } else {
            exitReason = 'exited';
          }
        }

        // Update runs row in DB
        this.db.db
          .update(schema.runs)
          .set({
            endedAt,
            exitCode,
            exitReason,
          })
          .where(eq(schema.runs.id, runId))
          .run();

        // Handle retry if failed while doing
        if (
          (exitReason === 'timeout' || exitReason === 'no-output' || exitReason === 'exited') &&
          updatedTask?.status === 'doing'
        ) {
          try {
            await this.scheduler.transitionTask(task.id, 'doing', {
              reason: `Run ended with ${exitReason}`,
              incrementRetries: true,
            });
          } catch {
            // e.g. already transitioned or escalated
          }
        }

        // Handle fallback if resume failed
        if (exitReason === 'resume-failed' && updatedTask?.status === 'doing') {
          try {
            const fallbackPrompt = await this.buildFallbackPrompt(task);
            this.startRun({
              taskId: task.id,
              agentId,
              prompt: fallbackPrompt,
            }).catch(() => {});
          } catch {
            // ignore
          }
        }

        // Reset backoff on successful run
        if (exitReason === 'done') {
          const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
          if (agent) {
            this.backoffStepByTool.delete(agent.cliType);
            this.saveRateLimits();
          }
        }

        // Reset agent status back to idle if busy (unless rate-limited or stopped)
        if (exitReason !== 'rate-limited' && exitReason !== 'stopped') {
          const currentAgent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
          if (currentAgent && currentAgent.status === 'busy') {
            this.db.db.update(schema.agents).set({ status: 'idle' }).where(eq(schema.agents.id, agentId)).run();
          }
        }

        const runResult: RunResult = {
          runId,
          taskId: task.id,
          agentId,
          exitCode,
          exitReason,
          stdout: capturedStdout,
        };

        this.eventBus.publishRunEvent(runId, {
          type: 'run_ended',
          data: { runId, exitCode, exitReason },
        });

        this.emit('run_ended', runResult);
        resolvePromise(runResult);
      },
      (err) => {
        this.cleanupTimers(activeRun);
        this.liveRuns.delete(runId);
        if (activeRun.exitReason !== 'rate-limited' && activeRun.exitReason !== 'stopped') {
          const currentAgent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
          if (currentAgent && currentAgent.status === 'busy') {
            this.db.db.update(schema.agents).set({ status: 'idle' }).where(eq(schema.agents.id, agentId)).run();
          }
        }
        logStream.end();
        rejectPromise(err);
      },
    );

    return activeRun;
  }

  async runTask(taskId: string, options: Partial<StartRunOptions> = {}): Promise<RunResult> {
    const handle = await this.startRun({ taskId, ...options });
    return await handle.promise;
  }

  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  async buildFallbackPrompt(task: typeof schema.tasks.$inferSelect): Promise<string> {
    const agent = task.assigneeAgentId
      ? this.db.db.select().from(schema.agents).where(eq(schema.agents.id, task.assigneeAgentId)).get()
      : undefined;
    const role = agent
      ? this.db.db.select().from(schema.roles).where(eq(schema.roles.id, agent.roleId)).get()
      : undefined;

    const parts: string[] = [];
    if (role?.defaultPrompt) parts.push(role.defaultPrompt);
    if (agent?.personality) parts.push(`Persona: ${agent.personality}`);
    parts.push(`Task: ${task.title}`);
    if (task.description) parts.push(`Description: ${task.description}`);
    if (task.acceptanceCriteria) parts.push(`Acceptance Criteria: ${task.acceptanceCriteria}`);

    // Q&A so far
    const messages = this.db.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.taskId, task.id))
      .orderBy(asc(schema.messages.createdAt))
      .all();

    const qaMessages = messages.filter((m) => m.type === 'question' || m.type === 'answer');
    if (qaMessages.length > 0) {
      parts.push('Questions and Answers:');
      for (const msg of qaMessages) {
        if (msg.type === 'question') {
          parts.push(`Question: ${msg.body}`);
        } else if (msg.type === 'answer') {
          parts.push(`Answer: ${msg.body}`);
        }
      }
    }

    // Worktree git diff --stat
    const workDir = task.worktreePath || process.cwd();
    try {
      await execa('git', ['add', '-N', '.'], { cwd: workDir, reject: false });
      const diffResult = await execa('git', ['diff', '--stat', 'HEAD'], { cwd: workDir, reject: false });
      const statusResult = await execa('git', ['status', '--short'], { cwd: workDir, reject: false });
      const summaries: string[] = [];
      if (diffResult.stdout?.trim()) {
        summaries.push(diffResult.stdout.trim());
      } else if (statusResult.stdout?.trim()) {
        summaries.push(statusResult.stdout.trim());
      }
      if (summaries.length > 0) {
        parts.push(`Worktree git diff --stat summary:\n${summaries.join('\n')}`);
      }
    } catch {
      // ignore
    }

    return parts.join('\n\n');
  }

  async resumeTask(taskId: string, answer?: string): Promise<ActiveRun> {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agentId = task.assigneeAgentId;
    if (!agentId) throw new Error(`Task ${taskId} has no assignee agent`);

    const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const adapter = this.getAdapter(agent.cliType);
    if (!adapter) throw new Error(`No adapter registered for cliType: ${agent.cliType}`);

    const lastRun = this.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(desc(schema.runs.startedAt))
      .get();

    const canResume = Boolean(adapter.buildResume && lastRun?.sessionId);

    if (canResume) {
      try {
        return await this.startRun({
          taskId: task.id,
          agentId,
          isResume: true,
          sessionId: lastRun!.sessionId!,
          resumedFromRunId: lastRun!.id,
          prompt: answer || 'Resume session with answer',
        });
      } catch {
        // Adapter refused resume (e.g. FakeAdapter refuseResume threw)
      }
    }

    // Fallback: record failed resume attempt and start a fresh run
    const failedRunId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    this.db.db
      .insert(schema.runs)
      .values({
        id: failedRunId,
        taskId: task.id,
        agentId,
        adapter: agent.cliType,
        startedAt: new Date(),
        endedAt: new Date(),
        resumedFromRunId: lastRun?.id || null,
        exitReason: 'resume-failed',
        exitCode: 1,
        logPath: '',
        prompt: answer || '',
      })
      .run();

    const fallbackPrompt = await this.buildFallbackPrompt(task);
    return await this.startRun({
      taskId: task.id,
      agentId,
      prompt: fallbackPrompt,
    });
  }

  async killRun(runId: string, exitReason: ExitReason = 'stopped'): Promise<void> {
    const run = this.liveRuns.get(runId);
    if (!run) return;

    run.exitReason = exitReason;
    run.killed = true;
    this.cleanupTimers(run);

    if (run.pid) {
      await killProcessGroup(run.pid, 'SIGTERM', this.killGracePeriodMs, this.clock);
    }
  }

  async killAll(exitReason: ExitReason = 'stopped'): Promise<number> {
    for (const timer of this.rateLimitTimers.values()) {
      this.clock.clearTimeout(timer);
    }
    this.rateLimitTimers.clear();

    const runs = this.getLiveRuns();
    await Promise.all(runs.map((r) => this.killRun(r.id, exitReason)));
    await Promise.all(runs.map((r) => r.promise.catch(() => {})));
    return runs.length;
  }

  private handleTaskBlocked(taskId: string): void {
    const run = this.getLiveRunByTaskId(taskId);
    if (!run) return;

    run.exitReason = 'asked';
    // Grace period for agent to finish turn naturally after crew ask
    this.clock.setTimeout(() => {
      if (this.liveRuns.has(run.id) && run.pid) {
        killProcessGroup(run.pid, 'SIGTERM', this.killGracePeriodMs, this.clock).catch(() => {});
      }
    }, this.askGracePeriodMs);
  }

  private handleTimeout(run: ActiveRun, reason: 'timeout' | 'no-output'): void {
    if (!this.liveRuns.has(run.id)) return;
    run.exitReason = reason;
    run.killed = true;
    this.cleanupTimers(run);

    if (run.pid) {
      killProcessGroup(run.pid, 'SIGTERM', this.killGracePeriodMs, this.clock).catch(() => {});
    }
  }

  private handleRateLimit(run: ActiveRun, event: AgentEvent): void {
    if (!this.liveRuns.has(run.id)) return;
    run.exitReason = 'rate-limited';
    run.killed = true;
    this.cleanupTimers(run);

    const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, run.agentId)).get();
    const cliType = agent?.cliType || 'fake';

    // 1. Kill any other live runs of this tool
    for (const otherRun of this.liveRuns.values()) {
      if (otherRun.id !== run.id) {
        const otherAgent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, otherRun.agentId)).get();
        if (otherAgent?.cliType === cliType) {
          otherRun.exitReason = 'rate-limited';
          otherRun.killed = true;
          this.cleanupTimers(otherRun);
          if (otherRun.pid) {
            killProcessGroup(otherRun.pid, 'SIGTERM', this.killGracePeriodMs, this.clock).catch(() => {});
          }
        }
      }
    }

    // 2. Kill current run's process group
    if (run.pid) {
      killProcessGroup(run.pid, 'SIGTERM', this.killGracePeriodMs, this.clock).catch(() => {});
    }

    // 3. Mark every agent of this tool as rate-limited in DB
    this.db.db
      .update(schema.agents)
      .set({ status: 'rate-limited' })
      .where(eq(schema.agents.cliType, cliType))
      .run();

    // 4. Calculate delay
    let delayMs: number | undefined;
    if (event.rateLimitResetTime) {
      const resetTime = new Date(event.rateLimitResetTime).getTime();
      const now = this.clock.now();
      if (!isNaN(resetTime) && resetTime > now) {
        delayMs = resetTime - now;
        this.rateLimitResetTimes.set(cliType, resetTime);
      }
    }

    if (delayMs === undefined) {
      const BACKOFF_SCHEDULE_MS = [
        1 * 60 * 1000,
        2 * 60 * 1000,
        4 * 60 * 1000,
        8 * 60 * 1000,
        16 * 60 * 1000,
        30 * 60 * 1000,
      ];
      const currentStep = this.backoffStepByTool.get(cliType) ?? 0;
      delayMs = BACKOFF_SCHEDULE_MS[Math.min(currentStep, BACKOFF_SCHEDULE_MS.length - 1)];
      const nextStep = Math.min(currentStep + 1, BACKOFF_SCHEDULE_MS.length - 1);
      this.backoffStepByTool.set(cliType, nextStep);
      this.rateLimitResetTimes.set(cliType, this.clock.now() + delayMs);
    }

    // 5. Clear prior timer if any
    const existingTimer = this.rateLimitTimers.get(cliType);
    if (existingTimer) {
      this.clock.clearTimeout(existingTimer);
    }

    // 6. Schedule resume
    const timer = this.clock.setTimeout(async () => {
      await this.resumeRateLimitedTool(cliType);
    }, delayMs);
    this.rateLimitTimers.set(cliType, timer);

    this.saveRateLimits();

    this.emit('rate_limit', { run, event, delayMs });
    this.eventBus.publishBoardEvent('*', {
      type: 'rate_limited',
      data: { cliType, delayMs, resetTime: this.rateLimitResetTimes.get(cliType) },
    });
  }

  async resumeRateLimitedTool(cliType: string): Promise<void> {
    const timer = this.rateLimitTimers.get(cliType);
    if (timer) {
      this.clock.clearTimeout(timer);
      this.rateLimitTimers.delete(cliType);
    }
    this.rateLimitResetTimes.delete(cliType);
    this.saveRateLimits();

    this.db.db
      .update(schema.agents)
      .set({ status: 'idle' })
      .where(and(eq(schema.agents.cliType, cliType), eq(schema.agents.status, 'rate-limited')))
      .run();

    this.emit('rate_limit_cleared', { cliType });
    this.eventBus.publishBoardEvent('*', {
      type: 'rate_limit_cleared',
      data: { cliType },
    });
  }

  getRateLimitStatus(cliType: string): { cliType: string; isPaused: boolean; resetTime?: number; backoffStep: number } {
    const isPaused =
      this.rateLimitTimers.has(cliType) ||
      this.db.db
        .select()
        .from(schema.agents)
        .where(and(eq(schema.agents.cliType, cliType), eq(schema.agents.status, 'rate-limited')))
        .all().length > 0;
    return {
      cliType,
      isPaused,
      resetTime: this.rateLimitResetTimes.get(cliType),
      backoffStep: this.backoffStepByTool.get(cliType) ?? 0,
    };
  }

  getAllRateLimits(): Array<{ cliType: string; isPaused: boolean; resetTime?: number; backoffStep: number }> {
    const agents = this.db.db.select({ cliType: schema.agents.cliType }).from(schema.agents).all();
    const uniqueTools = Array.from(new Set(agents.map((a) => a.cliType)));
    return uniqueTools.map((t) => this.getRateLimitStatus(t));
  }

  private loadRateLimits(): void {
    const filePath = path.join(this.crewHome, 'rate-limits.json');
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        for (const [cliType, state] of Object.entries(data)) {
          const s = state as { isPaused?: boolean; resetTime?: number; backoffStep?: number };
          if (s.backoffStep !== undefined) {
            this.backoffStepByTool.set(cliType, s.backoffStep);
          }
          if (s.isPaused && s.resetTime) {
            this.rateLimitResetTimes.set(cliType, s.resetTime);
            const now = this.clock.now();
            const delay = Math.max(0, s.resetTime - now);
            const timer = this.clock.setTimeout(async () => {
              await this.resumeRateLimitedTool(cliType);
            }, delay);
            this.rateLimitTimers.set(cliType, timer);
          }
        }
      } catch {
        // ignore
      }
    }

    try {
      const pausedAgents = this.db.db
        .select({ cliType: schema.agents.cliType })
        .from(schema.agents)
        .where(eq(schema.agents.status, 'rate-limited'))
        .all();
      for (const a of pausedAgents) {
        if (!this.rateLimitTimers.has(a.cliType)) {
          const delay = 60 * 1000;
          this.rateLimitResetTimes.set(a.cliType, this.clock.now() + delay);
          const timer = this.clock.setTimeout(async () => {
            await this.resumeRateLimitedTool(a.cliType);
          }, delay);
          this.rateLimitTimers.set(a.cliType, timer);
        }
      }
    } catch {
      // ignore
    }
  }

  private saveRateLimits(): void {
    const filePath = path.join(this.crewHome, 'rate-limits.json');
    const data: Record<string, any> = {};
    const tools = new Set([...this.backoffStepByTool.keys(), ...this.rateLimitTimers.keys()]);
    for (const tool of tools) {
      data[tool] = {
        isPaused: this.rateLimitTimers.has(tool),
        resetTime: this.rateLimitResetTimes.get(tool),
        backoffStep: this.backoffStepByTool.get(tool) ?? 0,
      };
    }
    try {
      if (!fs.existsSync(this.crewHome)) {
        fs.mkdirSync(this.crewHome, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  private cleanupTimers(run: ActiveRun): void {
    if (run.maxRuntimeTimer) {
      this.clock.clearTimeout(run.maxRuntimeTimer);
      run.maxRuntimeTimer = undefined;
    }
    if (run.noOutputTimer) {
      this.clock.clearTimeout(run.noOutputTimer);
      run.noOutputTimer = undefined;
    }
  }
}
