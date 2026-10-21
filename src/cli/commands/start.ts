import { getDb } from '../../server/db/index.js';
import { loadWorkspaceConfigs } from '../../server/project-config.js';
import { startServer } from '../../server/index.js';
import { anotherServerIsRunning, reapStaleRuns } from '../../server/runner/reaper.js';

export async function handleStart(options: { port?: string | number; host?: string }): Promise<void> {
  const port = options.port ? Number(options.port) : 4000;
  const host = options.host || '127.0.0.1';

  const db = getDb();
  await loadWorkspaceConfigs(db);
  // D77: a previous server that died abruptly may have left agents running.
  // Never reap while another server still owns the runs.
  const reaped = anotherServerIsRunning() ? { killed: 0, ended: 0 } : reapStaleRuns(db);
  if (reaped.ended > 0) console.log(`Ended ${reaped.ended} unfinished run(s) from a previous server; stopped ${reaped.killed} stray agent process(es).`);

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
