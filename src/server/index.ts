import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './api/app.js';
import { generatePerStartSecret } from './api/security.js';
import { createCrewDatabase, getDb, type CrewDatabase } from './db/index.js';
import { getEventBus, type EventBus } from './events/index.js';
import { Scheduler, Dispatcher } from './scheduler/index.js';
import { WorktreeManager } from './worktree/index.js';
import { Runner } from './runner/index.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  db?: CrewDatabase;
  eventBus?: EventBus;
  scheduler?: Scheduler;
  worktreeManager?: WorktreeManager;
  runner?: Runner;
  dispatcher?: Dispatcher;
  startDispatcher?: boolean;
  maxParallelAgents?: number;
}

export interface RunningServer {
  server: Server;
  port: number;
  host: string;
  url: string;
  perStartSecret: string;
  db: CrewDatabase;
  eventBus: EventBus;
  scheduler: Scheduler;
  worktreeManager: WorktreeManager;
  runner: Runner;
  dispatcher: Dispatcher;
  close: () => Promise<void>;
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const host = options.host || '127.0.0.1';
  const port = options.port !== undefined ? options.port : 4000;
  const db = options.db || getDb();
  const eventBus = options.eventBus || getEventBus();
  const worktreeManager = options.worktreeManager || new WorktreeManager(db);
  const scheduler = options.scheduler || new Scheduler(db, eventBus, { worktreeManager });
  const perStartSecret = generatePerStartSecret();

  const app = createApp({
    db,
    eventBus,
    scheduler,
    worktreeManager,
    perStartSecret,
  });

  return new Promise((resolve, reject) => {
    try {
      const server = serve(
        {
          fetch: app.fetch,
          port,
          hostname: host,
        },
        (info) => {
          const addr = (server as any).address?.();
          const actualPort = addr?.port ?? info.port;
          const url = `http://${host}:${actualPort}`;

          const runner =
            options.runner ||
            new Runner({
              db,
              eventBus,
              scheduler,
              serverUrl: url,
            });

          const dispatcher =
            options.dispatcher ||
            new Dispatcher({
              db,
              scheduler,
              runner,
              eventBus,
              maxParallelAgents: options.maxParallelAgents ?? 3,
            });

          if (options.startDispatcher) {
            dispatcher.start();
          }

          resolve({
            server: server as unknown as Server,
            port: actualPort,
            host,
            url,
            perStartSecret,
            db,
            eventBus,
            scheduler,
            worktreeManager,
            runner,
            dispatcher,
            close: () =>
              new Promise<void>((res, rej) => {
                dispatcher.stop();
                server.close((err) => {
                  if (err) rej(err);
                  else res();
                });
              }),
          });
        },
      );
    } catch (err) {
      reject(err);
    }
  });
}
