import { postTaskAction } from '../client.js';

export async function handleAsk(question: string): Promise<void> {
  const data = await postTaskAction<{ status: string }>('ask', 'question', { question });
  console.log(`Question submitted. Current status: ${data.status}`);
}
