import * as fs from 'node:fs';
import * as path from 'node:path';
import { and, desc, eq } from 'drizzle-orm';
import { execa } from 'execa';
import picomatch from 'picomatch';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import { killProcessGroup, type Runner } from '../runner/index.js';
import type { Scheduler } from '../scheduler/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import { getCrewHome } from '../config.js';

export interface VerifyCommand {
  name: string;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  paths?: string[];
}

export interface VerifierOptions {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  worktreeManager?: WorktreeManager;
  runner: Runner;
  maxParallelVerifications?: number; // default 2 (D37)
  crewHome?: string;
}

export class Verifier {
  private db: CrewDatabase;
  private eventBus: EventBus;
  private scheduler: Scheduler;
  private worktreeManager?: WorktreeManager;
  private runner: Runner;
  public readonly maxParallelVerifications: number;
  private crewHome: string;

  private started = false;
  private stopped = false;
  private queue: string[] = [];
  private activeTasks = new Set<string>();
  private unsubscribeBoard?: () => void;

  constructor(options: VerifierOptions) {
    this.db = options.db;
    this.eventBus = options.eventBus;
    this.scheduler = options.scheduler;
    this.worktreeManager = options.worktreeManager;
    this.runner = options.runner;
    this.maxParallelVerifications = options.maxParallelVerifications ?? 2;
    this.crewHome = options.crewHome || getCrewHome();
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    // Subscribe to task_status_changed events
    this.unsubscribeBoard = this.eventBus.subscribeBoardEvents('*', (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as { taskId?: string; to?: string };
        if (data?.taskId && data?.to === 'verifying') {
          this.enqueue(data.taskId);
        }
      }
    });

