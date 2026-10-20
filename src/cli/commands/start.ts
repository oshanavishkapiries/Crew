import { getDb } from '../../server/db/index.js';
import { loadWorkspaceConfigs } from '../../server/project-config.js';
import { startServer } from '../../server/index.js';

export async function handleStart(options: { port?: string | number; host?: string }): Promise<void> {
  const port = options.port ? Number(options.port) : 4000;
  const host = options.host || '127.0.0.1';

  const db = getDb();
  await loadWorkspaceConfigs(db);

  console.log(`Starting Crew server on ${host}:${port}...`);
  const running = await startServer({ port, host, db, startDispatcher: true, startVerifier: true, startMergeQueue: true, startWorkflow: true });

  console.log(`Crew server listening at ${running.url}`);
  console.log(`Task Board available at ${running.url}`);

  // Keep process running until SIGINT/SIGTERM
  const shutdown = async () => {
    console.log('\nShutting down Crew server...');
    await running.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
