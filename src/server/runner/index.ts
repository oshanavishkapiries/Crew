import { PHASE_OUTPUT_FILE, PHASES } from '../workflow/phases.js';
import { buildPrompt, type ReviewContext } from '../memory/prompt.js';
import { commandPrefixes, type ProjectConfig } from '../project-config.js';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { sql, eq, desc, and } from 'drizzle-orm';
import { execa, type ResultPromise } from 'execa';
import type { AgentAdapter, AgentEvent, PermissionProfile } from '../../adapters/types.js';
import { CodexAdapter, codexPermissionInstructions } from '../../adapters/codex.js';
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

export function ensureClaudeSettings(crewHome: string): string {
  const settingsPath = path.join(crewHome, 'claude-settings.json');
  const content = JSON.stringify(
    {
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: 'crew hook stop',
              },
            ],
          },
        ],
      },
    },
    null,
    2,
  );
  try {
    fs.writeFileSync(settingsPath, content, 'utf8');
  } catch {}
  return settingsPath;
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
  fallback?: boolean;
  reviewContext?: ReviewContext;
  resumedFromRunId?: string;
  sessionId?: string;
  isResume?: boolean;
  kind?: 'work' | 'review';
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

  private startingWork = new Map<string, Promise<ActiveRun>>();
  private startingPhases = new Set<string>();
  private liveRuns: Map<string, ActiveRun> = new Map();
  private cancelling: Set<string> = new Set();
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

    if (!this.adapters.has('codex')) this.registerAdapter('codex', new CodexAdapter());

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

  /**
   * The main checkout's `git status` at run start (D31). Kept on disk so a server restart
   * between `crew done` and the diff gate doesn't silently skip the out-of-worktree check.
   */
  private snapshotPath(runId: string): string {
    return path.join(this.crewHome, 'snapshots', `${runId}.txt`);
  }

  getMainCheckoutSnapshot(runId: string): string | undefined {
    try {
      return fs.readFileSync(this.snapshotPath(runId), 'utf8');
    } catch {
      return undefined;
    }
  }

  clearMainCheckoutSnapshot(runId: string): void {
    fs.rmSync(this.snapshotPath(runId), { force: true });
  }

  async startRun(options: StartRunOptions): Promise<ActiveRun> {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, options.taskId)).get();
    const phase = task?.kind === 'phase';
    if (!phase) {
      const agentId = options.agentId || task?.assigneeAgentId;
      const key = `${options.taskId}:${agentId}:${options.kind || 'work'}`;
      // A Reviewer may still be exiting when a different author starts a retry.
      const live = this.getLiveRuns().find(run => run.taskId === options.taskId && run.agentId === agentId && !run.exitReason);
      if (live) return live;
      const pending = this.startingWork.get(key);
      if (pending) return pending;
      const starting = this.startRunInner(options);
      this.startingWork.set(key, starting);
      try { return await starting; }
      finally { this.startingWork.delete(key); }
    }
    if (this.startingPhases.has(options.taskId) || this.getLiveRunByTaskId(options.taskId)) throw new Error('Phase already has a starting or live run.');
    this.startingPhases.add(options.taskId);
    try { return await this.startRunInner(options); }
    catch (error) {
      const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, options.taskId)).get();
      if (!options.isResume && task?.status === 'doing' && !this.isCancelling(task.id) && !fs.existsSync(path.join(this.crewHome, 'stopped'))) {
        await this.scheduler.transitionTask(task.id, 'doing', { incrementRetries: true, reason: 'Phase preparation failed', alongside: () => this.db.db.insert(schema.messages).values({ id: crypto.randomUUID(), taskId: task.id, type: 'feedback', body: `Phase preparation failed: ${error instanceof Error ? error.message : String(error)}`, createdAt: new Date() }).run() });
      }
      throw error;
    } finally { this.startingPhases.delete(options.taskId); }
  }

  private async startRunInner(options: StartRunOptions): Promise<ActiveRun> {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, options.taskId)).get();
    if (!task) throw new Error(`Task not found: ${options.taskId}`);

    const agentId = options.agentId || task.assigneeAgentId;
    if (!agentId) throw new Error(`Task ${options.taskId} has no assignee agent`);

    const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (agent.mode === 'pull') throw new Error('Pull agents must request crew next; they cannot be spawned.');

    const adapter = options.adapter || this.getAdapter(agent.cliType);
    if (!adapter) throw new Error(`No adapter registered for cliType: ${agent.cliType}`);

    const runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    const agentToken = this.getOrCreateAgentToken(agentId);

    // Workspace & work directory
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
    const workspace = board
      ? this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()
      : undefined;
    const { prompt: preparedPrompt, workDir, permissionProfile } = await this.prepareContext(options, task, agent);
    const prompt = preparedPrompt;
    const projectConfig = (workspace?.config || {}) as ProjectConfig;

    // Prepend crew shim to PATH
    const shimBinDir = ensureCrewShim(this.crewHome);

    // D6: Codex assigns its thread ID; Claude receives a Crew-generated UUID.
    let sessionId = options.sessionId || (agent.cliType === 'codex' ? undefined : crypto.randomUUID());

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
    childEnv.CREW_SESSION_ID = sessionId || '';
    childEnv.CREW_RUN_ID = runId;
    childEnv.CREW_HOME = this.crewHome;
    childEnv.CREW_CLI_PATH = path.join(findPackageRoot(), 'dist', 'cli.js');

    // Check if Stop hook is enabled (D36: off by default, enabled per workspace or role)
    const isStopHookEnabled = Boolean(
      (workspace?.config as any)?.stopHook ||
      (permissionProfile as PermissionProfile & { stopHook?: boolean }).stopHook
    );

    let settingsPath: string | undefined;
    if (isStopHookEnabled) {
      settingsPath = ensureClaudeSettings(this.crewHome);
    }

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
        settingsPath,
        stopHook: isStopHookEnabled,
      });
    } else {
      spawnConfig = adapter.buildSpawn({
        prompt,
        workDir,
        permissions: permissionProfile,
        taskId: task.id,
        serverUrl: this.serverUrl,
        agentToken,
        settingsPath,
        stopHook: isStopHookEnabled,
      });
    }

    sessionId = spawnConfig.env.CREW_SESSION_ID || sessionId;
    Object.assign(childEnv, spawnConfig.env);
    if (permissionProfile.conflictResolution) childEnv.GIT_EDITOR = 'true';

    // Ensure logs directory exists
    const logsDir = getCrewLogsDir();
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logPath = path.join(logsDir, `${runId}.jsonl`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });

    await this.snapshotCheckout(runId, workspace?.repoPath);

    if (task.kind === 'phase' && (this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()?.status !== 'doing' || this.isCancelling(task.id) || fs.existsSync(path.join(this.crewHome, 'stopped')))) {
      logStream.end();
      throw new Error('Phase stopped or cancelled before spawn.');
    }

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
        kind: options.kind || 'work',
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
      }, projectConfig.noOutputTimeoutMs ?? this.noOutputTimeoutMs);
    };

    // Max runtime timer
    activeRun.maxRuntimeTimer = this.clock.setTimeout(() => {
      this.handleTimeout(activeRun, 'timeout');
    }, projectConfig.maxRuntimeMs ?? this.maxRuntimeMs);

    resetNoOutputTimer();

    const parseOutput = adapter.createOutputParser?.() || adapter.parseOutput.bind(adapter);
    const publishEvents = (line: string) => {
      const events = parseOutput(line + '\n');
      activeRun.eventCount += events.length;
      for (const event of events) {
        if (event.sessionId && !activeRun.sessionId) {
          activeRun.sessionId = event.sessionId;
          this.db.db.update(schema.runs).set({ sessionId: event.sessionId }).where(eq(schema.runs.id, runId)).run();
        }
        this.eventBus.publishRunEvent(runId, event);
        if (adapter.isRateLimit(event)) this.handleRateLimit(activeRun, event);
      }
    };

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
          publishEvents(line);
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

        // Flush remaining buffer before retiring the run: a terminal error may
        // be the final JSON object without a newline.
        if (lineBuffer.trim()) {
          logStream.write(lineBuffer.trim() + '\n');
          publishEvents(lineBuffer.trim());
        }
        this.liveRuns.delete(runId);
        logStream.end();

        const endedAt = new Date();
        const exitCode = result.exitCode ?? (task.kind === 'phase' && result.failed ? 1 : 0);

        // Determine exitReason
        let exitReason: ExitReason = activeRun.exitReason || 'exited';
        const updatedTask = this.db.db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.id, task.id))
          .get();

        if (!activeRun.exitReason) {
          if (options.kind === 'review') {
            if (updatedTask?.status !== 'review') {
              exitReason = 'done';
            } else {
              exitReason = 'exited';
            }
          } else if (updatedTask?.status === 'verifying') {
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

        // Only a finished work run goes on to the diff gate, which needs its snapshot
        if (task.kind === 'phase' || options.kind === 'review' || exitReason !== 'done') {
          this.clearMainCheckoutSnapshot(runId);
        }

        // Handle retry if failed while doing (work runs only)
        if (
          options.kind !== 'review' &&
          (exitReason === 'timeout' || exitReason === 'no-output' || exitReason === 'exited') &&
          updatedTask?.status === 'doing'
        ) {
          try {
            await this.scheduler.transitionTask(task.id, 'doing', {
              reason: `Run ended with ${exitReason}`,
              incrementRetries: true,
              alongside: task.kind === 'phase' ? () => this.db.db.insert(schema.messages).values({ id: crypto.randomUUID(), taskId: task.id, type: 'feedback', body: `Phase run ended with ${exitReason}. Address the failure and submit phase output.`, createdAt: new Date() }).run() : undefined,
            });
          } catch {
            // e.g. already transitioned or escalated
          }
        }

        // Handle fallback if resume failed
        if (exitReason === 'resume-failed' && updatedTask?.status === 'doing') {
          try {
            this.startRun({
              taskId: task.id,
              agentId,
              fallback: true,
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

  /** D89: spawn and Pull use the same role, memory, phase and permission context. */
  private async prepareContext(options: StartRunOptions, task: typeof schema.tasks.$inferSelect, agent: typeof schema.agents.$inferSelect) {
    const role = this.db.db.select().from(schema.roles).where(eq(schema.roles.id, agent.roleId)).get();
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
    const workspace = board && this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get();
    const projectConfig = (workspace?.config || {}) as ProjectConfig;
    const configuredRole = projectConfig.roles?.[role?.name || ''];
    const workDir = task.worktreePath || workspace?.repoPath || process.cwd();
    const permissionProfile: PermissionProfile =
      options.kind === 'review'
        ? {
            mode: 'read-only',
            allowCommands: [],
            denyCommands: [],
          }
        : { ...((configuredRole?.permissionProfile || role?.permissionProfile) as PermissionProfile || { mode: 'standard' }) };

    if (options.kind !== 'review' && !['read-only', 'orchestrator'].includes(permissionProfile.mode || 'standard')) {
      permissionProfile.allowCommands = commandPrefixes([...(permissionProfile.allowCommands || []), ...(projectConfig.permissions?.allowCommands || [])]);
    }

    // Role configuration cannot grant this extra profile to ordinary tasks.
    permissionProfile.conflictResolution = options.kind !== 'review' && !!this.db.db.select().from(schema.mergeQueueItems)
      .where(eq(schema.mergeQueueItems.conflictTaskId, task.id)).get();

    if (task.kind === 'phase') permissionProfile.mode = 'orchestrator';
    permissionProfile.phaseOutputPath = task.kind === 'phase' && role?.name === 'orchestrator' ? path.join(workDir, PHASE_OUTPUT_FILE) : undefined;
    if (permissionProfile.phaseOutputPath && !fs.existsSync(permissionProfile.phaseOutputPath)) fs.writeFileSync(permissionProfile.phaseOutputPath, '# Phase output\n');

    let prompt = await buildPrompt(this.db, {
      task, agent, kind: options.kind, instructions: [options.prompt, ...(task.kind === 'phase' ? [`Phase: ${task.creationPhase}\n${PHASES[task.creationPhase || '']?.instructions || ''}\nWrite the output to ${path.join(workDir, PHASE_OUTPUT_FILE)}. Call crew phase done --output ${PHASE_OUTPUT_FILE}.`] : [])].filter(Boolean).join('\n\n'),
      fallback: options.fallback, reviewContext: options.reviewContext,
    });
    if (agent.cliType === 'codex') prompt += '\n\n' + codexPermissionInstructions(permissionProfile);
    return { prompt, workDir, permissionProfile };
  }

  private async snapshotCheckout(runId: string, repoPath?: string) {
    let snapshot = '';
    if (repoPath && fs.existsSync(repoPath)) {
      try { snapshot = (await execa('git', ['status', '--porcelain'], { cwd: repoPath, reject: false })).stdout || ''; } catch {}
    }
    fs.mkdirSync(path.dirname(this.snapshotPath(runId)), { recursive: true });
    fs.writeFileSync(this.snapshotPath(runId), snapshot, 'utf8');
  }

  now(): Date { return new Date(this.clock.now()); }

  getPullRuns() {
    return this.db.db.select({ run: schema.runs }).from(schema.runs).innerJoin(schema.agents, eq(schema.runs.agentId, schema.agents.id))
      .where(and(eq(schema.agents.mode, 'pull'), sql`${schema.runs.endedAt} IS NULL`, sql`${schema.runs.pid} IS NULL`)).all().map(row => row.run);
  }

  getActiveTaskRun(taskId: string) {
    return this.getLiveRunByTaskId(taskId) ?? this.getPullRuns().find(run => run.taskId === taskId);
  }

  async reviewContext(task: typeof schema.tasks.$inferSelect): Promise<ReviewContext> {
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get()!;
    const workspace = this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()!;
    const baseBranch = workspace.defaultBranch || 'main';
    const cwd = task.worktreePath || workspace.repoPath;
    const base = (await execa('git', ['-c', 'core.hooksPath=/dev/null', 'merge-base', baseBranch, 'HEAD'], { cwd, reject: false })).stdout.trim() || baseBranch;
    const diff = (await execa('git', ['-c', 'core.hooksPath=/dev/null', 'diff', `${base}...HEAD`], { cwd, reject: false })).stdout || '';
    const lastWork = this.db.db.select().from(schema.runs).where(and(eq(schema.runs.taskId, task.id), eq(schema.runs.kind, 'work'))).orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`)).get();
    const results = lastWork ? this.db.db.select().from(schema.verificationResults).where(eq(schema.verificationResults.runId, lastWork.id)).all().map(r => `- ${r.step}: ${r.passed ? 'passed' : 'failed'}`).join('\n') : '';
    return { diff, baseBranch, results };
  }

  /** No adapter, token rotation, child process, runtime timer or process kill for Pull. */
  async startPullRun(task: typeof schema.tasks.$inferSelect, agent: typeof schema.agents.$inferSelect) {
    const review = task.status === 'review';
    const options: StartRunOptions = { taskId: task.id, ...(review ? { kind: 'review', reviewContext: await this.reviewContext(task) } : {}) };
    const context = await this.prepareContext(options, task, agent);
    const assigned = (current: typeof task | undefined) => current?.status === (review ? 'review' : 'doing') && (review ? current.reviewerAgentId : current.assigneeAgentId) === agent.id;
    const current = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
    if (!assigned(current) || this.isCancelling(task.id) || fs.existsSync(path.join(this.crewHome, 'stopped'))) return undefined;
    const existing = this.getPullRuns().find(run => run.agentId === agent.id && run.taskId === task.id);
    if (existing) return { task: current, runId: existing.id, prompt: existing.prompt!, workDir: context.workDir, permissions: context.permissionProfile };
    const runId = crypto.randomUUID();
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get()!;
    const workspace = this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()!;
    await this.snapshotCheckout(runId, workspace.repoPath);
    // Snapshot awaits git: recheck interruption/assignment before publishing the run.
    const latest = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()!;
    if (!assigned(latest) || this.isCancelling(task.id) || fs.existsSync(path.join(this.crewHome, 'stopped'))) { this.clearMainCheckoutSnapshot(runId); return undefined; }
    const logsDir = path.join(this.crewHome, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const logPath = path.join(logsDir, `${runId}.jsonl`);
    fs.writeFileSync(logPath, '');
    this.db.db.insert(schema.runs).values({ id: runId, taskId: task.id, agentId: agent.id, adapter: agent.cliType, startedAt: this.now(), kind: options.kind || 'work', logPath, prompt: context.prompt }).run();
    this.db.db.update(schema.agents).set({ status: 'busy' }).where(eq(schema.agents.id, agent.id)).run();
    return { task: latest, runId, prompt: context.prompt, workDir: context.workDir, permissions: context.permissionProfile };
  }

  endPullRun(taskId: string, reason: ExitReason, agentId?: string) {
    for (const run of this.getPullRuns().filter(run => run.taskId === taskId && (!agentId || run.agentId === agentId))) {
      this.db.db.update(schema.runs).set({ endedAt: this.now(), exitReason: reason }).where(eq(schema.runs.id, run.id)).run();
      if (reason !== 'done' || run.kind === 'review') this.clearMainCheckoutSnapshot(run.id);
      this.db.db.update(schema.agents).set({ status: reason === 'stopped' ? 'stopped' : 'idle' }).where(eq(schema.agents.id, run.agentId)).run();
      this.emit('run_ended', { runId: run.id, taskId, agentId: run.agentId, exitReason: reason });
    }
  }

  reportPullProgress(taskId: string, message: string) {
    const run = this.getPullRuns().find(run => run.taskId === taskId);
    if (!run?.logPath) return;
    const event = { type: 'progress', data: { message }, timestamp: this.now().toISOString() };
    fs.appendFileSync(run.logPath, JSON.stringify(event) + '\n');
    this.eventBus.publishRunEvent(run.id, event);
  }

  async runTask(taskId: string, options: Partial<StartRunOptions> = {}): Promise<RunResult> {
    const handle = await this.startRun({ taskId, ...options });
    return await handle.promise;
  }

  setServerUrl(url: string): void {
    this.serverUrl = url;
  }

  async resumeTask(taskId: string, answer?: string): Promise<ActiveRun> {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const agentId = task.assigneeAgentId;
    if (!agentId) throw new Error(`Task ${taskId} has no assignee agent`);

    const agent = this.db.db.select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    if (agent.mode === 'pull') throw new Error('Pull answers are delivered by crew next.');

    const adapter = this.getAdapter(agent.cliType);
    if (!adapter) throw new Error(`No adapter registered for cliType: ${agent.cliType}`);

    const lastRun = this.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`))
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

    return await this.startRun({
      taskId: task.id,
      agentId,
      fallback: true,
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

  /**
   * Kill the live run of a task (if any) and wait until its exit has been recorded.
   * Used by cancel, so the agent is gone before its worktree is removed.
   */
  async killTaskRun(taskId: string, exitReason: ExitReason = 'cancelled'): Promise<boolean> {
    // Until the caller finishes the task transition, the task still looks like an orphaned
    // 'doing' task, so tell the dispatcher not to start it again.
    this.cancelling.add(taskId);
    this.endPullRun(taskId, exitReason);
    const run = this.getLiveRunByTaskId(taskId);
    if (!run) return false;
    await this.killRun(run.id, exitReason);
    await run.promise.catch(() => {});
    return true;
  }

  /** True while a cancel is killing this task's run and has not finished yet. */
  isCancelling(taskId: string): boolean {
    return this.cancelling.has(taskId);
  }

  endCancel(taskId: string): void {
    this.cancelling.delete(taskId);
  }

  async killAll(exitReason: ExitReason = 'stopped'): Promise<number> {
    for (const timer of this.rateLimitTimers.values()) {
      this.clock.clearTimeout(timer);
    }
    this.rateLimitTimers.clear();

    const pullRuns = this.getPullRuns();
    for (const run of pullRuns) this.endPullRun(run.taskId, exitReason);
    const runs = this.getLiveRuns();
    await Promise.all(runs.map((r) => this.killRun(r.id, exitReason)));
    await Promise.all(runs.map((r) => r.promise.catch(() => {})));
    return runs.length + pullRuns.length;
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
    if (!this.liveRuns.has(run.id) || run.exitReason === 'rate-limited') return;
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
