import * as fs from 'node:fs';
import { sql, eq, inArray, desc, asc, and } from 'drizzle-orm';
import { execa } from 'execa';
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
  worktreeManager?: WorktreeManager;
  runner?: Runner;
  dispatcher?: Dispatcher;
  verifier?: Verifier;
  mergeQueue?: MergeQueue;
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
      .orderBy(asc(schema.runs.startedAt))
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

    return c.json({ success: true, task, messages, runs, verificationResults });
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

    // 2. Unpause dispatcher
    ctx.dispatcher?.setStopped(false);

    // 3. Resume verifier pipelines
    ctx.verifier?.resume();
    ctx.mergeQueue?.resume();

    // 4. Trigger immediate dispatch pass
    ctx.dispatcher?.scheduleDispatch();

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

    return c.json({
      stopped: isStopped,
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
    const task = loadTask(taskId);

    const lastRun = ctx.db.db
      .select()
      .from(schema.runs)
      .where(eq(schema.runs.taskId, taskId))
      .orderBy(desc(schema.runs.startedAt), desc(sql`${schema.runs}.rowid`))
      .get();

    if (!lastRun) {
      return c.json({ content: '', logPath: null, runId: null });
    }

    let content = '';
    if (lastRun.logPath && fs.existsSync(lastRun.logPath)) {
      content = fs.readFileSync(lastRun.logPath, 'utf-8');
    }

    return c.json({
      content,
      logPath: lastRun.logPath,
      runId: lastRun.id,
      exitReason: lastRun.exitReason,
      exitCode: lastRun.exitCode,
    });
  });

  return app;
}
