import { postHumanAction } from '../client.js';

export async function handleAnswer(task: string, response: string): Promise<void> {
  const data = await postHumanAction<{ success: boolean; status: string }>(
    `/api/tasks/${encodeURIComponent(task)}/answer`,
    { answer: response },
  );
  console.log(`Answer sent for task ${task}. Current status: ${data.status}`);
}
