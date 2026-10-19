import { eq } from 'drizzle-orm';
import { type Context, Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { streamSSE } from 'hono/streaming';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { EventBus } from '../events/index.js';
import {
  DependencyCycleError,
  InvalidTransitionError,
  type Scheduler,
  type Task,
  TaskNotFoundError,
} from '../scheduler/index.js';
import type { WorktreeManager } from '../worktree/index.js';
import type { Runner } from '../runner/index.js';
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
  worktreeManager?: WorktreeManager;
  runner?: Runner;
}

type Agent = typeof schema.agents.$inferSelect;

type Caller = { kind: 'human' } | { kind: 'agent'; agent: Agent };

function newMessageId(): string {
  return 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  // D13: Host-header validation middleware on all routes
  app.use('*', hostHeaderMiddleware());

  app.onError((err, c) => {
    if (err instanceof HTTPException) return err.getResponse();
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
      res: Response.json({ error: 'Unauthorized: missing or invalid credentials (D13)' }, { status: 401 }),
    });

  const forbidden = (message: string) =>
    new HTTPException(403, { res: Response.json({ error: `Forbidden: ${message}` }, { status: 403 }) });

  const requireHuman = (c: Context): void => {
    if (identify(c)?.kind !== 'human') throw unauthorized();
  };

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
    const result = body.result || 'Work completed';

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

  // PRD line 359: POST /api/tasks/:id/question
  app.post('/api/tasks/:id/question', async (c) => {
    const { agent, task } = requireAssignedAgent(c, c.req.param('id'));
    const body = await c.req.json().catch(() => ({}));
    const question = body.question;

    if (!question) {
      return c.json({ error: 'Question body is required' }, 400);
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

    return c.json({ success: true, task });
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

  // PRD line 375: POST /api/tasks/:id/cancel (human secret)
  app.post('/api/tasks/:id/cancel', async (c) => {
    requireHuman(c);
    const taskId = c.req.param('id');
    const task = loadTask(taskId);

    const updatedTask = await ctx.scheduler.transitionTask(task.id, 'cancelled', {
      reason: 'Cancelled by human',
    });

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

  return app;
}
