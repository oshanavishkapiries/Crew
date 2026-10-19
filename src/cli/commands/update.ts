import { postTaskAction } from '../client.js';

export async function handleUpdate(message: string): Promise<void> {
  await postTaskAction('update', 'report', { message });
  console.log(`Update reported: "${message}"`);
}
