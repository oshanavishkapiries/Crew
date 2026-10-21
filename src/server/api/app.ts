import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { getCrewHome } from '../config.js';
import { LogReadError, logTailBytes, readRunLog } from './logs.js';
import { BrowserSessions } from './sessions.js';
import { serveBoard } from './static.js';
import { WorkflowError, type Workflow } from '../workflow/index.js';
import * as fs from 'node:fs';
import { sql, eq, inArray, desc, asc, and } from 'drizzle-orm';
import { execa } from 'execa';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import { MemoryStore, MemoryError } from '../memory/index.js';
import { Tickets, TicketError } from '../scheduler/tickets.js';
import type { EventBus } from '../events/index.js';
import {
  DependencyCycleError,
  InvalidTransitionError,
  type Scheduler,
  type Task,
  TaskNotFoundError,
  type Dispatcher,
} from '../scheduler/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import type { Runner } from '../runner/index.js';
import type { MergeQueue } from '../merge/index.js';
import type { Verifier } from '../verify/index.js';
import {
  AGENT_TOKEN_HEADER,
  hashToken,
  hostHeaderMiddleware,
  SECRET_HEADER,
  secretsMatch,
} from './security.js';

export interface AppContext {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  perStartSecret: string;
  browserSessions?: BrowserSessions;
  worktreeManager?: WorktreeManager;
  runner?: Runner;
  dispatcher?: Dispatcher;
  verifier?: Verifier;
  mergeQueue?: MergeQueue;
  workflow?: Workflow;
}

type Agent = typeof schema.agents.$inferSelect;

type Caller = { kind: 'human' } | { kind: 'agent'; agent: Agent };

