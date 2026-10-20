import { randomUUID } from 'node:crypto';
import { eq, desc, sql } from 'drizzle-orm';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { Scheduler } from '../scheduler/index.js';
import type { EventBus } from '../events/index.js';
import type { Runner } from '../runner/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import { PHASES } from './phases.js';
export class WorkflowError extends Error { constructor(message: string, readonly status: 400 | 404 | 409 = 409) { super(message); } }
export class Workflow {
  private unsubscribe?: () => void;
  private jobs = new Set<Promise<unknown>>();
  constructor(private db: CrewDatabase, private scheduler: Scheduler, private events: EventBus, private runner: Runner, private worktrees: WorktreeManager) {}
  snapshot(boardId: string) {
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).get();
    if (!board) throw new WorkflowError('Board does not exist.', 404);
    const workspace = this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()!;
    const phaseTasks = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.boardId, boardId)).orderBy(desc(sql`rowid`)).all().filter(t => t.kind === 'phase' && t.creationPhase === board.currentPhase);
    const draft = this.db.db.select().from(schema.phaseOutputs).where(eq(schema.phaseOutputs.boardId, boardId)).all().find(o => o.phase === board.currentPhase && o.status === 'draft');
    const memory = this.db.db.select().from(schema.memory).where(eq(schema.memory.workspaceId, workspace.id)).all().filter(entry => entry.layer === 'project' || (entry.layer === 'role' && entry.roleId === phaseTasks[0]?.roleId) || (entry.layer === 'task' && entry.taskId === phaseTasks[0]?.id));
    const problem = !phaseTasks[0] && !draft && !['dispatch', 'done'].includes(board.currentPhase) ? 'No phase task. Run crew init, then crew resume to start this phase.' : undefined;
    return { board, workspace, task: phaseTasks[0], draft, memory, problem, instructions: PHASES[board.currentPhase]?.instructions ?? 'Board complete.' };
  }
  private changed(boardId: string) { this.events.publishBoardEvent(boardId, { type: 'phase_changed', data: { boardId, ...this.snapshot(boardId) } }); }
  async ensureBoard(boardId: string) {
    const state = this.snapshot(boardId);
    if (!PHASES[state.board.currentPhase] || state.board.currentPhase === 'dispatch' || state.draft || state.task) return;
    await this.createPhase(boardId, state.board.currentPhase);
  }
  private async createPhase(boardId: string, phase: string, alongside?: () => void, note?: string, previous?: { taskId?: string; output?: string; description?: string }) {
    const state = this.snapshot(boardId);
    const staff = this.db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, state.board.workspaceId)).all();
    const agent = staff.find(a => this.db.db.select().from(schema.roles).where(eq(schema.roles.id, a.roleId)).get()?.name === 'orchestrator');
    if (!agent) throw new WorkflowError('No staffed Orchestrator. Run crew init to restore the default team.');
    const id = randomUUID();
    const task = await this.scheduler.createTask({ id, boardId, title: `${phase} phase`, description: previous?.description ?? `${PHASES[phase].instructions}${previous?.output ? `\n\nPrevious phase output:\n${previous.output}` : ''}`, parentTaskId: previous?.taskId, kind: 'phase', creationPhase: phase, roleId: agent.roleId, assigneeAgentId: agent.id, createdBy: 'workflow', alongside: () => {
      alongside?.();
      if (previous?.taskId) {
        const conversation = this.db.db.select().from(schema.messages).where(eq(schema.messages.taskId, previous.taskId)).orderBy(sql`created_at`, sql`rowid`).all();
        for (const message of conversation.filter(message => ['question', 'answer'].includes(message.type))) this.db.db.insert(schema.messages).values({ ...message, id: randomUUID(), taskId: id }).run();
      }
      if (note) this.db.db.insert(schema.messages).values({ id: randomUUID(), taskId: id, type: 'feedback', body: note, createdAt: new Date() }).run();
    } });
    this.changed(boardId); return task;
  }
  async complete(taskId: string, output: unknown) {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task || task.kind !== 'phase' || task.status !== 'doing') throw new WorkflowError('Only an active phase task can submit output.');
    const state = this.snapshot(task.boardId);
    if (state.task?.id !== task.id || state.board.currentPhase !== task.creationPhase || state.draft) throw new WorkflowError('Phase has moved on or already has a draft.');
    if (typeof output !== 'string' || !output.trim()) throw new WorkflowError('Phase output must be non-empty text; fix the output file and submit again.', 400);
    const live = this.runner.getLiveRunByTaskId(taskId);
    if (!live || live.exitReason || this.runner.isCancelling(taskId)) throw new WorkflowError('Phase run is no longer active.');
    const id = randomUUID();
    await this.scheduler.transitionTask(taskId, 'merged', { reason: 'Phase output submitted', alongside: () => {
      this.db.db.insert(schema.phaseOutputs).values({ id, taskId, boardId: task.boardId, phase: task.creationPhase!, body: output, status: 'draft', createdAt: new Date() }).run();
    } });
    live.exitReason = 'done';
    const cleanup = live.promise.then(() => this.worktrees.removeWorktree(task)).catch(error => console.error('Phase worktree cleanup:', error));
    this.jobs.add(cleanup); void cleanup.finally(() => this.jobs.delete(cleanup));
    this.changed(task.boardId);
    if ((state.workspace.config?.workflow as { gates?: Record<string, boolean> } | undefined)?.gates?.[state.board.currentPhase] === false) await this.approve(task.boardId, id, {});
    return this.snapshot(task.boardId);
  }
  async approve(boardId: string, draftId: unknown, input: { edit?: unknown; reject?: unknown; note?: unknown }) {
    const current = this.snapshot(boardId);
    if (typeof draftId !== 'string' || current.draft?.id !== draftId) throw new WorkflowError('Draft missing, stale or already decided. Refresh crew phase/status before approving.');
    if (input.edit !== undefined && (typeof input.edit !== 'string' || !input.edit.trim())) throw new WorkflowError('Edited text must not be empty.', 400);
    if (input.reject !== undefined && typeof input.reject !== 'boolean') throw new WorkflowError('reject must be a boolean.', 400);
    if (input.reject && (typeof input.note !== 'string' || !input.note.trim())) throw new WorkflowError('Rejection requires --note.', 400);
    if (input.reject && input.edit !== undefined) throw new WorkflowError('Use edit or reject, not both.', 400);
    const phase = current.board.currentPhase;
    const next = input.reject ? phase : PHASES[phase]?.next;
    if (!next) throw new WorkflowError('Unknown phase.');
    const commit = () => {
      const state = this.snapshot(boardId);
      if (state.draft?.id !== draftId || state.board.currentPhase !== phase) throw new WorkflowError('Draft missing, stale or already decided.');
      if (!input.reject && phase === 'tickets') this.validateTickets(boardId);
      if (!input.reject && phase === 'spec') {
        this.db.db.insert(schema.memory).values({
          id: randomUUID(), workspaceId: state.board.workspaceId, layer: 'project',
          title: 'Approved spec', body: typeof input.edit === 'string' ? input.edit : state.draft.body,
          source: `phase:spec:${draftId}`, createdAt: new Date(),
        }).run();
      }
      this.db.db.update(schema.phaseOutputs).set({ status: input.reject ? 'rejected' : 'approved', body: typeof input.edit === 'string' ? input.edit : state.draft.body, approvedAt: input.reject ? null : new Date() }).where(eq(schema.phaseOutputs.id, draftId)).run();
      this.db.db.update(schema.boards).set({ currentPhase: next }).where(eq(schema.boards.id, boardId)).run();
    };
    if (next === 'dispatch') { this.scheduler.releaseTickets(boardId, commit); this.changed(boardId); }
    else if (next === 'done') { this.db.db.transaction(commit); this.changed(boardId); }
    else await this.createPhase(boardId, next, commit, input.reject ? input.note as string : undefined, { taskId: current.task?.id, output: typeof input.edit === 'string' ? input.edit : current.draft.body });
    return this.snapshot(boardId);
  }
  private validateTickets(boardId: string) {
    const tasks = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.boardId, boardId)).all();
    const byId = new Map(tasks.map(task => [task.id, task]));
    const edges = this.db.db.select().from(schema.taskDependencies).all();
    const visited = new Set<string>(), active = new Set<string>();
    const visit = (id: string) => {
      if (active.has(id)) throw new WorkflowError('Ticket dependency cycle. Cancel an affected ticket with crew cancel, then approve again.');
      if (visited.has(id)) return;
      active.add(id);
      for (const edge of edges.filter(edge => edge.taskId === id)) {
        const blocker = byId.get(edge.blockedByTaskId);
        if (!blocker || blocker.kind !== 'work' || ['cancelled', 'escalated'].includes(blocker.status))
          throw new WorkflowError('Invalid ticket blocker. Use crew retry for an escalated blocker or crew cancel for the dependent ticket, then approve again.');
        visit(blocker.id);
      }
      active.delete(id); visited.add(id);
    };
    for (const task of tasks.filter(task => task.kind === 'work' && !['cancelled', 'merged'].includes(task.status))) visit(task.id);
  }
  async retryCancelled(taskId: string, note?: string) {
    const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task || task.kind !== 'phase' || task.status !== 'cancelled') throw new WorkflowError('Only a cancelled phase can be replaced.');
    const state = this.snapshot(task.boardId);
    if (state.task?.id !== task.id || state.draft) throw new WorkflowError('Phase has moved on or was already retried.');
    return this.createPhase(task.boardId, state.board.currentPhase, () => {
      if (this.snapshot(task.boardId).board.currentPhase !== task.creationPhase) throw new WorkflowError('Phase has moved on.');
    }, note, { taskId: task.id, description: task.description });
  }
  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.events.subscribeBoardEvents('*', event => {
      if (event.type === 'phase_changed') return;
      if (event.type === 'task_status_changed') {
        const data = event.data as { taskId: string; to: string };
        const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, data.taskId)).get();
        if (task?.kind === 'phase') this.changed(task.boardId);
      }
    });
    for (const board of this.db.db.select().from(schema.boards).all()) void this.ensureBoard(board.id).catch(error => console.error(`Workflow ${board.id}: ${error.message}`));
  }
  stop() { this.unsubscribe?.(); this.unsubscribe = undefined; }
  async close() { this.stop(); await Promise.all([...this.jobs]); }
}
