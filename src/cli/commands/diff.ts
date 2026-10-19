import { getHumanAction } from '../client.js';

interface DiffResponse {
  diff: string;
  branch?: string;
  baseBranch?: string;
  error?: string;
}

export async function handleDiff(taskId: string): Promise<void> {
  const data = await getHumanAction<DiffResponse>(`/api/tasks/${encodeURIComponent(taskId)}/diff`);

  if (data.error) {
    console.error(data.error);
    process.exitCode = 1;
    return;
  }

  if (!data.diff.trim()) {
    console.log(`No changes in ${taskId} against ${data.baseBranch || 'main'}.`);
    return;
  }

  process.stdout.write(data.diff);
  if (!data.diff.endsWith('\n')) {
    process.stdout.write('\n');
  }
}