function newMessageId(): string {
  return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();
  const crewHome = getCrewHome();
  const sessions = ctx.browserSessions ?? new BrowserSessions();

  // D13: Host-header validation middleware on all routes
  app.use('*', hostHeaderMiddleware());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
    if (err instanceof WorkflowError) return c.json({ error: err.message }, err.status);
    if (err instanceof MemoryError) return c.json({ error: err.message }, err.status);
    if (err instanceof LogReadError) return c.json({ error: err.message }, err.status);
    if (err instanceof TicketError) return c.json({ error: err.message }, err.status);
    if (err instanceof TaskNotFoundError) return c.json({ error: err.message }, 404);
    if (err instanceof InvalidTransitionError || err instanceof DependencyCycleError) {
      return c.json({ error: err.message }, 409);
    }
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });

  // D13: the Board and human CLI send the per-start secret; agents send their own token
  const identify = (c: Context): Caller | null => {
    if (secretsMatch(c.req.header(SECRET_HEADER), ctx.perStartSecret)) {
      return { kind: 'human' };
    }
    if (sessions.valid(getCookie(c, 'crew_session'))) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.header('X-Crew-Board') !== '1') {
        throw forbidden('cookie mutations require X-Crew-Board: 1');
      }
      return { kind: 'human' };
    }
    const token = c.req.header(AGENT_TOKEN_HEADER);
    if (!token) return null;
    const agent = ctx.db.db
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.tokenHash, hashToken(token)))
      .get();
    return agent ? { kind: 'agent', agent } : null;
  };

  const unauthorized = () =>
    new HTTPException(401, {
      res: Response.json({ error: 'Unauthorized: missing or invalid credentials. Run crew open to sign in again (D13)' }, { status: 401 }),
    });

  const forbidden = (message: string) =>
    new HTTPException(403, { res: Response.json({ error: `Forbidden: ${message}` }, { status: 403 }) });

  const requireHuman = (c: Context): void => {
    if (identify(c)?.kind !== 'human') throw unauthorized();
  };

  const requireBoardHuman = (c: Context): void => {
    if (c.req.header(AGENT_TOKEN_HEADER)) throw forbidden('agents cannot use browser sessions or edit personas');
    requireHuman(c);
  };

  app.use('/api/session*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    if (c.req.header(AGENT_TOKEN_HEADER)) throw forbidden('agents cannot use browser sessions');
    await next();
  });
  // CLI-only minting: the browser never receives the per-start secret.
  app.post('/api/session/key', c => {
    if (!secretsMatch(c.req.header(SECRET_HEADER), ctx.perStartSecret)) throw unauthorized();
    return c.json({ key: sessions.issueKey() });
  });
  app.post('/api/session', async c => {
    const body = await c.req.json().catch(() => null);
    const session = sessions.exchange(body?.key);
    if (!session) throw unauthorized();
    setCookie(c, 'crew_session', session, { httpOnly: true, sameSite: 'Strict', path: '/' });
    return c.body(null, 204);
  });
  app.get('/api/session', c => {
    if (!sessions.valid(getCookie(c, 'crew_session'))) throw unauthorized();
    return c.body(null, 204);
  });
  app.delete('/api/session', c => {
    requireBoardHuman(c);
    sessions.revoke(getCookie(c, 'crew_session'));
    deleteCookie(c, 'crew_session', { path: '/', httpOnly: true, sameSite: 'Strict' });
    return c.body(null, 204);
  });

  const publicAgent = ({ tokenHash: _tokenHash, ...agent }: Agent) => agent;
  app.get('/api/boards', c => {
    requireBoardHuman(c);
    const workspaces = new Map(ctx.db.db.select().from(schema.workspaces).all().map(w => [w.id, w]));
    return c.json({ boards: ctx.db.db.select().from(schema.boards).all().map(board => {
      const workspace = workspaces.get(board.workspaceId)!;
      return { ...board, workspace: { id: workspace.id, name: workspace.name, repoPath: workspace.repoPath, defaultBranch: workspace.defaultBranch }, stopped: ctx.dispatcher?.isStopped() ?? false };
    }) });
  });
  app.get('/api/agents', c => {
    requireBoardHuman(c);
    return c.json({ agents: ctx.db.db.select().from(schema.agents).all().map(publicAgent) });
  });
  app.get('/api/agents/:id', c => {
    requireBoardHuman(c);
    const agent = ctx.db.db.select().from(schema.agents).where(eq(schema.agents.id, c.req.param('id'))).get();
    return agent ? c.json({ agent: publicAgent(agent) }) : c.json({ error: 'Agent not found' }, 404);
  });
  app.get('/api/roles', c => {
    requireBoardHuman(c);
    return c.json({ roles: ctx.db.db.select().from(schema.roles).all() });
  });
  app.patch('/api/agents/:id', async c => {
    requireBoardHuman(c);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body) || !Object.keys(body).length ||
      Object.entries(body).some(([key, value]) => !['name', 'personality', 'systemPrompt'].includes(key) || typeof value !== 'string' || (key === 'name' && !value.trim()))) {
      return c.json({ error: 'Provide name (nonblank), personality or systemPrompt as strings; no other fields may be edited.' }, 400);
    }
    const agent = ctx.db.db.update(schema.agents).set(body).where(eq(schema.agents.id, c.req.param('id'))).returning().get();
    return agent ? c.json({ agent: publicAgent(agent) }) : c.json({ error: 'Agent not found; refresh the team list.' }, 404);
  });

  const loadTask = (taskId: string): Task => {
    const task = ctx.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  };

  // Each agent token acts only for that agent, on tasks assigned to it (user story 125)
  const requireAssignedAgent = (c: Context, taskId: string): { agent: Agent; task: Task } => {
    const caller = identify(c);
    if (caller?.kind !== 'agent') throw unauthorized();
    const task = loadTask(taskId);
    if (task.assigneeAgentId !== caller.agent.id) {
      throw forbidden(`task ${taskId} is not assigned to this agent`);
    }
    return { agent: caller.agent, task };
  };

  // D13, D34: only the designated reviewer agent may call the review endpoint
  const requireReviewerAgent = (c: Context, taskId: string): { agent: Agent; task: Task } => {
    const caller = identify(c);
    if (caller?.kind !== 'agent') throw unauthorized();
    const task = loadTask(taskId);
    if (!task.reviewerAgentId || task.reviewerAgentId !== caller.agent.id) {
      throw forbidden(`agent is not the designated reviewer for task ${taskId}`);
    }
    return { agent: caller.agent, task };
  };

  const tickets = new Tickets(ctx.db, ctx.scheduler, ctx.eventBus);
  const requireTicketCaller = (c: Context, body: Record<string, unknown>) => {
    const caller = identify(c);
    if (!caller) throw unauthorized();
    if (caller.kind === 'human') return { caller };
    const role = ctx.db.db.select().from(schema.roles).where(eq(schema.roles.id, caller.agent.roleId)).get();
    if (role?.name !== 'orchestrator') throw forbidden('only the Orchestrator or a human can create or assign tickets');
    if (typeof body.taskId !== 'string') throw new TicketError('The Orchestrator must supply its current taskId.');
    const task = loadTask(body.taskId);
    if (task.assigneeAgentId !== caller.agent.id) throw forbidden('Orchestrator context is not assigned to this agent');
    const run = ctx.runner?.getLiveRunByTaskId(task.id);
    if (task.kind !== 'phase' || task.status !== 'doing' || !run || run.agentId !== caller.agent.id || run.exitReason || ctx.runner?.isCancelling(task.id) || ctx.dispatcher?.isStopped()) {
      throw new TicketError('The Orchestrator phase run is no longer active; no ticket changes were made.', 409);
    }
    const board = tickets.board(task.boardId);
    if (task.creationPhase !== board.currentPhase) throw new TicketError('The board has moved on from this phase run.', 409);
    return { caller, task, board };
  };
  const ticketBody = async (c: Context): Promise<Record<string, unknown>> => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TicketError('Expected a JSON object.');
    return body;
  };

  app.post('/api/tasks', async c => {
    const body = await ticketBody(c);
    const actor = requireTicketCaller(c, body);
    const boardId = actor.task?.boardId ?? body.boardId;
    const phase = actor.task?.creationPhase ?? body.phase;
    if (typeof boardId !== 'string' || typeof phase !== 'string') throw new TicketError('Human creation requires --board <id> and --phase <phase>.');
    if (actor.task && ((body.boardId !== undefined && body.boardId !== boardId) || (body.phase !== undefined && body.phase !== phase))) throw forbidden('ticket board/phase must match the active Orchestrator task');
    const task = await tickets.create(body, boardId, phase, actor.caller.kind === 'human' ? 'human' : `agent:${actor.caller.agent.id}`);
    return c.json({ task }, 201);
  });

  app.patch('/api/tasks/:id', async c => {
    const caller = identify(c);
    if (!caller) throw unauthorized();
    if (caller.kind !== 'human') throw forbidden('only humans can edit persisted tickets');
    return c.json({ task: tickets.edit(c.req.param('id'), await ticketBody(c)) });
  });

  app.post('/api/tasks/:id/assign', async c => {
    const body = await ticketBody(c);
    const actor = requireTicketCaller(c, body);
    if (typeof body.assignee !== 'string' || !body.assignee) throw new TicketError('An agent ID/name or role is required.');
    const target = loadTask(c.req.param('id'));
    if (actor.task && target.boardId !== actor.task.boardId) throw forbidden('cannot assign a task on another board');
    return c.json({ task: tickets.assign(target.id, body.assignee) });
  });

  const activePhase = (c: Context, taskId: string) => {
    const { agent, task } = requireAssignedAgent(c, taskId);
    const role = ctx.db.db.select().from(schema.roles).where(eq(schema.roles.id, agent.roleId)).get();
    if (role?.name !== 'orchestrator' || task.kind !== 'phase') throw forbidden('only the assigned Orchestrator can complete a phase');
    const run = ctx.runner?.getLiveRunByTaskId(taskId);
    if (!run || run.exitReason || task.status !== 'doing' || ctx.runner?.isCancelling(taskId) || ctx.dispatcher?.isStopped()) throw new WorkflowError('Phase run is no longer active.');
    return task;
  };
  app.post('/api/tasks/:id/phase', c => { const task = activePhase(c, c.req.param('id')); return c.json(ctx.workflow!.snapshot(task.boardId)); });
  app.post('/api/tasks/:id/phase-done', async c => { const task = activePhase(c, c.req.param('id')); const body = await ticketBody(c); return c.json(await ctx.workflow!.complete(task.id, body.output)); });
  app.get('/api/boards/:id/phase', c => { requireHuman(c); return c.json(ctx.workflow!.snapshot(c.req.param('id'))); });
  app.post('/api/boards/:id/phase/approve', async c => { requireHuman(c); const body = await ticketBody(c); return c.json(await ctx.workflow!.approve(c.req.param('id'), body.draftId, body)); });

  const memories = new MemoryStore(ctx.db);
  const memoryCaller = (c: Context) => { const caller = identify(c); if (!caller) throw unauthorized(); return caller; };
  const memoryKeys = (body: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(body).some(key => !allowed.includes(key))) throw new MemoryError('Unknown memory field; source and scope cannot be edited.');
  };
  app.get('/api/memory', c => {
    const caller = memoryCaller(c);
    const workspaceId = memories.workspace(c.req.query('workspaceId') ?? (caller.kind === 'agent' ? caller.agent.workspaceId : undefined));
    if (caller.kind === 'agent' && caller.agent.workspaceId !== workspaceId) throw forbidden('memory belongs to another workspace');
    const layer = c.req.query('layer');
    if (layer && !['project', 'role', 'task'].includes(layer)) throw new MemoryError('Unknown memory layer.');
    // Integrate reviews workspace role learnings; ordinary runs retain role isolation.
    const integrating = caller.kind === 'agent' && ctx.db.db.select().from(schema.roles).where(eq(schema.roles.id, caller.agent.roleId)).get()?.name === 'orchestrator' && ctx.db.db.select().from(schema.tasks).where(eq(schema.tasks.assigneeAgentId, caller.agent.id)).all().some(task => {
      const live = ctx.runner?.getLiveRunByTaskId(task.id);
      const state = ctx.workflow?.snapshot(task.boardId);
      return task.kind === 'phase' && task.creationPhase === 'integrate' && task.status === 'doing' &&
        state?.board.workspaceId === workspaceId && state.board.currentPhase === 'integrate' &&
        !!live && !live.exitReason && !ctx.runner?.isCancelling(task.id);
    });
    const entries = ctx.db.db.select().from(schema.memory).where(eq(schema.memory.workspaceId, workspaceId)).all().filter(entry => {
      if (layer && entry.layer !== layer) return false;
      if (caller.kind === 'human') return true;
      if (entry.layer === 'project') return true;
      if (entry.layer === 'role') return integrating || entry.roleId === caller.agent.roleId;
      const task = entry.taskId ? loadTask(entry.taskId) : undefined;
      return task?.assigneeAgentId === caller.agent.id || task?.reviewerAgentId === caller.agent.id;
    });
    return c.json({ entries });
  });
  app.post('/api/memory', async c => {
    const caller = memoryCaller(c); const body = await ticketBody(c);
    if (caller.kind === 'agent') {
      if ((body.layer !== undefined && body.layer !== 'role') || (body.roleId !== undefined && body.roleId !== caller.agent.roleId) || (body.workspaceId !== undefined && body.workspaceId !== caller.agent.workspaceId) || body.source !== undefined || body.taskId !== undefined) throw forbidden('agents can remember only their own role memory');
      memoryKeys(body, ['title', 'body', 'layer', 'roleId', 'workspaceId']);
      return c.json({ entry: memories.add({ ...body, layer: 'role', roleId: caller.agent.roleId, workspaceId: caller.agent.workspaceId }, `agent:${caller.agent.id}`) }, 201);
    }
    memoryKeys(body, ['workspaceId', 'layer', 'roleId', 'taskId', 'title', 'body']);
    return c.json({ entry: memories.add(body, 'human') }, 201);
  });
  app.patch('/api/memory/:id', async c => {
    const caller = memoryCaller(c); const body = await ticketBody(c);
    if (body.promote === true) {
      memoryKeys(body, ['promote', 'contextTaskId']);
      if (caller.kind === 'agent') {
        const actor = requireTicketCaller(c, { taskId: body.contextTaskId });
        const entry = memories.get(c.req.param('id'));
        if (actor.board?.currentPhase !== 'integrate' || actor.board.workspaceId !== entry.workspaceId) throw forbidden('only an active integrate Orchestrator can promote memory');
      }
      return c.json({ entry: memories.promote(c.req.param('id')) });
    }
    if (caller.kind !== 'human') throw forbidden('only humans can edit memory');
    memoryKeys(body, ['title', 'body']);
    return c.json({ entry: memories.edit(c.req.param('id'), body) });
  });
  app.delete('/api/memory/:id', c => {
    if (memoryCaller(c).kind !== 'human') throw forbidden('only humans can delete memory');
    memories.delete(c.req.param('id')); return c.json({ deleted: true });
  });

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
    });
  });

  // PRD line 369: SSE endpoint for live board events
  app.get('/api/board/:id/events', async (c) => {
    requireHuman(c);
    const boardId = c.req.param('id');

    return streamSSE(c, async (stream) => {
      // Send initial connection event
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ boardId, timestamp: new Date().toISOString() }),
      });

      const unsubscribe = ctx.eventBus.subscribeBoardEvents(boardId, async (event) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        } catch {
          // Stream may be closed
        }
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      // Keep connection open with periodic heartbeat
      while (!stream.aborted) {
        await stream.sleep(15000);
        try {
          await stream.writeSSE({ event: 'ping', data: 'keep-alive' });
        } catch {
          break;
        }
      }
    });
  });

  // PRD line 364: SSE endpoint for live agent run stream
  app.get('/api/runs/:id/stream', async (c) => {
    requireHuman(c);
    const runId = c.req.param('id');

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ runId, timestamp: new Date().toISOString() }),
      });

      const unsubscribe = ctx.eventBus.subscribeRunEvents(runId, async (event) => {
        try {
          await stream.writeSSE({
            event: event.type,
            data: JSON.stringify(event.data),
          });
        } catch {
          // Stream closed
        }
      });

      stream.onAbort(() => {
        unsubscribe();
      });

      while (!stream.aborted) {
        await stream.sleep(15000);
        try {
          await stream.writeSSE({ event: 'ping', data: 'keep-alive' });
        } catch {
          break;
        }
      }
    });
  });

  // PRD line 358: POST /api/tasks/:id/report
  app.post('/api/tasks/:id/report', async (c) => {
    const { agent, task } = requireAssignedAgent(c, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const message = body.message || 'Progress update';

    ctx.db.db
      .insert(schema.messages)
      .values({
        id: newMessageId(),
        taskId: task.id,
        fromAgentId: agent.id,
        type: 'comment',
        body: message,
        createdAt: new Date(),
      })
      .run();

    ctx.eventBus.publishBoardEvent(task.boardId, {
      type: 'task_progress',
      data: { taskId: task.id, message },
    });

    return c.json({ success: true, message: 'Progress recorded' });
  });

  // PRD line 361: POST /api/tasks/:id/done
  app.post('/api/tasks/:id/done', async (c) => {
    const { agent, task } = requireAssignedAgent(c, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    if (task.kind === 'phase') throw forbidden('use crew phase done for phase tasks');
    const result = body.result || 'Work completed';

    const liveRun = ctx.runner?.getLiveRunByTaskId(task.id);
    if (liveRun) {
      liveRun.exitReason = 'done';
    }

    const updatedTask = await ctx.scheduler.transitionTask(task.id, 'verifying', {
      reason: result,
      alongside: () =>
        ctx.db.db
          .insert(schema.messages)
          .values({
            id: newMessageId(),
            taskId: task.id,
            fromAgentId: agent.id,
            type: 'result',
            body: result,
            createdAt: new Date(),
          })
          .run(),
    });

    return c.json({ success: true, status: updatedTask.status });
  });

  // PRD line 362: POST /api/tasks/:id/review (D34, D35)
  app.post('/api/tasks/:id/review', async (c) => {
    const { agent, task } = requireReviewerAgent(c, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const action = body.action;

    if (action !== 'approve' && action !== 'changes') {
      return c.json({ error: 'Action must be approve or changes' }, 400);
    }

    if (task.status !== 'review') {
      return c.json({ error: `Task is not in review (current status: ${task.status})` }, 409);
    }

    const reviewRun = ctx.db.db
      .select()
      .from(schema.runs)
      .where(and(eq(schema.runs.taskId, task.id), eq(schema.runs.kind, 'review')))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`))
      .get();
    const lastRun = ctx.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, task.id))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`))
      .get();

    let runId = reviewRun?.id || lastRun?.id || ctx.runner?.getLiveRunByTaskId(task.id)?.id;
    if (!runId) {
      runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      ctx.db.db
        .insert(schema.runs)
        .values({
          id: runId,
          taskId: task.id,
          agentId: agent.id,
          adapter: agent.cliType,
          startedAt: new Date(),
          endedAt: new Date(),
          kind: 'review',
          exitReason: 'done',
        })
        .run();
    }

    const liveRun = ctx.runner?.getLiveRunByTaskId(task.id);
    if (liveRun) {
      liveRun.exitReason = 'done';
    }

    if (action === 'approve') {
      const vrId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      ctx.db.db
        .insert(schema.verificationResults)
        .values({
          id: vrId,
          runId,
          step: 'review',
          passed: true,
          output: body.feedback || 'Approved',
          createdAt: new Date(),
        })
        .run();

      ctx.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step',
        data: {
          taskId: task.id,
          step: 'review',
          passed: true,
        },
      });

      const updatedTask = await ctx.scheduler.transitionTask(task.id, 'merge-queue', {
        reason: body.feedback || 'Review approved',
        alongside: () => {
          ctx.db.db
            .update(schema.tasks)
            .set({ reviewerAgentId: null })
            .where(eq(schema.tasks.id, task.id))
            .run();
          ctx.db.db
            .update(schema.agents)
            .set({ status: 'idle' })
            .where(eq(schema.agents.id, agent.id))
            .run();
        },
      });

      return c.json({ success: true, status: updatedTask.status });
    } else {
      // action === 'changes'
      const feedback = body.feedback || 'Changes requested';
      const vrId = 'vr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
      ctx.db.db
        .insert(schema.verificationResults)
        .values({
          id: vrId,
          runId,
          step: 'review',
          passed: false,
          output: feedback,
          createdAt: new Date(),
        })
        .run();

      ctx.eventBus.publishBoardEvent(task.boardId, {
        type: 'verification_step',
        data: {
          taskId: task.id,
          step: 'review',
          passed: false,
        },
      });

      const updatedTask = await ctx.scheduler.transitionTask(task.id, 'doing', {
        reason: feedback,
        alongside: () => {
          ctx.db.db
            .insert(schema.messages)
            .values({
              id: newMessageId(),
              taskId: task.id,
              fromAgentId: agent.id,
              type: 'feedback',
              body: feedback,
              createdAt: new Date(),
            })
            .run();
          ctx.db.db
            .update(schema.tasks)
            .set({ reviewerAgentId: null })
            .where(eq(schema.tasks.id, task.id))
            .run();
          ctx.db.db
            .update(schema.agents)
            .set({ status: 'idle' })
            .where(eq(schema.agents.id, agent.id))
            .run();
        },
      });

      return c.json({ success: true, status: updatedTask.status });
    }
  });

  // PRD line 359: POST /api/tasks/:id/question
  app.post('/api/tasks/:id/question', async (c) => {
    const { agent, task } = requireAssignedAgent(c, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const question = body.question;

    if (!question) {
      return c.json({ error: 'Question body is required' }, 400);
    }

    const liveRun = ctx.runner?.getLiveRunByTaskId(task.id);
    if (liveRun) {
      liveRun.exitReason = 'asked';
    }

    const updatedTask = await ctx.scheduler.transitionTask(task.id, 'blocked', {
      reason: question,
      alongside: () =>
        ctx.db.db
          .insert(schema.messages)
          .values({
            id: newMessageId(),
            taskId: task.id,
            fromAgentId: agent.id,
            type: 'question',
            body: question,
            createdAt: new Date(),
          })
          .run(),
    });

    return c.json({ success: true, status: updatedTask.status });
  });

  // GET /api/tasks/:id: the human, or the agent the task is assigned to
  app.get('/api/tasks/:id', async (c) => {
    const taskId = c.req.param('id');
    const caller = identify(c);
    if (!caller) throw unauthorized();

    const task = loadTask(taskId);
    if (caller.kind === 'agent' && task.assigneeAgentId !== caller.agent.id) {
      throw forbidden(`task ${taskId} is not assigned to this agent`);
    }

    const messages = ctx.db.db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.taskId, taskId))
      .orderBy(asc(schema.messages.createdAt))
      .all();
    const runs = ctx.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(asc(schema.runs.startedAt), asc(sql`${schema.runs}.rowid`))
      .all();

    const runIds = runs.map((r) => r.id);
    const verificationResults =
      runIds.length > 0
        ? ctx.db.db
            .select()
            .from(schema.verificationResults)
            .where(inArray(schema.verificationResults.runId, runIds))
            .orderBy(asc(schema.verificationResults.createdAt))
            .all()
        : [];

    const dependencies = ctx.db.db.select().from(schema.taskDependencies).where(eq(schema.taskDependencies.taskId, taskId)).all();
    const commits: { sha: string; subject?: string; source: 'branch' | 'merge' }[] = [];
    const merge = ctx.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, taskId)).get();
    if (merge?.commitSha) commits.push({ sha: merge.commitSha, source: 'merge' });
    if (task.worktreePath && fs.existsSync(task.worktreePath)) {
      const board = ctx.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get()!;
      const workspace = ctx.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()!;
      const log = await execa('git', ['log', '--format=%H%x00%s', `${workspace.defaultBranch}..HEAD`, '--'], { cwd: task.worktreePath, reject: false });
      if (log.exitCode === 0) for (const line of log.stdout.split('\n').filter(Boolean)) {
        const [sha, subject] = line.split('\0');
        commits.push({ sha, subject, source: 'branch' });
      }
    }
    return c.json({ success: true, task, messages, runs: runs.map(run => {
      const agent = ctx.db.db.select({ id: schema.agents.id, name: schema.agents.name }).from(schema.agents).where(eq(schema.agents.id, run.agentId)).get();
      return { ...run, agent: agent ?? null };
    }), verificationResults, dependencies, commits });
  });

  // PRD line 370: POST /api/tasks/:id/answer (human secret)
  app.post('/api/tasks/:id/answer', async (c) => {
    requireHuman(c);
    const taskId = c.req.param('id');
    const task = loadTask(taskId);
    const body = await c.req.json().catch(() => ({}));
    const answer = body.answer;

    if (!answer) {
      return c.json({ error: 'Answer body is required' }, 400);
    }

    if (task.status !== 'blocked') {
      return c.json({ error: `Task ${taskId} is not blocked (status: ${task.status})` }, 409);
    }

    const updatedTask = await ctx.scheduler.transitionTask(task.id, 'doing', {
      reason: answer,
      alongside: () =>
        ctx.db.db
          .insert(schema.messages)
          .values({
            id: newMessageId(),
            taskId: task.id,
            fromAgentId: null,
            type: 'answer',
            body: answer,
            createdAt: new Date(),
          })
          .run(),
    });

    if (ctx.runner) {
      ctx.runner.resumeTask(task.id, answer).catch((err) => {
        console.error(`Failed to resume task ${task.id}:`, err);
      });
    }

    return c.json({ success: true, status: updatedTask.status });
  });

  // D44: the generic task transition API has no human retry capability.
  app.post('/api/tasks/:id/retry', async (c) => {
    requireHuman(c);
    const body = await c.req.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Expected an object with an optional note' }, 400);
    if (body.note !== undefined && typeof body.note !== 'string') return c.json({ error: 'note must be a string' }, 400);
    const original = loadTask(c.req.param('id'));
    const task = original.kind === 'phase' && original.status === 'cancelled'
      ? await ctx.workflow!.retryCancelled(original.id, body.note as string | undefined)
      : await ctx.scheduler.retryTaskByHuman(original.id, body.note as string | undefined);
    return c.json({ success: true, taskId: task.id, status: task.status, retries: task.retries });
  });

  const queueSnapshot = () => {
    const tasks = new Map(ctx.db.db.select().from(schema.tasks).all().map(t => [t.id, t]));
    const boards = new Map(ctx.db.db.select().from(schema.boards).all().map(b => [b.id, b]));
    const items = ctx.db.db.select().from(schema.mergeQueueItems).orderBy(asc(schema.mergeQueueItems.position)).all()
      .filter(item => item.status !== 'merged' && tasks.get(item.taskId)?.status !== 'cancelled')
      .map(item => {
        const task = tasks.get(item.taskId)!;
        return { ...item, title: task.title, taskStatus: task.status, workspaceId: boards.get(task.boardId)!.workspaceId };
      });
    return {
      items,
      warnings: [...(ctx.mergeQueue?.warnings ?? [])].map(([workspaceId, message]) => ({ workspaceId, message })),
      stopped: ctx.dispatcher?.isStopped() ?? false,
    };
  };

  app.get('/api/merge-queue', (c) => {
    requireHuman(c);
    return c.json(queueSnapshot());
  });

  // PRD line 375: POST /api/tasks/:id/cancel (human secret)
  app.post('/api/tasks/:id/cancel', async (c) => {
    requireHuman(c);
    const taskId = c.req.param('id');
    const task = loadTask(taskId);

    const cancel = async (id: string): Promise<typeof schema.tasks.$inferSelect> => {
      const child = ctx.db.db.select().from(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, id)).get()?.conflictTaskId;
      try {
        await ctx.mergeQueue?.cancelTask(id);
        // A ref update that won the race is a completed merge, not lost work.
        if (loadTask(id).status === 'merged') return loadTask(id);
        await ctx.worktreeManager?.cancelSetup(id);
        await ctx.verifier?.cancelTask(id);
        await ctx.runner?.killTaskRun(id, 'cancelled');
        const updated = await ctx.scheduler.transitionTask(id, 'cancelled', {
          reason: 'Cancelled by human',
          alongside: () => ctx.db.db.delete(schema.mergeQueueItems).where(eq(schema.mergeQueueItems.taskId, id)).run(),
        });
        if (child && !['merged', 'cancelled'].includes(loadTask(child).status)) await cancel(child);
        return updated;
      } finally {
        ctx.runner?.endCancel(id);
        ctx.mergeQueue?.endCancel(id);
      }
    };
    const updatedTask = await cancel(task.id);

    return c.json({ success: true, status: updatedTask.status });
  });

  // POST /api/worktrees/gc (human secret)
  app.post('/api/worktrees/gc', async (c) => {
    requireHuman(c);
    if (!ctx.worktreeManager) {
      return c.json({ success: true, removed: [] });
    }
    const removed = await ctx.worktreeManager.gc();
    return c.json({ success: true, removed });
  });

  // PRD line 376: POST /api/control/stop-all (human secret)
  app.post('/api/control/stop-all', async (c) => {
    requireHuman(c);

    // 1. Pause dispatcher
    ctx.dispatcher?.setStopped(true);

    // Mark the merge worker interrupted before setup cancellation can finish its job.
    await Promise.all([
      ctx.mergeQueue?.stopAll(),
      ctx.worktreeManager?.stopAllSetup(),
      ctx.verifier?.stopAll(),
    ]);

    // 3. Kill all live runs with exitReason: 'stopped'
    const stoppedRuns = ctx.runner ? await ctx.runner.killAll('stopped') : 0;

    // 4. Mark active/busy/idle agents as stopped
    ctx.db.db
      .update(schema.agents)
      .set({ status: 'stopped' })
      .where(inArray(schema.agents.status, ['idle', 'busy']))
      .run();

    ctx.eventBus.publishBoardEvent('*', { type: 'control_changed', data: { stopped: true } });
    return c.json({
      success: true,
      stoppedRuns,
      message: `Stopped ${stoppedRuns} live runs and paused dispatch`,
    });
  });

  // PRD line 377: POST /api/control/resume (human secret)
  app.post('/api/control/resume', async (c) => {
    requireHuman(c);
    ctx.worktreeManager?.resumeSetup();

    // 1. Unmark agents that were stopped back to idle
    ctx.db.db
      .update(schema.agents)
      .set({ status: 'idle' })
      .where(eq(schema.agents.status, 'stopped'))
      .run();

    for (const board of ctx.db.db.select().from(schema.boards).all()) await ctx.workflow?.ensureBoard(board.id).catch(error => console.error(`Workflow ${board.id}: ${error.message}`));

    // 2. Unpause dispatcher
    ctx.dispatcher?.setStopped(false);

    // 3. Resume verifier pipelines
    ctx.verifier?.resume();
    ctx.mergeQueue?.resume();

    // 4. Trigger immediate dispatch pass
    ctx.dispatcher?.scheduleDispatch();

    ctx.eventBus.publishBoardEvent('*', { type: 'control_changed', data: { stopped: false } });
    return c.json({
      success: true,
      message: 'Dispatch resumed and stopped agents restored to idle',
    });
  });

  // PRD: GET /api/status (human secret)
  app.get('/api/status', async (c) => {
    requireHuman(c);

    const isStopped = ctx.dispatcher ? ctx.dispatcher.isStopped() : false;
    const agents = ctx.db.db.select().from(schema.agents).all();
    const liveRuns = ctx.runner
      ? ctx.runner.getLiveRuns().map((r) => ({
          id: r.id,
          taskId: r.taskId,
          agentId: r.agentId,
          sessionId: r.sessionId,
          pid: r.pid,
        }))
      : [];
    const rateLimits = ctx.runner ? ctx.runner.getAllRateLimits() : [];

    const tasks = ctx.db.db.select().from(schema.tasks).all();
    const taskCounts: Record<string, number> = {};
    for (const t of tasks) {
      taskCounts[t.status] = (taskCounts[t.status] || 0) + 1;
    }

    const verifyingTasks = tasks
      .filter((t) => t.status === 'verifying')
      .map((t) => ({ id: t.id, title: t.title }));
    const reviewTasks = tasks
      .filter((t) => t.status === 'review')
      .map((t) => ({ id: t.id, title: t.title, reviewerAgentId: t.reviewerAgentId }));

    const queue = queueSnapshot();
    return c.json({
      stopped: isStopped,
      phases: ctx.db.db.select().from(schema.boards).all().map(board => {
        const state = ctx.workflow!.snapshot(board.id);
        const ticketCounts: Record<string, number> = {};
        if (board.currentPhase === 'dispatch') {
          for (const task of tasks.filter(task => task.boardId === board.id && task.kind === 'work')) {
            ticketCounts[task.status] = (ticketCounts[task.status] || 0) + 1;
          }
        }
        const workspace = ctx.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get();
        const config = (workspace?.config ?? {}) as { maxParallelAgents?: number; maxRetries?: number; maxRuntimeMs?: number };
        const limits = { maxParallelAgents: config.maxParallelAgents ?? ctx.dispatcher?.maxParallelAgents ?? 3, maxRetries: config.maxRetries ?? 3, maxRuntimeMs: config.maxRuntimeMs ?? 1800000 };
        return { boardId: board.id, phase: board.currentPhase, draftId: state.draft?.id, taskId: state.task?.id, status: state.task?.status, problem: state.problem, ticketCounts, limits };
      }),
      roles: ctx.db.db.select({ id: schema.roles.id, name: schema.roles.name }).from(schema.roles).all(),
      mergeQueue: { pending: queue.items.filter(i => i.taskStatus === 'merge-queue').length, warnings: queue.warnings },
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        cliType: a.cliType,
        status: a.status,
      })),
      liveRuns,
      rateLimits,
      taskCounts,
      totalTasks: tasks.length,
      verifyingTasks,
      reviewTasks,
    });
  });

  // PRD line 374: GET /api/tasks (human secret)
  app.get('/api/tasks', async (c) => {
    requireHuman(c);
    const allTasks = ctx.db.db
      .select()
      .from(schema.tasks)
      .orderBy(asc(schema.tasks.createdAt))
      .all();

    const allAgents = ctx.db.db.select().from(schema.agents).all();
    const agentMap = new Map(allAgents.map((a) => [a.id, a.name]));

    const tasksWithAgent = allTasks.map((t) => ({
      ...t,
      assigneeAgentName: t.assigneeAgentId ? agentMap.get(t.assigneeAgentId) : undefined,
    }));

    return c.json({ tasks: tasksWithAgent });
  });

  // PRD line 373: GET /api/tasks/:id/diff (human secret)
  app.get('/api/tasks/:id/diff', async (c) => {
    requireHuman(c);
    const taskId = c.req.param('id');
    const task = loadTask(taskId);

    if (!task.worktreePath || !fs.existsSync(task.worktreePath)) {
      return c.json({ diff: '', branch: task.branch || '', error: 'No worktree exists for this task' });
    }

    const board = ctx.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
    const workspace = board
      ? ctx.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get()
      : undefined;
    const baseBranch = workspace?.defaultBranch || 'main';

    try {
      await execa('git', ['add', '-N', '.'], { cwd: task.worktreePath, reject: false });
      const diffResult = await execa('git', ['diff', baseBranch], {
        cwd: task.worktreePath,
        reject: false,
      });
      return c.json({
        diff: diffResult.stdout || '',
        branch: task.branch,
        baseBranch,
      });
    } catch (err: any) {
      return c.json({ diff: '', error: err.message }, 500);
    }
  });

  // GET /api/tasks/:id/logs (human secret)
  app.get('/api/tasks/:id/logs', async (c) => {
    requireHuman(c);
    const taskId = c.req.param('id');
    loadTask(taskId);

    const tail = logTailBytes(c.req.query('tail'));
    const runId = c.req.query('run');
    const run = ctx.db.db.select().from(schema.runs)
      .where(runId !== undefined ? and(eq(schema.runs.taskId, taskId), eq(schema.runs.id, runId)) : eq(schema.runs.taskId, taskId))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`)).get();
    if (runId !== undefined && !run) return c.json({ error: 'Run not found for this task. Run crew logs <task> --list to choose one of its run IDs.' }, 404);
    if (!run) return c.json({ content: '', logPath: null, runId: null, missing: false, truncated: false, offset: 0 });
    return c.json({ ...readRunLog(crewHome, run.logPath, tail), logPath: run.logPath,
      runId: run.id, exitReason: run.exitReason, exitCode: run.exitCode });
  });

  app.get('*', c => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) return c.notFound();
    return serveBoard(c);
  });

  return app;
}
