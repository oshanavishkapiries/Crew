import { postHumanAction } from '../client.js';

export async function handleCancel(taskId: string): Promise<void> {
  const data = await postHumanAction<{ success: boolean; status: string }>(
    `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
  );
  console.log(`Task ${taskId} is now ${data.status}.`);
}
