import * as fs from 'node:fs';
import * as path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { sql, and, desc, eq } from 'drizzle-orm';
import { execa, type ResultPromise } from 'execa';
import picomatch from 'picomatch';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import type { Scheduler, Task } from '../scheduler/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import { getCrewHome } from '../config.js';
import { killProcessGroup } from '../runner/index.js';
import { CommandRunner, type VerifyCommand } from '../verify/command-runner.js';

class MergeInterrupted extends Error {}
interface Job { taskId: string; interrupted: boolean; processes: Set<ResultPromise>; checkout?: { commitSha: string; workspace: Workspace }; }
interface CheckoutLock { index: string; lock: string; temporary: string; inode: number; commitSha: string; writeCheckout?: boolean; old?: string; indexPublished?: boolean; }
type Item = typeof schema.mergeQueueItems.$inferSelect;
type Workspace = typeof schema.workspaces.$inferSelect;
export interface MergeHooks {
  beforeCheckoutWrite?: (task: Task) => Promise<void>;
  beforeCheckoutMerge?: (task: Task) => Promise<void>;
  beforeRefUpdate?: (task: Task, commitSha: string) => Promise<void>;
}
export interface MergeQueueOptions {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  worktreeManager: WorktreeManager;
  crewHome?: string;
}

/** One serial lane per workspace; task status is always written by the Scheduler. */
export class MergeQueue {
  private readonly home: string;
  private started = false;
  private paused = false;
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private active = new Map<string, Promise<void>>();
  private commands = new CommandRunner();
  private jobs = new Map<string, Job>();
  private context = new AsyncLocalStorage<Job>();
  private cancelling = new Set<string>();
  private recovery?: Promise<void>;
  readonly warnings = new Map<string, string>();
  readonly hooks: MergeHooks = {};

