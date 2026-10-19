import { execSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { FakeAdapter, type FakeScriptStep } from '../../src/adapters/fake.js';
import { ensureCrewHome } from '../../src/server/config.js';
import { createCrewDatabase, type CrewDatabase } from '../../src/server/db/index.js';
import * as schema from '../../src/server/db/schema.js';
import { EventBus } from '../../src/server/events/index.js';
import { startServer, type RunningServer } from '../../src/server/index.js';
import { Scheduler, Dispatcher } from '../../src/server/scheduler/index.js';
import { WorktreeManager } from '../../src/server/worktree/index.js';
import { Runner, type Clock } from '../../src/server/runner/index.js';
import type { Verifier, VerifyCommand } from '../../src/server/verify/index.js';

export interface HarnessOptions {
  maxRetries?: number;
  maxRuntimeMs?: number;
  noOutputTimeoutMs?: number;
  clock?: Clock;
  maxParallelAgents?: number;
  startDispatcher?: boolean;
  startVerifier?: boolean;
  adapters?: Record<string, any>;
}

export interface PipelineHarness {
  server: RunningServer;
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  worktreeManager: WorktreeManager;
  runner: Runner;
  dispatcher: Dispatcher;
  verifier: Verifier;
  fakeAdapter: FakeAdapter;
  workspaceId: string;
  boardId: string;
  roleId: string;
  agentId: string;
  agentToken: string;
  repoDir: string;
  crewHomeDir: string;
  createTask: (params: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    roleId?: string;
    assigneeAgentId?: string;
    blockedByIds?: string[];
  }) => Promise<typeof schema.tasks.$inferSelect>;
  runTaskWithAgent: (
    taskId: string,
    script: FakeScriptStep[],
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string; exitReason?: schema.ExitReason }>;
  /** Run the real crew CLI with extra env vars (e.g. a specific agent's token) */
  runCrew: (
    args: string[],
    env?: Record<string, string>,
    execaOptions?: Record<string, any>,
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  /** Seed another agent in the workspace and return its token */
  addAgent: (id: string, customRoleId?: string, cliType?: string) => string;
  /** Add a role to the workspace */
  addRole: (id: string, name: string, permissionProfile?: any, defaultPrompt?: string) => string;
  waitForTaskStatus: (taskId: string, targetStatus: string, timeoutMs?: number) => Promise<typeof schema.tasks.$inferSelect>;
  waitForTasksStatus: (taskIds: string[], targetStatus: string, timeoutMs?: number) => Promise<void>;
  waitForLiveRuns: (expected?: number, timeoutMs?: number) => Promise<void>;
  waitForVerificationStep: (taskId: string, step: string, timeoutMs?: number) => Promise<any>;
  getTask: (taskId: string) => typeof schema.tasks.$inferSelect | undefined;
  getMessages: (taskId: string) => (typeof schema.messages.$inferSelect)[];
  getVerificationResults: (taskId?: string) => (typeof schema.verificationResults.$inferSelect)[];
  setVerifyCommands: (commands: VerifyCommand[]) => void;
  cleanup: () => Promise<void>;
}

export async function createPipelineHarness(
  options: HarnessOptions = {},
): Promise<PipelineHarness> {
  const originalCrewHome = process.env.CREW_HOME;

  // 1. Setup temp git repository
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-harness-repo-'));
  execSync('git init -b main', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Crew Test Runner"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@crew.local"', { cwd: repoDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test Repo\n', 'utf-8');
  execSync('git add . && git commit -m "initial commit"', { cwd: repoDir, stdio: 'pipe' });

  // 2. Setup temp crew home
  const crewHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-harness-home-'));
  process.env.CREW_HOME = crewHomeDir;
  ensureCrewHome();

  // 3. Database, event bus, scheduler, worktree manager
  const db = createCrewDatabase({ dbPath: path.join(crewHomeDir, 'crew.db') });
  const eventBus = new EventBus();
  const worktreeManager = new WorktreeManager(db);
  const scheduler = new Scheduler(db, eventBus, {
    maxRetries: options.maxRetries ?? 3,
    worktreeManager,
  });

  const fakeAdapter = new FakeAdapter();
  const cliPath = path.resolve(import.meta.dirname, '../../dist/cli.js');

  const runner = new Runner({
    db,
    eventBus,
    scheduler,
    adapters: { fake: fakeAdapter, codex: fakeAdapter, ...options.adapters },
    clock: options.clock,
    maxRuntimeMs: options.maxRuntimeMs,
    noOutputTimeoutMs: options.noOutputTimeoutMs,
    serverUrl: 'http://127.0.0.1:0',
    crewHome: crewHomeDir,
  });

  const dispatcher = new Dispatcher({
    db,
    scheduler,
    runner,
    eventBus,
    maxParallelAgents: options.maxParallelAgents ?? 3,
    crewHome: crewHomeDir,
  });

  // 4. Start real server on ephemeral port
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    db,
    eventBus,
    scheduler,
    worktreeManager,
    runner,
    dispatcher,
    startDispatcher: options.startDispatcher,
    startVerifier: options.startVerifier,
  });

  const now = new Date();
  const workspaceId = 'ws-harness-1';
  const boardId = 'board-harness-1';
  const roleId = 'role-backend';
  const agentId = 'agent-fake-1';
  const agentToken = 'crew_agent_test_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(agentToken).digest('hex');

  // 5. Seed DB entities
  db.db
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      name: 'Harness Workspace',
      repoPath: repoDir,
      defaultBranch: 'main',
      createdAt: now,
    })
    .run();

  db.db
    .insert(schema.boards)
    .values({
      id: boardId,
      workspaceId,
      currentPhase: 'dispatch',
      createdAt: now,
    })
    .run();

  db.db
    .insert(schema.roles)
    .values({
      id: roleId,
      name: 'backend',
      defaultPrompt: 'You are a backend test agent.',
      permissionProfile: { allowBash: true },
      isBuiltin: true,
      createdAt: now,
    })
    .run();

  db.db
    .insert(schema.agents)
    .values({
      id: agentId,
      workspaceId,
      roleId,
      name: 'Fake Backend Agent',
      cliType: 'fake',
      tokenHash,
      createdAt: now,
    })
    .run();

  runner.registerAgentToken(agentId, agentToken);

  const createTask = async (params: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    roleId?: string;
    assigneeAgentId?: string;
    blockedByIds?: string[];
  }) => {
    return scheduler.createTask({
      id: params.id,
      boardId,
      title: params.title,
      description: params.description,
      acceptanceCriteria: params.acceptanceCriteria,
      roleId: params.roleId !== undefined ? params.roleId : roleId,
      assigneeAgentId: 'assigneeAgentId' in params ? params.assigneeAgentId : agentId,
      blockedByIds: params.blockedByIds,
    });
  };

  const runTaskWithAgent = async (taskId: string, script: FakeScriptStep[]) => {
    fakeAdapter.setScript(script);

    // Transition task to doing (creates worktree and branch if not already doing)
    const currentTask = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()!;
    if (currentTask.status === 'ready') {
      await scheduler.transitionTask(taskId, 'doing', { reason: 'Agent spawned' });
    }

    const result = await runner.runTask(taskId);

    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout,
      stderr: '',
      exitReason: result.exitReason,
    };
  };

  const runCrew = async (
    args: string[],
    env: Record<string, string> = {},
    execaOptions: Record<string, any> = {},
  ) => {
    const result = await execa(process.execPath, [cliPath, ...args], {
      cwd: repoDir,
      env: {
        CREW_SERVER_URL: server.url,
        CREW_HOME: crewHomeDir,
        CREW_SECRET: server.perStartSecret,
        PATH: process.env.PATH || '',
        ...env,
      },
      extendEnv: false,
      reject: false,
      ...execaOptions,
    });
    return { exitCode: result.exitCode ?? null, stdout: result.stdout, stderr: result.stderr };
  };

  const addAgent = (id: string, customRoleId?: string, cliType = 'fake') => {
    const token = 'crew_agent_test_' + crypto.randomBytes(16).toString('hex');
    db.db
      .insert(schema.agents)
      .values({
        id,
        workspaceId,
        roleId: customRoleId || roleId,
        name: `Fake Agent ${id}`,
        cliType,
        status: 'idle',
        tokenHash: crypto.createHash('sha256').update(token).digest('hex'),
        createdAt: new Date(),
      })
      .run();
    runner.registerAgentToken(id, token);
    return token;
  };

  const addRole = (id: string, name: string, permissionProfile?: any, defaultPrompt?: string) => {
    db.db
      .insert(schema.roles)
      .values({
        id,
        name,
        defaultPrompt: defaultPrompt || `You are a ${name} agent.`,
        permissionProfile: permissionProfile || { mode: name === 'reviewer' ? 'read-only' : 'standard' },
        isBuiltin: false,
        createdAt: new Date(),
      })
      .run();
    return id;
  };

  const getTask = (taskId: string) => {
    return db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  };

  const waitForTaskStatus = async (
    taskId: string,
    targetStatus: string,
    timeoutMs = 10000,
  ): Promise<typeof schema.tasks.$inferSelect> => {
    const current = getTask(taskId);
    if (current && current.status === targetStatus) {
      return current;
    }

    return new Promise<typeof schema.tasks.$inferSelect>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        const latest = getTask(taskId);
        reject(
          new Error(
            `Timed out waiting for task ${taskId} to reach ${targetStatus} (current: ${latest?.status})`,
          ),
        );
      }, timeoutMs);

      const unsubscribe = eventBus.subscribeBoardEvents('*', (event) => {
        if (event.type === 'task_status_changed') {
          const data = event.data as { taskId: string; to: string };
          if (data && data.taskId === taskId && data.to === targetStatus) {
            clearTimeout(timer);
            unsubscribe();
            resolve(getTask(taskId)!);
          }
        }
      });
    });
  };

  const waitForTasksStatus = async (
    taskIds: string[],
    targetStatus: string,
    timeoutMs = 15000,
  ): Promise<void> => {
    await Promise.all(taskIds.map((id) => waitForTaskStatus(id, targetStatus, timeoutMs)));
  };

  const waitForLiveRuns = async (expected = 0, timeoutMs = 10000): Promise<void> => {
    if (runner.getLiveRuns().length === expected) return;
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        runner.off('run_ended', check);
        runner.off('run_started', check);
        reject(
          new Error(
            `Timed out waiting for live runs to reach ${expected} (current: ${runner.getLiveRuns().length})`,
          ),
        );
      }, timeoutMs);

      const check = () => {
        if (runner.getLiveRuns().length === expected) {
          clearTimeout(timer);
          runner.off('run_ended', check);
          runner.off('run_started', check);
          resolve();
        }
      };

      runner.on('run_ended', check);
      runner.on('run_started', check);
    });
  };

  const getMessages = (taskId: string) => {
    return db.db.select().from(schema.messages).where(eq(schema.messages.taskId, taskId)).all();
  };

  const getVerificationResults = (taskId?: string) => {
    if (!taskId) {
      return db.db.select().from(schema.verificationResults).all();
    }
    const taskRuns = db.db.select({ id: schema.runs.id }).from(schema.runs).where(eq(schema.runs.taskId, taskId)).all();
    const runIds = new Set(taskRuns.map((r) => r.id));
    return db.db.select().from(schema.verificationResults).all().filter((vr) => runIds.has(vr.runId));
  };

  const waitForVerificationStep = async (taskId: string, step: string, timeoutMs = 15000): Promise<any> => {
    const existing = getVerificationResults(taskId).find((vr) => vr.step === step);
    if (existing) {
      return { taskId, step: existing.step, passed: existing.passed };
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsub();
        const fallback = getVerificationResults(taskId).find((vr) => vr.step === step);
        if (fallback) {
          resolve({ taskId, step: fallback.step, passed: fallback.passed });
        } else {
          reject(new Error(`Timed out waiting for verification step ${step} on task ${taskId}`));
        }
      }, timeoutMs);

      const unsub = eventBus.subscribeBoardEvents(boardId, (event) => {
        if (event.type === 'verification_step') {
          const data = event.data as { taskId?: string; step?: string; passed?: boolean };
          if (data?.taskId === taskId && data?.step === step) {
            clearTimeout(timer);
            unsub();
            resolve(data);
          }
        }
      });
    });
  };

  const setVerifyCommands = (commands: VerifyCommand[]) => {
    db.db
      .update(schema.workspaces)
      .set({
        config: { verifyCommands: commands },
      })
      .where(eq(schema.workspaces.id, workspaceId))
      .run();
  };

  const cleanup = async () => {
    dispatcher.stop();
    server.verifier.stop();
    await runner.killAll();
    // Tests may have closed the server already (e.g. the server.json lifecycle test)
    await server.close().catch(() => {});
    db.close();

    if (originalCrewHome !== undefined) {
      process.env.CREW_HOME = originalCrewHome;
    } else {
      delete process.env.CREW_HOME;
    }

    if (fs.existsSync(repoDir)) {
      fs.rmSync(repoDir, { recursive: true, force: true });
    }
    if (fs.existsSync(crewHomeDir)) {
      fs.rmSync(crewHomeDir, { recursive: true, force: true });
    }
  };

  return {
    server,
    db,
    eventBus,
    scheduler,
    worktreeManager,
    runner,
    dispatcher,
    verifier: server.verifier,
    fakeAdapter,
    workspaceId,
    boardId,
    roleId,
    agentId,
    agentToken,
    repoDir,
    crewHomeDir,
    createTask,
    runTaskWithAgent,
    runCrew,
    addAgent,
    addRole,
    waitForTaskStatus,
    waitForTasksStatus,
    waitForLiveRuns,
    waitForVerificationStep,
    getTask,
    getMessages,
    getVerificationResults,
    setVerifyCommands,
    cleanup,
  };
}
