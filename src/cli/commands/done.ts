import { postTaskAction } from '../client.js';

export async function handleDone(options: { result?: string } = {}): Promise<void> {
  const data = await postTaskAction<{ status: string }>('done', 'done', {
    result: options.result || 'Task completed',
  });
  console.log(`Task submitted for verification. Current status: ${data.status}`);
}