  constructor(private options: MergeQueueOptions) {
    this.home = options.crewHome ?? getCrewHome();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribe = this.options.eventBus.subscribeBoardEvents('*', e => {
      if (e.type === 'task_status_changed') {
        const data = e.data as { taskId: string; to: string };
        if (data.to === 'merge-queue') {
          // Only a new pipeline approval can reopen a failed attempt; safety ticks cannot retry it.
          const item = this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, data.taskId)).get();
          const task = this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, data.taskId)).get();
          if (item?.status === 'failed' && task) {
            const position = Math.max(0, ...this.options.db.db.select().from(schema.mergeQueueItems).all().map(i => i.position)) + 1;
            this.change(item, task, { status: 'queued', position, commitSha: null, output: null });
          }
        }
        this.reconcileParent(data.taskId, data.to).catch(error => console.error('Conflict parent transition failed:', error));
        this.tick();
      }
    });
    this.recovery = Promise.resolve().then(() => this.recover()).catch(error => console.error('Merge recovery failed:', error)).finally(() => {
      this.recovery = undefined;
      this.tick();
    });
    this.timer = setInterval(() => this.tick(), 5000);
    this.timer.unref();
    this.tick();
  }

  async stop(): Promise<void> {
    this.started = false;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    if (this.timer) clearInterval(this.timer);
    await this.interruptAll();
    await this.recovery;
    await Promise.all(this.active.values());
  }

  async stopAll(): Promise<void> {
    this.paused = true;
    await this.interruptAll();
    await this.recovery;
    await Promise.all(this.active.values());
  }

  resume(): void { this.paused = false; this.tick(); }

  async cancelTask(taskId: string): Promise<void> {
    this.cancelling.add(taskId);
    await this.recovery;
    const job = [...this.jobs.values()].find(j => j.taskId === taskId);
    if (job) {
      job.interrupted = true;
      await this.interrupt(job);
      const workspace = this.options.worktreeManager.getWorkspaceForBoard(
        this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()!.boardId);
      await this.active.get(workspace.id);
    }
  }

  endCancel(taskId: string): void { this.cancelling.delete(taskId); }

  private async interrupt(job: Job): Promise<void> {
    // A checkout write already in progress finishes its index/ref transaction.
    // Once the ref landed, only bookkeeping may remain and it is safe to kill.
    const checkoutWriting = job.checkout && !await this.landed({ commitSha: job.checkout.commitSha } as Item, job.checkout.workspace);
    await Promise.all([
      this.commands.cancel(job.taskId),
      this.options.worktreeManager.cancelSetup(`merge:${job.taskId}`),
      ...[...job.processes].map(async p => {
        if (p.pid && !checkoutWriting) await killProcessGroup(p.pid, 'SIGTERM', 1000);
        await p.catch(() => {});
      }),
    ]);
  }

  private async interruptAll(): Promise<void> {
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.interrupted = true;
    await Promise.all(jobs.map(job => this.interrupt(job)));
    await this.commands.stopAll();
  }
  private isStopped(): boolean {
    return !this.started || this.paused || fs.existsSync(path.join(this.home, 'stopped'));
  }

  tick(): void {
    if (this.isStopped() || this.recovery) return;
    const { db } = this.options;
    const waiting = db.db.select().from(schema.tasks).where(eq(schema.tasks.status, 'merge-queue')).all();
    for (const task of waiting) {
      const existing = db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, task.id)).all();
      if (existing.length || this.cancelling.has(task.id)) continue;
      const position = Math.max(0, ...db.db.select().from(schema.mergeQueueItems).all().map(i => i.position)) + 1;
      const item = { id: randomUUID(), taskId: task.id, position, status: 'queued', createdAt: new Date() };
      db.db.insert(schema.mergeQueueItems).values(item).run();
      this.emit(task, db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
    }
    for (const workspace of db.db.select().from(schema.workspaces).all()) {
      if (this.active.has(workspace.id)) continue;
      const job = this.drain(workspace).catch(error => {
        if (!this.isStopped()) console.error('Merge queue error:', error);
      }).finally(() => { this.active.delete(workspace.id); });
      this.active.set(workspace.id, job);
    }
  }

  private async drain(workspace: Workspace): Promise<void> {
    const { db } = this.options;
    while (!this.isStopped()) {
      const next = db.db.select({ item: schema.mergeQueueItems, task: schema.tasks })
        .from(schema.mergeQueueItems).innerJoin(schema.tasks, eq(schema.tasks.id, schema.mergeQueueItems.taskId))
        .innerJoin(schema.boards, eq(schema.boards.id, schema.tasks.boardId))
        .where(and(eq(schema.boards.workspaceId, workspace.id), eq(schema.mergeQueueItems.status, 'queued'), eq(schema.tasks.status, 'merge-queue')))
        .all().sort((a, b) => a.item.position - b.item.position)[0];
      if (!next || this.cancelling.has(next.task.id)) return;
      const job: Job = { taskId: next.task.id, interrupted: false, processes: new Set() };
      this.jobs.set(workspace.id, job);
      try {
        if (!await this.context.run(job, () => this.merge(next.item, next.task, workspace))) return;
      } catch (error) {
        if (!job.interrupted && this.live(next.task)) await this.feedback(next.item, next.task, String(error).slice(-65536), false);
      } finally {
        if (job.interrupted) {
          await this.cleanIntegration(workspace);
          const current = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, next.task.id)).get();
          const item = db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, next.item.id)).get();
          // The ref update may have won the cancellation race. Record landed work.
          if (current?.status === 'merged' && item) {
            await this.cleanupMerged(current, workspace);
            this.emit(current, item);
          } else if (current?.status === 'merge-queue' && item && await this.landed(item, workspace)) {
            await this.complete(item, current, workspace, item.commitSha!);
          } else if (current?.status === 'merge-queue' && item && item.status !== 'conflict') {
            this.change(item, current, { status: 'queued', commitSha: null, output: 'Merge interrupted; waiting to resume' });
          }
        }
        this.jobs.delete(workspace.id);
      }
      if (job.interrupted) return;
    }
  }

  private git(cwd: string, ...args: string[]): Promise<string> {
    return this.gitWithEnv(cwd, {}, ...args);
  }

  private async gitWithEnv(cwd: string, env: Record<string, string>, ...args: string[]): Promise<string> {
    const job = this.context.getStore();
    if (job?.interrupted || (job && this.isStopped())) throw new MergeInterrupted();
    const process = execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
      cwd, env: { GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', ...env }, detached: true,
    });
    job?.processes.add(process);
    try { return (await process).stdout; }
    finally { job?.processes.delete(process); }
  }

  private checkoutJournal(workspace: Workspace): string {
    return path.join(this.home, 'integration', `${workspace.id}.checkout.json`);
  }

  private async finishCheckout(workspace: Workspace, state: CheckoutLock): Promise<void> {
    const ownLock = fs.existsSync(state.lock) && fs.statSync(state.lock).ino === state.inode;
    const published = state.indexPublished || (!fs.existsSync(state.lock) && fs.existsSync(state.index) && fs.statSync(state.index).ino === state.inode);
    if (published && state.old && !await this.landed({ commitSha: state.commitSha } as Item, workspace)) {
      // Files/index were already published under HEAD's lock: finish only the CAS.
      await this.git(workspace.repoPath, 'update-ref', `refs/heads/${workspace.defaultBranch}`, state.commitSha, state.old);
    }
    if (ownLock) {
      if (state.writeCheckout && await this.landed({ commitSha: state.commitSha } as Item, workspace)) {
        // Recover an older interrupted handoff with the ref moved but index locked.
        await this.gitWithEnv(workspace.repoPath, { GIT_INDEX_FILE: state.temporary }, 'diff', '--cached', '--quiet', state.commitSha, '--');
        if (await this.git(workspace.repoPath, 'branch', '--show-current') === workspace.defaultBranch) {
          const bytes = fs.readFileSync(state.temporary);
          fs.writeFileSync(state.lock, bytes);
          fs.renameSync(state.lock, state.index);
        } else {
          this.warnings.set(workspace.id, `Merge queue paused: ${workspace.defaultBranch} landed but checkout changed; index preserved`);
          fs.unlinkSync(state.lock);
        }
      } else fs.unlinkSync(state.lock);
    }
    fs.rmSync(state.temporary, { force: true });
    fs.rmSync(this.checkoutJournal(workspace), { force: true });
  }

  private async recoverCheckout(workspace: Workspace): Promise<void> {
    const journal = this.checkoutJournal(workspace);
    if (!fs.existsSync(journal)) return;
    const state = JSON.parse(fs.readFileSync(journal, 'utf8')) as CheckoutLock;
    await this.finishCheckout(workspace, state);
  }

  private async fastForward(item: Item, task: Task, workspace: Workspace, old: string, commitSha: string): Promise<boolean> {
    const index = path.resolve(workspace.repoPath, await this.git(workspace.repoPath, 'rev-parse', '--git-path', 'index'));
    const lock = index + '.lock';
    let descriptor: number;
    try { descriptor = fs.openSync(lock, 'wx'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const warning = `Merge queue paused: ${workspace.defaultBranch} checkout is busy (index.lock)`;
      this.warnings.set(workspace.id, warning);
      this.change(item, task, { status: 'queued', output: warning });
      return false;
    }
    const temporary = path.join(this.home, 'integration', `${workspace.id}.index`);
    const state: CheckoutLock = { index, lock, temporary, inode: fs.fstatSync(descriptor).ino, commitSha, old };
    try {
      fs.writeFileSync(descriptor, 'Crew merge checkout lock\n');
      fs.copyFileSync(index, temporary);
      fs.writeFileSync(this.checkoutJournal(workspace), JSON.stringify(state));
    } catch (error) {
      fs.rmSync(lock, { force: true });
      fs.rmSync(temporary, { force: true });
      throw error;
    } finally { fs.closeSync(descriptor); }
    try {
      if (await this.checkoutBlocked(workspace, commitSha)) {
        this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
        return false;
      }
      // A checkout that already switched uses CAS; the prepared transaction below
      // protects HEAD for writes in the default checkout.
      if (await this.git(workspace.repoPath, 'branch', '--show-current') !== workspace.defaultBranch) {
        await this.git(workspace.repoPath, 'update-ref', `refs/heads/${workspace.defaultBranch}`, commitSha, old);
        return true;
      }
      if (await this.git(workspace.repoPath, 'rev-parse', workspace.defaultBranch) !== old) throw new Error('Default branch moved before checkout update');
      const headLock = path.resolve(workspace.repoPath, await this.git(workspace.repoPath, 'rev-parse', '--git-path', 'HEAD')) + '.lock';
      if (fs.existsSync(headLock)) {
        const warning = `Merge queue paused: ${workspace.defaultBranch} checkout is busy (HEAD.lock)`;
        this.warnings.set(workspace.id, warning);
        this.change(item, task, { status: 'queued', output: warning });
        return false;
      }
      const job = this.context.getStore();
      // `update HEAD` prepares locks on both HEAD and its referent. Re-check HEAD
      // after prepare: a switch that won the lock race is aborted before any write.
      const transaction = execa('git', ['-c', 'core.hooksPath=/dev/null', 'update-ref', '--stdin'], {
        cwd: workspace.repoPath, detached: true, stdin: 'pipe',
      });
      job?.processes.add(transaction);
      let committed = false;
      try {
        const prepared = new Promise<void>((resolve, reject) => {
          let output = '';
          const data = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.includes('prepare: ok')) { transaction.stdout.off('data', data); resolve(); }
          };
          transaction.stdout.on('data', data);
          transaction.then(() => reject(new Error('Ref transaction ended before prepare')), reject);
        });
        transaction.stdin.write(`start\nupdate HEAD ${commitSha} ${old}\nprepare\n`);
        await prepared;
        if (!fs.existsSync(headLock)) throw new Error('Git did not lock HEAD for the prepared transaction; update Git (verified with 2.53.0)');
        if (!this.live(task)) return false;
        if (await this.git(workspace.repoPath, 'branch', '--show-current') !== workspace.defaultBranch) {
          transaction.stdin.end('abort\n');
          await transaction;
          await this.git(workspace.repoPath, 'update-ref', `refs/heads/${workspace.defaultBranch}`, commitSha, old);
          return true;
        }
        // This hook observes the actual protected window, not a check before it.
        await this.hooks.beforeCheckoutWrite?.(task);
        if (!this.live(task)) return false;
        if (await this.checkoutBlocked(workspace, commitSha)) {
          this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
          return false;
        }
        if (!this.live(task)) return false;
        state.writeCheckout = true;
        fs.writeFileSync(this.checkoutJournal(workspace), JSON.stringify(state));
        if (job) job.checkout = { commitSha, workspace };
        // From the first file write through the ref commit, finish even if a stop
        // arrives. read-tree refuses dirty/untracked/ignored collisions by default.
        await this.context.exit(() => this.gitWithEnv(workspace.repoPath, { GIT_INDEX_FILE: temporary }, 'read-tree', '-m', '-u', old, commitSha));
        // Publish while HEAD is still locked; no branch switch can cross the write.
        fs.writeFileSync(lock, fs.readFileSync(temporary));
        fs.renameSync(lock, index);
        state.indexPublished = true;
        fs.writeFileSync(this.checkoutJournal(workspace), JSON.stringify(state));
        transaction.stdin.end('commit\n');
        await transaction;
        committed = true;
      } finally {
        if (!committed && !transaction.stdin.destroyed && !transaction.stdin.writableEnded) transaction.stdin.end('abort\n');
        await transaction.catch(() => {});
        job?.processes.delete(transaction);
        if (job) job.checkout = undefined;
      }
      return true;
    } finally {
      // Cleanup must also run after the active job has been marked interrupted.
      await this.context.exit(() => this.finishCheckout(workspace, state));
    }
  }

  // Recovery/cleanup commands run after the active process has been reaped.
  private async cleanIntegration(workspace: Workspace): Promise<void> {
    const integration = path.join(this.home, 'integration', workspace.id);
    if (!fs.existsSync(integration)) return;
    await this.git(integration, 'rebase', '--abort').catch(() => {});
    await this.git(integration, 'reset', '--hard');
    const removed = await this.git(integration, 'clean', '-fd');
    if (removed) {
      const dir = await this.git(integration, 'rev-parse', '--absolute-git-dir');
      fs.rmSync(path.join(dir, 'crew-setup-complete'), { force: true });
    }
  }

  private async landed(item: Item, workspace: Workspace): Promise<boolean> {
    if (!item.commitSha) return false;
    try { await this.git(workspace.repoPath, 'merge-base', '--is-ancestor', item.commitSha, `refs/heads/${workspace.defaultBranch}`); return true; }
    catch { return false; }
  }

  private async recover(): Promise<void> {
    const { db, worktreeManager } = this.options;
    for (const workspace of db.db.select().from(schema.workspaces).all()) await this.recoverCheckout(workspace);
    for (const item of db.db.select().from(schema.mergeQueueItems).all()) {
      const task = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, item.taskId)).get();
      if (!task) continue;
      const workspace = worktreeManager.getWorkspaceForBoard(task.boardId);
      if (task.status === 'cancelled') { db.db.delete(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).run(); continue; }
      if (task.status === 'merged') { await this.cleanupMerged(task, workspace); continue; }
      if (task.status !== 'merge-queue') continue;
      if (await this.landed(item, workspace)) { await this.complete(item, task, workspace, item.commitSha!); continue; }
      if (item.status === 'failed') {
        await this.feedback(item, task, item.output || 'Previous merge attempt failed; human retry required', false);
        continue;
      }
      if (item.status === 'conflict') {
        const child = item.conflictTaskId && db.db.select().from(schema.tasks).where(eq(schema.tasks.id, item.conflictTaskId)).get();
        if (child) await this.reconcileParent(child.id, child.status);
        continue;
      }
      if (['queued', 'rebasing', 'verifying', 'merging'].includes(item.status)) {
        await this.cleanIntegration(workspace);
        this.change(item, task, { status: 'queued', commitSha: null, output: 'Recovered merge attempt' });
      }
    }
  }

  private async cleanupMerged(task: Task, workspace: Workspace): Promise<void> {
    await this.options.worktreeManager.removeWorktree(task);
    if (task.branch && await this.git(workspace.repoPath, 'branch', '--list', task.branch)) {
      await this.git(workspace.repoPath, 'branch', '-D', task.branch);
    }
  }

  private async complete(item: Item, task: Task, workspace: Workspace, commitSha: string): Promise<void> {
    await this.options.scheduler.transitionTask(task.id, 'merged', {
      reason: `Merged ${commitSha}`,
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'merged', commitSha, output: `Merged ${commitSha}` }).where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    await this.cleanupMerged(task, workspace);
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private live(task: Task): boolean {
    return !this.isStopped() && !this.cancelling.has(task.id) && !this.context.getStore()?.interrupted && this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.id)).get()?.status === 'merge-queue';
  }

  private async checkoutBlocked(workspace: Workspace, candidate?: string | null): Promise<boolean> {
    const branch = await this.git(workspace.repoPath, 'rev-parse', '--abbrev-ref', 'HEAD');
    const status = branch === workspace.defaultBranch ? await this.git(workspace.repoPath, 'status', '--porcelain=v1', '--untracked-files=all') : '';
    const dirty = !!status;
    if (dirty) {
      const hint = status.split('\n').includes('?? crew.config.ts') ? ' Untracked crew.config.ts pauses the merge queue; review and commit it before merging.' : '';
      this.warnings.set(workspace.id, `Merge queue paused: ${workspace.defaultBranch} checkout has uncommitted changes${hint}`);
      return true;
    }
    if (branch === workspace.defaultBranch && candidate) {
      const changed = (await this.git(workspace.repoPath, 'diff', '--name-only', '--diff-filter=ACMRT', '-z', `${workspace.defaultBranch}..${candidate}`)).split('\0').filter(Boolean);
      const ignored = (await this.git(workspace.repoPath, 'ls-files', '--others', '--ignored', '--exclude-standard', '-z')).split('\0').filter(Boolean);
      if (ignored.some(file => changed.some(target => file === target || file.startsWith(target + '/') || target.startsWith(file + '/')))) {
        this.warnings.set(workspace.id, `Merge queue paused: ${workspace.defaultBranch} checkout has ignored files that incoming work would overwrite`);
        return true;
      }
    }
    this.warnings.delete(workspace.id);
    return false;
  }

  private async merge(item: Item, task: Task, workspace: Workspace): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.mergeAttempt(item, task, workspace);
      if (result !== 'retry') return result;
    }
    await this.feedback(item, task, 'Default branch moved during merge three times; retry required', false);
    return true;
  }

  private async mergeAttempt(item: Item, task: Task, workspace: Workspace): Promise<boolean | 'retry'> {
    if (await this.checkoutBlocked(workspace, item.commitSha ?? task.branch)) {
      this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
      return false;
    }
    if (!this.live(task)) return false;
    if (!task.branch) throw new Error('Merge task has no branch');
    const repo = workspace.repoPath;
    const ref = `refs/heads/${workspace.defaultBranch}`;
    const old = await this.git(repo, 'rev-parse', ref);
    const integration = path.join(this.home, 'integration', workspace.id);
    if (!fs.existsSync(integration)) {
      fs.mkdirSync(path.dirname(integration), { recursive: true });
      await this.git(repo, 'worktree', 'add', '--detach', integration, old);
    }
    await this.cleanIntegration(workspace);
    try {
      await this.options.worktreeManager.setupWorktree(integration, workspace.config, `merge:${task.id}`, () => !this.live(task));
    } catch (error) {
      if (!this.live(task)) return false;
      await this.feedback(item, task, `Integration worktree setup failed: ${String(error)}`, false);
      return true;
    }
    if (!this.live(task)) return false;
    this.change(item, task, { status: 'rebasing' });
    await this.git(integration, 'switch', '--detach', task.branch);
    const userName = await this.git(repo, 'config', 'user.name').catch(() => 'Crew');
    const userEmail = await this.git(repo, 'config', 'user.email').catch(() => 'crew@localhost');
    try {
      await this.git(integration, '-c', `user.name=${userName || 'Crew'}`, '-c', `user.email=${userEmail || 'crew@localhost'}`, 'rebase', old);
    } catch (error) {
      if (!this.live(task)) throw new MergeInterrupted();
      const files = (await this.git(integration, 'diff', '--name-only', '--diff-filter=U', '-z')).split('\0').filter(Boolean);
      await this.git(integration, 'rebase', '--abort');
      if (files.length) {
        await this.conflict(item, task, workspace, files);
        return true;
      }
      throw error;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    this.change(item, task, { status: 'verifying' });
    const changed = (await this.git(integration, 'diff', '--name-only', '-z', `${old}..HEAD`)).split('\0').filter(Boolean);
    const run = this.options.db.db.select().from(schema.runs)
      .where(and(eq(schema.runs.taskId, task.id), eq(schema.runs.kind, 'work')))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`)).get();
    if (!run) throw new Error('Merge task has no author run');
    const config = workspace.config ?? {};
    const commands = (Array.isArray(config.verifyCommands) ? config.verifyCommands : []) as VerifyCommand[];
    const failures: string[] = [];
    for (const cmd of commands) {
      if (!cmd.name || !cmd.command || (cmd.paths?.length && !changed.some(file => picomatch(cmd.paths!)(file)))) continue;
      if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
      const result = await this.commands.execute(cmd, integration, task.id);
      if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
      this.options.db.db.insert(schema.verificationResults).values({
        id: randomUUID(), runId: run.id, step: `merge:${cmd.name}`, passed: result.passed,
        output: result.output.slice(-65536), createdAt: new Date(),
      }).run();
      this.options.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step', data: { taskId: task.id, step: `merge:${cmd.name}`, passed: result.passed },
      });
      if (!result.passed) failures.push(`Merge verification '${cmd.name}' failed:\n${result.output.slice(-4096)}`);
    }
    if (failures.length) {
      await this.feedback(item, task, failures.join('\n\n'), true);
      return true;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    this.change(item, task, { status: 'merging' });
    if (config.mergeStrategy !== 'rebase') {
      const agent = this.options.db.db.select().from(schema.agents).where(eq(schema.agents.id, run.agentId)).get();
      await this.git(integration, 'reset', '--soft', old);
      await this.git(integration, '-c', `user.name=${userName || 'Crew'}`, '-c', `user.email=${userEmail || 'crew@localhost'}`,
        'commit', `--author=${agent?.name ?? 'Crew'} <agent@crew.local>`, '-m', `${task.title}\n\nCrew-Task: ${task.id}`);
    }
    const commitSha = await this.git(integration, 'rev-parse', 'HEAD');
    // Persist before moving the ref: recovery can recognize a merge that landed before a crash.
    this.change(item, task, { commitSha });
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    await this.hooks.beforeRefUpdate?.(task, commitSha);
    if (await this.checkoutBlocked(workspace, commitSha)) {
      this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
      return false;
    }
    if (!this.live(task)) { this.change(item, task, { status: 'queued' }); return false; }
    try {
      const branch = await this.git(repo, 'rev-parse', '--abbrev-ref', 'HEAD');
      if (branch === workspace.defaultBranch) {
        // ff-only refuses a diverged tip, preserving the user's competing commit.
        if (await this.git(repo, 'rev-parse', ref) !== old) {
          this.change(item, task, { status: 'queued', commitSha: null, output: 'Default branch moved; rebasing again' });
          return 'retry';
        }
        await this.hooks.beforeCheckoutMerge?.(task);
        if (!this.live(task)) return false;
        if (!await this.fastForward(item, task, workspace, old, commitSha)) return false;
      } else {
        await this.git(repo, 'update-ref', ref, commitSha, old);
      }
    } catch (error) {
      if (!this.live(task)) throw new MergeInterrupted();
      if (await this.checkoutBlocked(workspace, commitSha)) {
        this.change(item, task, { status: 'queued', output: this.warnings.get(workspace.id)! });
        return false;
      }
      if (await this.git(repo, 'rev-parse', ref) === old) throw error;
      this.change(item, task, { status: 'queued', commitSha: null, output: 'Default branch moved; rebasing again' });
      return 'retry';
    }
    if (!this.live(task)) return false;
    if (!await this.landed({ ...item, commitSha }, workspace)) throw new Error('Merge candidate did not reach the default branch; human retry required');
    await this.complete(item, task, workspace, commitSha);
    return true;
  }

  private async conflict(item: Item, task: Task, workspace: Workspace, files: string[]): Promise<void> {
    if (!this.live(task)) return;
    const maxDepth = typeof workspace.config?.maxDepth === 'number' ? workspace.config.maxDepth : 3;
    if (task.depth + 1 > maxDepth) {
      await this.feedback(item, task, `Conflict exceeds maximum task depth ${maxDepth}: ${files.join(', ')}`, false);
      return;
    }
    // Git forbids checking a branch out in two worktrees: remove first, then publish the child.
    await this.options.worktreeManager.removeWorktree(task);
    if (!this.live(task)) return;
    const childId = randomUUID();
    const description = [
      `Rebase + resolve for task ${task.id}: ${task.title}`,
      task.description,
      `Conflicting files: ${files.join(', ')}`,
      `Continue branch ${task.branch}. Rebase onto ${workspace.defaultBranch}, resolve every conflict, run the project's checks, then call crew done.`,
      'Preserve the original task acceptance criteria and the changes already on the default branch.',
    ].join('\n\n');
    await this.options.scheduler.createTask({
      id: childId, boardId: task.boardId, title: `Rebase + resolve: ${task.title}`,
      description, acceptanceCriteria: task.acceptanceCriteria, roleId: task.roleId ?? undefined,
      assigneeAgentId: task.assigneeAgentId ?? undefined, parentTaskId: task.id, depth: task.depth + 1,
      branch: task.branch!, createdBy: 'merge-queue',
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'conflict', conflictTaskId: childId, output: `Conflicts: ${files.join(', ')}` })
        .where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private async reconcileParent(childId: string, status: string): Promise<void> {
    if (!['merged', 'escalated', 'cancelled'].includes(status)) return;
    const item = this.options.db.db.select().from(schema.mergeQueueItems)
      .where(and(eq(schema.mergeQueueItems.conflictTaskId, childId), eq(schema.mergeQueueItems.status, 'conflict'))).get();
    if (!item) return;
    const parent = this.options.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, item.taskId)).get();
    if (!parent || parent.status !== 'merge-queue') return;
    if (status !== 'merged') {
      await this.feedback(item, parent, `Conflict sub-task ${childId} was ${status}`, false);
      return;
    }
    const childItem = this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, childId)).get();
    await this.options.scheduler.transitionTask(parent.id, 'merged', {
      reason: `merged via ${childId}`,
      alongside: () => this.options.db.db.update(schema.mergeQueueItems)
        .set({ status: 'merged', commitSha: childItem?.commitSha, output: `merged via ${childId}` })
        .where(eq(schema.mergeQueueItems.id, item.id)).run(),
    });
    this.emit(parent, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private async feedback(item: Item, task: Task, body: string, retry: boolean): Promise<void> {
    await this.options.scheduler.transitionTask(task.id, retry ? 'doing' : 'escalated', {
      reason: body,
      incrementRetries: retry,
      alongside: () => {
        this.options.db.db.insert(schema.messages).values({
          id: randomUUID(), taskId: task.id, fromAgentId: null, type: 'feedback', body, createdAt: new Date(),
        }).run();
        this.options.db.db.update(schema.mergeQueueItems).set({ status: 'failed', output: body.slice(-65536), commitSha: null })
          .where(eq(schema.mergeQueueItems.id, item.id)).run();
      },
    });
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private change(item: Item, task: Task, values: Partial<Item>): void {
    this.options.db.db.update(schema.mergeQueueItems).set(values).where(eq(schema.mergeQueueItems.id, item.id)).run();
    this.emit(task, this.options.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.id, item.id)).get()!);
  }

  private emit(task: Task, item: Item): void {
    this.options.eventBus.publishBoardEvent(task.boardId, { type: 'merge_item_changed', data: item });
  }
}
