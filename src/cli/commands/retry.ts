import { postHumanAction } from '../client.js';

export async function handleRetry(taskId: string, options: { note?: string }): Promise<void> {
  const result = await postHumanAction<{ status: string; retries: number }>(
    `/api/tasks/${encodeURIComponent(taskId)}/retry`, { note: options.note },
  );
  console.log(`Task ${taskId} is now ${result.status} (retries: ${result.retries}).`);
}
