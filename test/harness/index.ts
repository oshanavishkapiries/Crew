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
import { Scheduler } from '../../src/server/scheduler/index.js';

export interface HarnessOptions {
  maxRetries?: number;
}

export interface PipelineHarness {
  server: RunningServer;
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
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
    blockedByIds?: string[];
  }) => Promise<typeof schema.tasks.$inferSelect>;
  runTaskWithAgent: (
    taskId: string,
    script: FakeScriptStep[],
  ) => Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
  getTask: (taskId: string) => typeof schema.tasks.$inferSelect | undefined;
  getMessages: (taskId: string) => (typeof schema.messages.$inferSelect)[];
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

  // 3. Database, event bus, scheduler
  const db = createCrewDatabase({ dbPath: path.join(crewHomeDir, 'crew.db') });
  const eventBus = new EventBus();
  const scheduler = new Scheduler(db, eventBus, { maxRetries: options.maxRetries ?? 3 });

  // 4. Start real server on ephemeral port
  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    db,
    eventBus,
    scheduler,
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

  const fakeAdapter = new FakeAdapter();
  const cliPath = path.resolve(__dirname, '../../dist/cli.js');

  const createTask = async (params: {
    id: string;
    title: string;
    description: string;
    acceptanceCriteria?: string;
    blockedByIds?: string[];
  }) => {
    return scheduler.createTask({
      id: params.id,
      boardId,
      title: params.title,
      description: params.description,
      acceptanceCriteria: params.acceptanceCriteria,
      roleId,
      assigneeAgentId: agentId,
      blockedByIds: params.blockedByIds,
    });
  };

  const runTaskWithAgent = async (taskId: string, script: FakeScriptStep[]) => {
    fakeAdapter.setScript(script);

    // Transition task to doing
    await scheduler.transitionTask(taskId, 'doing', { reason: 'Agent spawned' });

    const spawnConfig = fakeAdapter.buildSpawn({
      prompt: 'Work on ' + taskId,
      workDir: repoDir,
      permissions: { allowBash: true },
      taskId,
      serverUrl: server.url,
      agentToken,
    });

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...spawnConfig.env,
      CREW_CLI_PATH: cliPath,
      CREW_SERVER_URL: server.url,
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: agentToken,
    };

    const runId = 'run-' + Date.now();
    db.db
      .insert(schema.runs)
      .values({
        id: runId,
        taskId,
        agentId,
        adapter: 'fake',
        startedAt: new Date(),
      })
      .run();

    const subprocess = execa(spawnConfig.command, spawnConfig.args, {
      cwd: repoDir,
      env,
      reject: false,
    });

    const result = await subprocess;

    db.db
      .update(schema.runs)
      .set({
        endedAt: new Date(),
        exitCode: result.exitCode ?? 0,
      })
      .where(eq(schema.runs.id, runId))
      .run();

    return {
      exitCode: result.exitCode ?? null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  };

  const getTask = (taskId: string) => {
    return db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
  };

  const getMessages = (taskId: string) => {
    return db.db.select().from(schema.messages).where(eq(schema.messages.taskId, taskId)).all();
  };

  const cleanup = async () => {
    await server.close();
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
    getTask,
    getMessages,
    cleanup,
  };
}
