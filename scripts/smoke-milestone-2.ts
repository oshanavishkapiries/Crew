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
import { WorktreeManager } from '../src/server/worktree/index.js';
import { startServer } from '../src/server/index.js';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';

async function runSmoke(): Promise<void> {
  console.log('====================================================');
  console.log('Crew Milestone 2 Smoke Run (Claude Code Integration)');
  console.log('====================================================\n');

  // 1. Detect Claude Code CLI
  const adapter = new ClaudeCodeAdapter({ maxBudgetUsd: 0.5 });
  const detection = await adapter.detect();
  if (!detection.installed) {
    console.error('Error: Claude Code CLI is not detected on this system.');
    console.error('Please ensure `claude` is installed and in your PATH.');
    process.exit(1);
  }
  console.log(`[smoke] Detected Claude Code CLI version: ${detection.version || 'unknown'}`);

  // 2. Setup temporary git repository
  const repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke-repo-'));
  console.log(`[smoke] Initializing throwaway git repository at ${repoDir}`);
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Crew Smoke Tester'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'smoke@crew.local'], { cwd: repoDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoDir, 'README.md'), '# Smoke Test Workspace\n', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: repoDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: repoDir, stdio: 'pipe' });

  // 3. Setup temporary crew home directory
  const crewHome = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-smoke-home-'));
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
    adapters: { 'claude-code': adapter },
    serverUrl: 'http://127.0.0.1:0',
    crewHome,
  });

  const dispatcher = new Dispatcher({
    db,
    scheduler,
    runner,
    eventBus,
    maxParallelAgents: 1,
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
    dispatcher,
    startDispatcher: false, // We will start dispatcher after seeding
  });
  console.log(`[smoke] Server started on ${server.url}`);

  // 5. Seed Workspace, Board, Role, and Claude Code Agent
  const now = new Date();
  const workspaceId = 'ws-smoke-1';
  const boardId = 'board-smoke-1';
  const roleId = 'role-developer';
  const agentId = 'agent-claude-smoke';
  const agentToken = 'crew_agent_smoke_' + crypto.randomBytes(16).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(agentToken).digest('hex');

  db.db
    .insert(schema.workspaces)
    .values({
      id: workspaceId,
      name: 'Smoke Workspace',
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
      name: 'Developer',
      defaultPrompt: 'You are a software developer assistant.',
      permissionProfile: { mode: 'full' },
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
      name: 'Claude Code Agent',
      cliType: 'claude-code',
      status: 'idle',
      tokenHash,
      createdAt: now,
    })
    .run();

  runner.registerAgentToken(agentId, agentToken);

  // 6. Create Task
  const taskId = 'task-smoke-1';
  await scheduler.createTask({
    id: taskId,
    boardId,
    title: 'Smoke Test: Create smoke.txt',
    description:
      'Please create a file named smoke.txt in the repository root containing the text "SUCCESS". Then complete the task using crew done.',
    roleId,
    assigneeAgentId: agentId,
  });

  console.log(`[smoke] Created task: ${taskId}`);
  console.log(`[smoke] Budget limit: $0.50 (safety capped)`);
  console.log(`[smoke] Starting dispatcher...\n`);

  dispatcher.start();

  // 7. Wait for task to reach verifying
  const timeoutMs = 180000; // 3 minutes max
  const startTime = Date.now();

  try {
    const finalTask = await new Promise<typeof schema.tasks.$inferSelect>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out after ${timeoutMs / 1000}s waiting for task ${taskId} to reach verifying`));
      }, timeoutMs);

      const checkInterval = setInterval(() => {
        const task = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
        if (task) {
          if (task.status === 'verifying') {
            clearInterval(checkInterval);
            clearTimeout(timer);
            resolve(task);
          } else if (task.status === 'escalated' || task.status === 'cancelled') {
            clearInterval(checkInterval);
            clearTimeout(timer);
            reject(new Error(`Task ended with status '${task.status}'`));
          } else {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`\r[smoke] Waiting for task completion... status: ${task.status} (${elapsed}s elapsed)`);
          }
        }
      }, 2000);
    });

    console.log(`\n\n[smoke] SUCCESS! Task reached status: '${finalTask.status}'`);

    // Check worktree changes
    if (finalTask.worktreePath && fs.existsSync(finalTask.worktreePath)) {
      const filePath = path.join(finalTask.worktreePath, 'smoke.txt');
      if (fs.existsSync(filePath)) {
        console.log(`[smoke] Verified smoke.txt content: "${fs.readFileSync(filePath, 'utf-8').trim()}"`);
      } else {
        console.log('[smoke] smoke.txt was not found at expected path');
      }

      const diffResult = await execa('git', ['diff', 'main'], { cwd: finalTask.worktreePath, reject: false });
      console.log('\n[smoke] Git diff in worktree:');
      console.log(diffResult.stdout || '(no diff)');
    }

    // The task reaches 'verifying' when the agent calls `crew done`, a moment before its process
    // exits and the run row is finalised. Wait for that so the summary below is complete.
    for (let i = 0; i < 30 && runner.getLiveRuns().length > 0; i++) {
      await new Promise((r) => setTimeout(r, 500));
    }

    // Inspect run record
    const run = db.db.select().from(schema.runs).where(eq(schema.runs.taskId, taskId)).get();
    if (run) {
      console.log(`\n[smoke] Run summary:`);
      console.log(`  - Run ID: ${run.id}`);
      console.log(`  - Exit Reason: ${run.exitReason}`);
      console.log(`  - Exit Code: ${run.exitCode}`);
      console.log(`  - Log File: ${run.logPath}`);
    }

    console.log('\n====================================================');
    console.log('Smoke run passed end-to-end!');
    console.log('====================================================');
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
    await server.close();
  }
}

runSmoke().catch((err) => {
  console.error('Fatal smoke test error:', err);
  process.exit(1);
});
