import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { createApp } from './api/app.js';
import { generatePerStartSecret } from './api/security.js';
import { getCrewHome } from './config.js';
import { createCrewDatabase, getDb, type CrewDatabase } from './db/index.js';
import { getEventBus, type EventBus } from './events/index.js';
import { Scheduler, Dispatcher } from './scheduler/index.js';
import { WorktreeManager } from './worktree/index.js';
import { Runner } from './runner/index.js';
import { MergeQueue } from './merge/index.js';
import { Verifier } from './verify/index.js';

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
  verifier?: Verifier;
  startVerifier?: boolean;
  startMergeQueue?: boolean;
  maxParallelVerifications?: number;
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
  verifier: Verifier;
  mergeQueue: MergeQueue;
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

  const runner =
    options.runner ||
    new Runner({
      db,
      eventBus,
      scheduler,
      serverUrl: `http://${host}:${port}`,
    });

  const dispatcher =
    options.dispatcher ||
    new Dispatcher({
      db,
      scheduler,
      runner,
      eventBus,
      maxParallelAgents: options.maxParallelAgents,
    });

  const verifier =
    options.verifier ||
    new Verifier({
      db,
      eventBus,
      scheduler,
      worktreeManager,
      runner,
      maxParallelVerifications: options.maxParallelVerifications,
    });

  const mergeQueue = new MergeQueue({ db, eventBus, scheduler, worktreeManager });

  const app = createApp({
    db,
    eventBus,
    scheduler,
    worktreeManager,
    runner,
    dispatcher,
    verifier,
    mergeQueue,
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
          runner.setServerUrl(url);

          const crewHome = getCrewHome();
          const serverJsonPath = path.join(crewHome, 'server.json');
          try {
            if (!fs.existsSync(crewHome)) {
              fs.mkdirSync(crewHome, { recursive: true });
            }
            fs.writeFileSync(
              serverJsonPath,
              JSON.stringify({ url, secret: perStartSecret, pid: process.pid }, null, 2),
              { mode: 0o600 },
            );
          } catch {
            // ignore
          }

          if (options.startDispatcher) {
            dispatcher.start();
          }

          if (options.startVerifier) {
            verifier.start();
          }

          if (options.startMergeQueue) mergeQueue.start();

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
            verifier,
            mergeQueue,
            close: () =>
              new Promise<void>((res, rej) => {
                try {
                  if (fs.existsSync(serverJsonPath)) {
                    fs.unlinkSync(serverJsonPath);
                  }
                } catch {}
                dispatcher.stop();
                verifier.stop();
                Promise.all([mergeQueue.stop(), worktreeManager.stopAllSetup()]).then(() => {
                  server.close((err) => {
                    if (err) rej(err);
                    else res();
                  });
                }, rej);
              }),
          });
        },
      );
    } catch (err) {
      reject(err);
    }
  });
}
