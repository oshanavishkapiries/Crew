import { postHumanAction } from '../client.js';

export async function handleStopAll(): Promise<void> {
  const data = await postHumanAction<{ success: boolean; stoppedRuns: number; message: string }>(
    '/api/control/stop-all',
  );
  console.log(data.message || `Stopped ${data.stoppedRuns} running processes.`);
}
