import { postTaskAction } from '../client.js';

export async function handleDone(options: { result?: string } = {}): Promise<void> {
  const data = await postTaskAction<{ status: string; instruction?: string }>('done', 'done', {
    result: options.result || 'Task completed',
  });
  if (data.instruction) console.log(data.instruction);
  console.log(`Task submitted for verification. Current status: ${data.status}`);
}
