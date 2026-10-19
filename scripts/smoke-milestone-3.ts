import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ClaudeCodeAdapter } from '../src/adapters/claude-code.js';
import { createCrewDatabase } from '../src/server/db/index.js';
import * as schema from '../src/server/db/schema.js';
import { EventBus } from '../src/server/events/index.js';
import { Scheduler } from '../src/server/scheduler/index.js';
import { Runner } from '../src/server/runner/index.js';
import { Dispatcher } from '../src/server/scheduler/dispatcher.js';
import { Verifier } from '../src/server/verify/index.js';
import { WorktreeManager } from '../src/server/worktree/index.js';
import { startServer } from '../src/server/index.js';
import { eq, inArray, asc } from 'drizzle-orm';
import { execa } from 'execa';

async function runSmoke(): Promise<void> {
  console.log('========================================================');
  console.log('Crew Milestone 3 Smoke Run (Verification & Review Gate)');
  console.log('========================================================\n');

  // 1. Detect Claude Code CLI
  const authorAdapter = new ClaudeCodeAdapter({ maxBudgetUsd: 0.5 });
  const detection = await authorAdapter.detect();
  if (!detection.installed) {
    console.error('Error: Claude Code CLI is not detected on this system.');
    console.error('Please ensure `claude` is installed and in your PATH.');
    process.exit(1);
  }
  console.log(`[smoke] Detected Claude Code CLI version: ${detection.version || 'unknown'}`);

  // 2. Setup temporary git repository
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke3-repo-'));
  console.log(`[smoke] Initializing throwaway git repository at ${repoDir}`);
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Crew Smoke Tester'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'smoke@crew.local'], { cwd: repoDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Smoke Test Workspace (Milestone 3)\n', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: repoDir, stdio: 'pipe' });

  // 3. Setup temporary crew home directory
  const crewHome = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke3-home-'));
  console.log(`[smoke] Setting CREW_HOME to ${crewHome}`);
  process.env.CREW_HOME = crewHome;

  // 4. Initialize Database & Services
  const db = createCrewDatabase({ dbPath: path.join(crewHome, 'crew.db') });
  const eventBus = new EventBus();
  const worktreeManager = new WorktreeManager(db);
  const scheduler = new Scheduler(db, eventBus, { maxRetries: 3, worktreeManager });

  const runner = new Runner({
    db,
    eventBus,
    scheduler,
    adapters: { 'claude-code': authorAdapter },
    serverUrl: 'http://127.0.0.1:0',
    crewHome,
  });

  const verifier = new Verifier({
    db,
    eventBus,
    scheduler,
    runner,
    crewHome,
    maxParallelVerifications: 2,
  });
  verifier.start();

  const dispatcher = new Dispatcher({
    db,
    scheduler,
    runner,
    eventBus,
    maxParallelAgents: 2,
    crewHome,
  });

  const server = await startServer({
    port: 0,
    host: '127.0.0.1',
    db,
    eventBus,
    scheduler,
    worktreeManager,
    runner,
    verifier,
    dispatcher,
    startDispatcher: false, // We will start dispatcher after seeding
  });
  console.log(`[smoke] Server started on ${server.url}`);

  // 5. Seed Workspace with verifyCommands (D10, D29) and optional stopHook (D36)
  const now = new Date();
  const workspaceId = 'ws-smoke3-1';
  const boardId = 'board-smoke3-1';
  const authorRoleId = 'role-developer';
  const reviewerRoleId = 'role-reviewer';
  const authorAgentId = 'agent-author';
  const reviewerAgentId = 'agent-reviewer';

  const authorToken = 'crew_agent_author_' + crypto.randomBytes(16).toString('hex');
  const reviewerToken = 'crew_agent_reviewer_' + crypto.randomBytes(16).toString('hex');

  db.db
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      name: 'Smoke 3 Workspace',
      repoPath: repoDir,
      defaultBranch: 'main',
      config: {
        verifyCommands: [
          {
            name: 'smoke-file-check',
            command: 'test -f smoke.txt',
          },
        ],
        stopHook: true,
      },
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

  // Roles
  db.db
    .insert(schema.roles)
    .values([
      {
        id: authorRoleId,
        name: 'Developer',
        defaultPrompt: 'You are a software developer assistant.',
        permissionProfile: { mode: 'full', stopHook: true },
        isBuiltin: true,
        createdAt: now,
      },
      {
        id: reviewerRoleId,
        name: 'Reviewer',
        defaultPrompt: 'You are a code reviewer. Review the diff against criteria and approve or request changes.',
        permissionProfile: { mode: 'read-only' },
        isBuiltin: true,
        createdAt: now,
      },
    ])
    .run();

  // Author Agent
  db.db
    .insert(schema.agents)
    .values([
      {
        id: authorAgentId,
        workspaceId,
        roleId: authorRoleId,
        name: 'Claude Code Author',
        cliType: 'claude-code',
        status: 'idle',
        tokenHash: crypto.createHash('sha256').update(authorToken).digest('hex'),
        createdAt: now,
      },
      {
        id: reviewerAgentId,
        workspaceId,
        roleId: reviewerRoleId,
        name: 'Reviewer Agent',
        cliType: 'claude-code',
        status: 'idle',
        tokenHash: crypto.createHash('sha256').update(reviewerToken).digest('hex'),
        createdAt: now,
      },
    ])
    .run();

  runner.registerAgentToken(authorAgentId, authorToken);
  runner.registerAgentToken(reviewerAgentId, reviewerToken);

  // 6. Create Task
  const taskId = 'task-smoke3-1';
  await scheduler.createTask({
    id: taskId,
    boardId,
    title: 'Milestone 3 Smoke: Create smoke.txt and verify',
    description:
      'Please create a file named smoke.txt in the repository root containing the text "SUCCESS". Then complete the task using crew done.',
    acceptanceCriteria: 'A file named smoke.txt exists containing SUCCESS.',
    roleId: authorRoleId,
    assigneeAgentId: authorAgentId,
  });

  console.log(`[smoke] Created task: ${taskId}`);
  console.log(`[smoke] Configured verifyCommand: test -f smoke.txt`);
  console.log(`[smoke] Author agent: ${authorAgentId} [claude-code]`);
  console.log(`[smoke] Reviewer agent: ${reviewerAgentId} [claude-code]`);
  console.log(`[smoke] Starting dispatcher and verifier...\n`);

  dispatcher.start();

  // 7. Wait for task to reach merge-queue
  const timeoutMs = 240000; // 4 minutes max
  const startTime = Date.now();

  try {
    const finalTask = await new Promise<typeof schema.tasks.$inferSelect>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs / 1000}s waiting for task ${taskId} to reach merge-queue`));
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        const task = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
        if (task) {
          if (task.status === 'merge-queue') {
            clearInterval(checkInterval);
            clearTimeout(timer);
            resolve(task);
          } else if (task.status === 'escalated' || task.status === 'cancelled') {
            clearInterval(checkInterval);
            clearTimeout(timer);
            reject(new Error(`Task ended prematurely with status '${task.status}'`));
          } else {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`\r[smoke] Waiting for task completion... status: ${task.status} (${elapsed}s elapsed)`);
          }
        }
      }, 2000);
    });

    console.log(`\n\n[smoke] SUCCESS! Task reached terminal milestone status: '${finalTask.status}'`);

    // Verify verification results in DB
    const runs = db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).all();
    const runIds = runs.map((r) => r.id);
    const vrs =
      runIds.length > 0
        ? db.db
            .select()
            .from(schema.verificationResults)
            .where(inArray(schema.verificationResults.runId, runIds))
            .orderBy(asc(schema.verificationResults.createdAt))
            .all()
        : [];

    console.log(`\n[smoke] Verification Results (${vrs.length} steps):`);
    for (const vr of vrs) {
      console.log(`  - [${vr.passed ? 'PASS' : 'FAIL'}] Step: ${vr.step} (Output: ${vr.output?.trim().slice(0, 80) || ''})`);
    }

    // Check worktree file
    if (finalTask.worktreePath && fs.existsSync(finalTask.worktreePath)) {
      const filePath = path.join(finalTask.worktreePath, 'smoke.txt');
      if (fs.existsSync(filePath)) {
        console.log(`\n[smoke] Verified smoke.txt content: "${fs.readFileSync(filePath, 'utf-8').trim()}"`);
      }
      const diffResult = await execa('git', ['diff', 'main...HEAD'], { cwd: finalTask.worktreePath, reject: false });
      console.log('\n[smoke] Git diff in worktree:');
      console.log(diffResult.stdout || '(no diff)');
    }

    // Test CLI results command
    console.log('\n[smoke] Testing `crew results` CLI output:');
    const cliPath = path.join(process.cwd(), 'dist', 'cli.js');
    const resultsCli = await execa(process.execPath, [cliPath, 'results', taskId], {
      env: {
        CREW_SERVER_URL: server.url,
        CREW_SECRET: server.perStartSecret,
        CREW_HOME: crewHome,
      },
      reject: false,
    });
    console.log(resultsCli.stdout);

    console.log('\n========================================================');
    console.log('Milestone 3 Smoke Run passed end-to-end!');
    console.log('========================================================');
  } catch (err: any) {
    console.error(`\n\n[smoke] ERROR during smoke run: ${err.message}`);
    const runs = db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).all();
    for (const r of runs) {
      if (r.logPath && fs.existsSync(r.logPath)) {
        console.error(`\n--- Run log (${r.id}) ---`);
        console.error(fs.readFileSync(r.logPath, 'utf-8').slice(-2000));
      }
    }
    process.exitCode = 1;
  } finally {
    dispatcher.stop();
    verifier.stop();
    await server.close();
  }
}

runSmoke().catch((err) => {
  console.error('Fatal smoke test error:', err);
  process.exit(1);
});
