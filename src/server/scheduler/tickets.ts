import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import type { Scheduler, Task } from './index.js';

export class TicketError extends Error {
  constructor(message: string, public status: 400 | 404 | 409 = 400) { super(message); }
}

export class Tickets {
  constructor(private db: CrewDatabase, private scheduler: Scheduler, private events: EventBus) {}

  board(id: string) {
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, id)).get();
    if (!board) throw new TicketError(`Board not found: ${id}`, 404);
    return board;
  }

  private role(workspaceId: string, name: string) {
    // Custom roles are workspace-qualified; shared built-ins are the only global choices.
    const roles = this.db.db.select().from(schema.roles).all().filter(role =>
      role.isBuiltin || role.id === `configured-${workspaceId}-${role.name}` ||
      this.db.db.select().from(schema.agents).where(and(eq(schema.agents.workspaceId, workspaceId), eq(schema.agents.roleId, role.id))).get());
    const exact = roles.find(role => role.id === name);
    const matches = exact ? [exact] : roles.filter(role => role.name === name);
    if (matches.length !== 1) throw new TicketError(`Unknown or ambiguous role: ${name}. Use a role ID from this workspace.`);
    return matches[0];
  }

  private assignee(workspaceId: string, name: string) {
    const agents = this.db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, workspaceId)).all();
    const exact = agents.find(agent => agent.id === name);
    const matches = exact ? [exact] : agents.filter(agent => agent.name === name);
    if (matches.length !== 1) throw new TicketError(`Unknown or ambiguous agent: ${name}. Use an agent ID from this workspace.`);
    return matches[0];
  }

  async create(body: Record<string, unknown>, boardId: string, phase: string, createdBy: string): Promise<Task> {
    for (const key of Object.keys(body)) {
      if (!['boardId', 'phase', 'taskId', 'title', 'description', 'acceptanceCriteria', 'role', 'assignee', 'blockedByIds'].includes(key)) throw new TicketError(`Unknown ticket field: ${key}`);
    }
    if (typeof body.title !== 'string' || !body.title.trim()) throw new TicketError('A non-empty title is required.');
    for (const key of ['description', 'acceptanceCriteria', 'assignee']) {
      if (body[key] !== undefined && typeof body[key] !== 'string') throw new TicketError(`${key} must be text.`);
    }
    if (typeof body.role !== 'string' || !body.role) throw new TicketError('A role is required; use --role <role>.');
    if (body.blockedByIds !== undefined && (!Array.isArray(body.blockedByIds) || body.blockedByIds.some(id => typeof id !== 'string'))) throw new TicketError('blockedByIds must be an array of task IDs.');
    const board = this.board(boardId);
    if (board.currentPhase !== phase || phase === 'done') throw new TicketError('The board has moved on from this phase; check crew status before creating tickets.', 409);
    const role = this.role(board.workspaceId, body.role);
    const team = this.db.db.select().from(schema.agents).where(and(eq(schema.agents.workspaceId, board.workspaceId), eq(schema.agents.roleId, role.id))).all();
    if (!team.length) throw new TicketError(`No agent has role ${role.name} in this workspace; choose a staffed role.`);
    const assignee = body.assignee ? this.assignee(board.workspaceId, body.assignee as string) : undefined;
    if (assignee && assignee.roleId !== role.id) throw new TicketError('The assignee must have the ticket role.');
    const blockers = [...new Set((body.blockedByIds ?? []) as string[])];
    for (const id of blockers) {
      const blocker = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
      if (!blocker) throw new TicketError(`Blocker not found: ${id}. Correct --blocked-by and create the ticket again.`, 404);
      if (blocker.boardId !== boardId || blocker.kind !== 'work') throw new TicketError('Blockers must be work tickets on the same board.');
      if (['cancelled', 'escalated'].includes(blocker.status)) throw new TicketError(`Blocker ${id} is ${blocker.status}; recover it or choose another blocker.`);
    }
    return this.scheduler.createTask({
      id: `task-${randomUUID()}`, boardId, creationPhase: phase, title: body.title.trim(),
      description: (body.description as string | undefined) ?? '', acceptanceCriteria: body.acceptanceCriteria as string | undefined,
      roleId: role.id, assigneeAgentId: assignee?.id, blockedByIds: blockers, createdBy,
      alongside: () => {
        // Count inside task creation's transaction, including this insertion. Failed requests consume no quota.
        if (this.board(boardId).currentPhase !== phase) throw new TicketError('The board has moved on from this phase.', 409);
        const count = this.db.db.select({ n: sql<number>`count(*)` }).from(schema.tasks)
          .where(and(eq(schema.tasks.boardId, boardId), eq(schema.tasks.kind, 'work'), eq(schema.tasks.creationPhase, phase))).get()!.n;
        const workspace = this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()!;
        const limit = typeof workspace.config?.maxTicketsPerPhase === 'number' ? workspace.config.maxTicketsPerPhase : 20;
        if (count > limit) throw new TicketError(`maxTicketsPerPhase (${limit}) reached for this board's ${phase} phase. Review existing tickets before adding more.`, 409);
      },
    });
  }

  assign(taskId: string, target: string): Task {
    const task = this.db.sqlite.transaction(() => {
      const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
      if (!task) throw new TicketError(`Task not found: ${taskId}`, 404);
      if (task.kind !== 'work' || !['todo', 'ready'].includes(task.status)) throw new TicketError('Only todo or ready work tickets can be assigned.', 409);
      const board = this.board(task.boardId);
      if (board.currentPhase === 'done') throw new TicketError('This board is done.', 409);
      const agents = this.db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, board.workspaceId)).all();
      const agent = agents.find(agent => agent.id === target) ?? agents.find(agent => agent.name === target);
      const role = agent ? undefined : this.role(board.workspaceId, target);
      if (agent) this.assignee(board.workspaceId, target); // Reject ambiguous names rather than choosing arbitrarily.
      if (role && !agents.some(agent => agent.roleId === role.id)) throw new TicketError(`No agent has role ${role.name}; choose a staffed role.`);
      this.db.db.update(schema.tasks).set({ roleId: agent?.roleId ?? role!.id, assigneeAgentId: agent?.id ?? null, updatedAt: new Date() }).where(eq(schema.tasks.id, taskId)).run();
      return this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()!;
    })();
    this.events.publishBoardEvent(task.boardId, { type: 'task_assignment_changed', data: { taskId: task.id, assigneeAgentId: task.assigneeAgentId, roleId: task.roleId } });
    return task;
  }
}
