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
  private activeCommands = new Map<string, { pid?: number; abort: () => Promise<void> }>();
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
    this.stopped = false;

    // Subscribe to task_status_changed events
    this.unsubscribeBoard = this.eventBus.subscribeBoardEvents('*', (event) => {
      if (event.type === 'task_status_changed') {
        const data = event.data as { taskId?: string; to?: string };
        if (data?.taskId && (data?.to === 'verifying' || data?.to === 'review')) {
          this.enqueue(data.taskId);
        }
      }
    });

    // Recovery on restart (§4.6):
    // 1. Tasks currently in verifying
    const verifyingTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'verifying'))
      .all();

    for (const t of verifyingTasks) {
      this.enqueue(t.id);
    }

    // 2. Tasks currently in review with no live Reviewer run
    const reviewTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'review'))
      .all();

    for (const t of reviewTasks) {
      if (!this.runner.getLiveRunByTaskId(t.id)) {
        this.enqueue(t.id);
      }
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

  async cancelTask(taskId: string): Promise<void> {
    const cmd = this.activeCommands.get(taskId);
    if (cmd) {
      await cmd.abort();
      this.activeCommands.delete(taskId);
    }
    this.queue = this.queue.filter((id) => id !== taskId);
    this.activeTasks.delete(taskId);
  }

  async stopAll(): Promise<void> {
    this.stopped = true;
    for (const [taskId, cmd] of this.activeCommands.entries()) {
      await cmd.abort();
    }
    this.activeCommands.clear();
    this.queue = [];
    this.activeTasks.clear();
  }

  resume(): void {
    this.stopped = false;
    const verifyingTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'verifying'))
      .all();
    for (const t of verifyingTasks) {
      this.enqueue(t.id);
    }
    const reviewTasks = this.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.status, 'review'))
      .all();
    for (const t of reviewTasks) {
      if (!this.runner.getLiveRunByTaskId(t.id)) {
        this.enqueue(t.id);
      }
    }
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
    if (!task || (task.status !== 'verifying' && task.status !== 'review')) {
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

    const worktreePath = task.worktreePath || workspace?.repoPath || process.cwd();

    if (task.status === 'verifying') {
      // Results of a pipeline that never finished are replaced, not duplicated (§4.6)
      this.db.db
        .delete(schema.verificationResults)
        .where(eq(schema.verificationResults.runId, lastRun.id))
        .run();

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

      const cmdResult = await this.executeVerifyCommand(cmd, worktreePath, task.id);
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
    }

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

    // Select idle reviewer agent, preferring different cliType than author (D8)
    const author = task.assigneeAgentId
      ? this.db.db.select().from(schema.agents).where(eq(schema.agents.id, task.assigneeAgentId)).get()
      : null;

    const idleReviewers = reviewerAgents.filter((r) => r.agent.status === 'idle');
    let selected = author
      ? idleReviewers.find((r) => r.agent.cliType !== author.cliType)
      : null;
    if (!selected) {
      selected = idleReviewers[0] || reviewerAgents[0];
    }
    const reviewer = selected.agent;

    // Set tasks.reviewerAgentId
    this.db.db
      .update(schema.tasks)
      .set({ reviewerAgentId: reviewer.id })
      .where(eq(schema.tasks.id, task.id))
      .run();

    // Build Reviewer prompt (role prompt, title, description, criteria, git diff, earlier verification results)
    const reviewerRole = this.db.db
      .select()
      .from(schema.roles)
      .where(eq(schema.roles.id, reviewer.roleId))
      .get();

    let gitDiff = '';
    try {
      const baseBranch = workspace?.defaultBranch || 'main';
      const mergeBaseRes = await execa('git', ['merge-base', baseBranch, 'HEAD'], {
        cwd: worktreePath,
        reject: false,
      });
      const mergeBase = mergeBaseRes.stdout.trim() || baseBranch;
      const diffRes = await execa('git', ['diff', `${mergeBase}...HEAD`], {
        cwd: worktreePath,
        reject: false,
      });
      gitDiff = diffRes.stdout || '';
    } catch {}

    const vrs = this.db.db
      .select()
      .from(schema.verificationResults)
      .where(eq(schema.verificationResults.runId, lastRun.id))
      .all();
    const earlierResultsText = vrs.map((r) => `- ${r.step}: ${r.passed ? 'passed' : 'failed'}`).join('\n');

    const reviewerPrompt = [
      reviewerRole?.defaultPrompt || 'You are a code reviewer. Review the changes against the acceptance criteria.',
      reviewer.personality ? `Persona: ${reviewer.personality}` : '',
      `Task: ${task.title}`,
      task.description ? `Description: ${task.description}` : '',
      task.acceptanceCriteria ? `Acceptance Criteria: ${task.acceptanceCriteria}` : '',
      gitDiff ? `Git diff against ${workspace?.defaultBranch || 'main'}:\n\`\`\`diff\n${gitDiff}\n\`\`\`` : '',
      earlierResultsText ? `Earlier verification results:\n${earlierResultsText}` : '',
      'Review the changes against the acceptance criteria. When done, call crew review approve or crew review changes --feedback "<what to change>".',
    ]
      .filter(Boolean)
      .join('\n\n');

    // Reviewer run loop: up to 2 runs in total (D35)
    const MAX_REVIEW_RUNS = 2;
    let verdictRecorded = false;

    for (let attempt = 1; attempt <= MAX_REVIEW_RUNS; attempt++) {
      if (this.isStopped()) break;

      const currentTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
      if (!currentTask || currentTask.status !== 'review' || this.isStopped()) {
        verdictRecorded = currentTask ? currentTask.status !== 'review' : false;
        break;
      }

      this.db.db
        .update(schema.agents)
        .set({ status: 'busy' })
        .where(eq(schema.agents.id, reviewer.id))
        .run();

      const runResult = await this.runner.runTask(task.id, {
        agentId: reviewer.id,
        prompt: reviewerPrompt,
        kind: 'review',
      });

      const postRunTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
      if (!postRunTask || postRunTask.status !== 'review') {
        verdictRecorded = true;
        break;
      }

      // If rate limited, pause and don't count towards the 2-run allowance (D7, D35)
      if (runResult.exitReason === 'rate-limited') {
        attempt--;
        continue;
      }
    }

    // A Reviewer that ends without a verdict (D35): crash, timeout or silence after 2 runs -> escalate task
    const finalTask = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get();
    if (!verdictRecorded && finalTask && finalTask.status === 'review' && !this.isStopped()) {
      await this.scheduler.transitionTask(task.id, 'escalated', {
        reason: 'Reviewer ended without verdict after 2 attempts',
        alongside: () => {
          this.db.db
            .update(schema.tasks)
            .set({ reviewerAgentId: null })
            .where(eq(schema.tasks.id, task.id))
            .run();
          this.db.db
            .update(schema.agents)
            .set({ status: 'idle' })
            .where(eq(schema.agents.id, reviewer.id))
            .run();
        },
      });
    }
  }

  private async executeVerifyCommand(
    cmd: VerifyCommand,
    worktreePath: string,
    taskId?: string,
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

      if (taskId) {
        this.activeCommands.set(taskId, {
          pid: subprocess.pid,
          abort: async () => {
            if (subprocess.pid) {
              await killProcessGroup(subprocess.pid, 'SIGTERM', 1000);
            }
          },
        });
      }

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
    } finally {
      if (taskId) {
        this.activeCommands.delete(taskId);
      }
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
