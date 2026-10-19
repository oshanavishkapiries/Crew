import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import { EventBus, getEventBus } from '../events/index.js';
import { Scheduler } from '../scheduler/index.js';
import { hostHeaderMiddleware } from './security.js';

export interface AppContext {
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  perStartSecret: string;
}

export function createApp(ctx: AppContext): Hono {
  const app = new Hono();

  // D13: Host-header validation middleware on all routes
  app.use('*', hostHeaderMiddleware());

  // Health check endpoint
  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
    });
  });

  // PRD line 369: SSE endpoint for live board events
  app.get('/api/board/:id/events', async (c) => {
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
    const taskId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const message = body.message || 'Progress update';

    const task = ctx.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (!task) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    ctx.db.db
      .insert(schema.messages)
      .values({
        id: msgId,
        taskId,
        fromAgentId: task.assigneeAgentId,
        type: 'comment',
        body: message,
        createdAt: new Date(),
      })
      .run();

    ctx.eventBus.publishBoardEvent(task.boardId, {
      type: 'task_progress',
      data: { taskId, message },
    });

    return c.json({ success: true, message: 'Progress recorded' });
  });

  // PRD line 361: POST /api/tasks/:id/done
  app.post('/api/tasks/:id/done', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const result = body.result || 'Work completed';

    const task = ctx.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (!task) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    ctx.db.db
      .insert(schema.messages)
      .values({
        id: msgId,
        taskId,
        fromAgentId: task.assigneeAgentId,
        type: 'result',
        body: result,
        createdAt: new Date(),
      })
      .run();

    const updatedTask = await ctx.scheduler.transitionTask(taskId, 'verifying', {
      reason: result,
    });

    return c.json({ success: true, status: updatedTask.status });
  });

  // PRD line 359: POST /api/tasks/:id/question
  app.post('/api/tasks/:id/question', async (c) => {
    const taskId = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const question = body.question;

    if (!question) {
      return c.json({ error: 'Question body is required' }, 400);
    }

    const task = ctx.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (!task) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    ctx.db.db
      .insert(schema.messages)
      .values({
        id: msgId,
        taskId,
        fromAgentId: task.assigneeAgentId,
        type: 'question',
        body: question,
        createdAt: new Date(),
      })
      .run();

    const updatedTask = await ctx.scheduler.transitionTask(taskId, 'blocked', {
      reason: question,
    });

    return c.json({ success: true, status: updatedTask.status });
  });

  // GET /api/tasks/:id
  app.get('/api/tasks/:id', async (c) => {
    const taskId = c.req.param('id');
    const task = ctx.db.db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .get();

    if (!task) {
      return c.json({ error: `Task not found: ${taskId}` }, 404);
    }

    return c.json({ success: true, task });
  });

  return app;
}