    // Check for any tasks currently in verifying (recovery on restart, §4.6)
    const verifyingTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'verifying'))
      .all();

    for (const t of verifyingTasks) {
      this.enqueue(t.id);
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.stopped = true;

    if (this.unsubscribeBoard) {
      this.unsubscribeBoard();
      this.unsubscribeBoard = undefined;
    }
    this.queue = [];
  }

  isStopped(): boolean {
    if (this.stopped) return true;
    const stoppedFile = path.join(this.crewHome, 'stopped');
    return fs.existsSync(stoppedFile);
  }

  setStopped(stopped: boolean): void {
    this.stopped = stopped;
  }

  enqueue(taskId: string): void {
    if (this.activeTasks.has(taskId) || this.queue.includes(taskId)) {
      return;
    }
    this.queue.push(taskId);
    this.processQueue();
  }

  private processQueue(): void {
    if (this.isStopped()) return;

    while (this.activeTasks.size < this.maxParallelVerifications && this.queue.length > 0) {
      const taskId = this.queue.shift()!;
      this.activeTasks.add(taskId);
      this.runPipeline(taskId)
        .catch((err) => {
          if (!this.isStopped() && !err?.message?.includes('database connection is not open')) {
            console.error(`Verification pipeline error for task ${taskId}:`, err);
          }
        })
        .finally(() => {
          this.activeTasks.delete(taskId);
          this.processQueue();
        });
    }
  }

  private async runPipeline(taskId: string): Promise<void> {
    if (this.isStopped()) return;

    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task || task.status !== 'verifying') {
      return;
    }

    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
    const workspace = board
      ? this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()
      : undefined;
    const defaultBranch = workspace?.defaultBranch || 'main';

    // Find the latest work run for this task
    const lastRun =
      this.db.db
        .select()
        .from(schema.runs)
        .where(and(eq(schema.runs.taskId, taskId), eq(schema.runs.kind, 'work')))
        .orderBy(desc(schema.runs.startedAt))
        .get() ||
      this.db.db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.taskId, taskId))
        .orderBy(desc(schema.runs.startedAt))
        .get();

    if (!lastRun) {
      return;
    }

    // --- GATE 1: DIFF GATE ---
    const diffGateResult = await this.runDiffGate(task, lastRun.id, defaultBranch, workspace?.repoPath);

    if (this.isStopped()) return;

    // Record verification result
    const vrId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    this.db.db
      .insert(schema.verificationResults)
      .values({
        id: vrId,
        runId: lastRun.id,
        step: 'diff',
        passed: diffGateResult.passed,
        output: diffGateResult.output,
        createdAt: new Date(),
      })
      .run();

    if (this.isStopped()) return;

    // Emit verification_step event
    this.eventBus.publishBoardEvent(task.boardId, {
      type: 'verification_step',
      data: {
        taskId: task.id,
        step: 'diff',
        passed: diffGateResult.passed,
      },
    });

    if (!diffGateResult.passed) {
      if (this.isStopped()) return;

      // Check if task was cancelled or stopped while diff gate was running
      const freshTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!freshTask || freshTask.status !== 'verifying' || this.isStopped()) {
        return;
      }

      // Transition verifying -> doing with feedback message
      await this.scheduler.transitionTask(task.id, 'doing', {
        reason: diffGateResult.output,
        alongside: () => {
          this.db.db
            .insert(schema.messages)
            .values({
              id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              taskId: task.id,
              fromAgentId: null,
              type: 'feedback',
              body: diffGateResult.output,
              createdAt: new Date(),
            })
            .run();
        },
      });
      return;
    }

    // --- GATE 2: COMMAND GATES (D10, D29, D32, D37) ---
    const worktreePath = task.worktreePath;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      return;
    }

    let config = workspace?.config;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch {}
    }
    const verifyCommands: VerifyCommand[] = Array.isArray((config as any)?.verifyCommands)
      ? (config as any).verifyCommands
      : [];

    const changedFiles = diffGateResult.changedFiles || [];
    const applicableCommands: VerifyCommand[] = [];

    for (const cmd of verifyCommands) {
      if (!cmd.name || !cmd.command) continue;
      if (cmd.paths && cmd.paths.length > 0) {
        const isMatch = picomatch(cmd.paths);
        const matches = changedFiles.some((f) => isMatch(f));
        if (matches) {
          applicableCommands.push(cmd);
        }
      } else {
        applicableCommands.push(cmd);
      }
    }

    const commandResults: Array<{ name: string; passed: boolean; output: string }> = [];

    for (const cmd of applicableCommands) {
      if (this.isStopped()) return;

      const cmdResult = await this.executeVerifyCommand(cmd, worktreePath);
      commandResults.push(cmdResult);

      if (this.isStopped()) return;

      // Full output capped at 64 KB, keeping the end
      const cappedOutput =
        cmdResult.output.length > 65536 ? cmdResult.output.slice(-65536) : cmdResult.output;

      const vrId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      this.db.db
        .insert(schema.verificationResults)
        .values({
          id: vrId,
          runId: lastRun.id,
          step: cmd.name,
          passed: cmdResult.passed,
          output: cappedOutput,
          createdAt: new Date(),
        })
        .run();

      if (this.isStopped()) return;

      // Emit verification_step event
      this.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step',
        data: {
          taskId: task.id,
          step: cmd.name,
          passed: cmdResult.passed,
        },
      });
    }

    // Check if any command failed
    const failures = commandResults.filter((r) => !r.passed);
    if (failures.length > 0) {
      if (this.isStopped()) return;

      const freshTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!freshTask || freshTask.status !== 'verifying' || this.isStopped()) {
        return;
      }

      // Collect feedback from all failures, keeping last 4 KB of each
      const feedbackSections = failures.map((f) => {
        const trimmed = f.output.trim();
        const last4KB = trimmed.length > 4096 ? trimmed.slice(-4096) : trimmed;
        return `Verification command '${f.name}' failed:\n${last4KB}`;
      });
      const combinedFeedback = feedbackSections.join('\n\n');

      await this.scheduler.transitionTask(task.id, 'doing', {
        reason: `${failures.length} verify command(s) failed: ${failures.map((f) => f.name).join(', ')}`,
        alongside: () => {
          this.db.db
            .insert(schema.messages)
            .values({
              id: 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
              taskId: task.id,
              fromAgentId: null,
              type: 'feedback',
              body: combinedFeedback,
              createdAt: new Date(),
            })
            .run();
        },
      });
      return;
    }

    if (this.isStopped()) return;

    // Check task status before transitioning
    const currentTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!currentTask || currentTask.status !== 'verifying' || this.isStopped()) {
      return;
    }

    // Transition verifying -> review
    await this.scheduler.transitionTask(task.id, 'review', {
      reason: 'Diff and command gates passed',
    });

    if (this.isStopped()) return;

    // Check for a reviewer agent in the workspace (D8, D34)
    const reviewerAgents = workspace
      ? this.db.db
          .select({
            agent: schema.agents,
            role: schema.roles,
          })
          .from(schema.agents)
          .innerJoin(schema.roles, eq(schema.agents.roleId, schema.roles.id))
          .where(
            and(
              eq(schema.agents.workspaceId, workspace.id),
              eq(schema.roles.name, 'reviewer'),
            ),
          )
          .all()
      : [];

    if (reviewerAgents.length === 0) {
      // Review step is skipped (D34)
      const vrId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      this.db.db
        .insert(schema.verificationResults)
        .values({
          id: vrId,
          runId: lastRun.id,
          step: 'review',
          passed: true,
          output: 'skipped: no reviewer agent',
          createdAt: new Date(),
        })
        .run();

      if (this.isStopped()) return;

      this.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step',
        data: {
          taskId: task.id,
          step: 'review',
          passed: true,
        },
      });

      if (this.isStopped()) return;

      const freshTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!freshTask || freshTask.status !== 'review' || this.isStopped()) {
        return;
      }

      // Transition review -> merge-queue
      await this.scheduler.transitionTask(task.id, 'merge-queue', {
        reason: 'Review skipped: no reviewer agent',
      });
      return;
    }

    // Active reviewer execution will be added in bullet 4
  }

  private async executeVerifyCommand(
    cmd: VerifyCommand,
    worktreePath: string,
  ): Promise<{ name: string; passed: boolean; output: string }> {
    const commandCwd = cmd.cwd ? path.resolve(worktreePath, cmd.cwd) : worktreePath;
    if (!fs.existsSync(commandCwd)) {
      return {
        name: cmd.name,
        passed: false,
        output: `Working directory does not exist: ${cmd.cwd}`,
      };
    }

    const timeoutMs = cmd.timeoutMs ?? 10 * 60 * 1000; // 10 minutes default
    const env: Record<string, string> = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      LANG: process.env.LANG || 'en_US.UTF-8',
      LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
      CI: '1',
    };

    let timer: NodeJS.Timeout | undefined;

    try {
      const subprocess = execa(cmd.command, {
        shell: true,
        cwd: commandCwd,
        env,
        extendEnv: false,
        detached: true,
        reject: false,
      });

      const timeoutPromise = new Promise<{ timedOut: boolean }>((resolve) => {
        timer = setTimeout(async () => {
          if (subprocess.pid) {
            await killProcessGroup(subprocess.pid, 'SIGTERM', 1000);
          }
          resolve({ timedOut: true });
        }, timeoutMs);
      });

      const outcome = await Promise.race([
        subprocess.then((res) => ({ res, timedOut: false })),
        timeoutPromise,
      ]);

      if (timer) {
        clearTimeout(timer);
      }

      if (outcome.timedOut) {
        try {
          await subprocess;
        } catch {}
        return {
          name: cmd.name,
          passed: false,
          output: `Command '${cmd.name}' timed out after ${timeoutMs / 1000}s`,
        };
      }

      const res = (outcome as any).res;
      const stdout = (res?.stdout || '').trim();
      const stderr = (res?.stderr || '').trim();
      const fullOutput = [stdout, stderr].filter(Boolean).join('\n');
      const passed = res?.exitCode === 0;

      return {
        name: cmd.name,
        passed,
        output: fullOutput || (passed ? 'Command passed' : `Command failed with exit code ${res?.exitCode}`),
      };
    } catch (err: any) {
      if (timer) clearTimeout(timer);
      return {
        name: cmd.name,
        passed: false,
        output: `Command execution error: ${err.message}`,
      };
    }
  }

  private async runDiffGate(
    task: typeof schema.tasks.$inferSelect,
    runId: string,
    defaultBranch: string,
    mainRepoPath?: string,
  ): Promise<{ passed: boolean; output: string; changedFiles: string[] }> {
    const worktreePath = task.worktreePath;
    if (!worktreePath || !fs.existsSync(worktreePath)) {
      return { passed: false, output: 'No worktree exists for task', changedFiles: [] };
    }

    // 1. Commit what the agent left behind (D30)
    try {
      const statusRes = await execa('git', ['status', '--porcelain'], { cwd: worktreePath, reject: false });
      if (statusRes.stdout && statusRes.stdout.trim() !== '') {
        await execa('git', ['add', '-A'], { cwd: worktreePath, reject: false });
        await execa(
          'git',
          [
            '-c',
            'user.name=Crew Verifier',
            '-c',
            'user.email=verifier@crew.local',
            'commit',
            '-m',
            task.title || 'Auto-commit task changes',
            '--allow-empty-message',
          ],
          { cwd: worktreePath, reject: false },
        );
      }
    } catch (err: any) {
      return { passed: false, output: `Failed to commit worktree changes: ${err.message}`, changedFiles: [] };
    }

    // 2. Empty diff check against merge-base
    let changedFiles: string[] = [];
    try {
      const mbRes = await execa('git', ['merge-base', defaultBranch, 'HEAD'], { cwd: worktreePath, reject: false });
      const mergeBase = mbRes.stdout.trim() || defaultBranch;

      const diffFilesRes = await execa('git', ['diff', '--name-only', `${mergeBase}..HEAD`], {
        cwd: worktreePath,
        reject: false,
      });
      changedFiles = diffFilesRes.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);

      if (changedFiles.length === 0) {
        return { passed: false, output: `no changes against ${defaultBranch}`, changedFiles: [] };
      }
    } catch (err: any) {
      return { passed: false, output: `Failed to diff worktree against ${defaultBranch}: ${err.message}`, changedFiles: [] };
    }

    // 3. Out-of-worktree check (D31)
    // 3a. Symlink check
    for (const file of changedFiles) {
      const fullPath = path.join(worktreePath, file);
      try {
        const lstat = fs.lstatSync(fullPath);
        if (lstat.isSymbolicLink()) {
          const target = fs.realpathSync(fullPath);
          const rel = path.relative(worktreePath, target);
          if (rel.startsWith('..') || path.isAbsolute(rel)) {
            return {
              passed: false,
              output: `Symlink '${file}' points outside worktree: ${target}`,
              changedFiles,
            };
          }
        }
      } catch {
        // file might be deleted in git diff
      }
    }

    // 3b. Main checkout snapshot comparison
    if (mainRepoPath && fs.existsSync(mainRepoPath)) {
      const startSnapshot = this.runner.getMainCheckoutSnapshot(runId);
      if (startSnapshot !== undefined) {
        try {
          const currRes = await execa('git', ['status', '--porcelain'], { cwd: mainRepoPath, reject: false });
          const currLines = currRes.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
          const startLines = new Set(startSnapshot.split('\n').map((l) => l.trim()).filter(Boolean));
          const newEntries = currLines.filter((l) => !startLines.has(l));

          if (newEntries.length > 0) {
            return {
              passed: false,
              output: `Out-of-worktree changes detected in main checkout: ${newEntries.join(', ')} (Note: this can false-positive if the main checkout was edited externally while the agent was running)`,
              changedFiles,
            };
          }
        } catch {
          // ignore git status error on main checkout
        }
      }
    }

    return { passed: true, output: `Diff gate passed (${changedFiles.length} files changed)`, changedFiles };
  }
}
