import { postHumanAction } from '../client.js';

export async function handleResume(): Promise<void> {
  const data = await postHumanAction<{ success: boolean; message: string }>(
    '/api/control/resume',
  );
  console.log(data.message || 'Dispatching resumed.');
}
