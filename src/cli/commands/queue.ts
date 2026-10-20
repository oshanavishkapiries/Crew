import { getHumanAction } from '../client.js';

export async function handleQueue(): Promise<void> {
  const queue = await getHumanAction<{
    stopped: boolean;
    items: Array<{ position: number; taskId: string; title: string; status: string; workspaceId: string; conflictTaskId?: string | null; output?: string | null }>;
    warnings: Array<{ workspaceId: string; message: string }>;
  }>('/api/merge-queue');
  console.log(`Merge queue${queue.stopped ? ' (stopped)' : ''}:`);
  for (const warning of queue.warnings) console.log(`  ${warning.workspaceId}: ${warning.message}`);
  if (!queue.items.length) console.log('  Empty');
  for (const item of queue.items) {
    console.log(`  ${item.position}. ${item.taskId} [${item.status}] ${item.title} (${item.workspaceId})`);
    if (item.conflictTaskId) console.log(`     Conflict sub-task: ${item.conflictTaskId}`);
    if (item.status === 'failed' && item.output) console.log(`     ${item.output}`);
  }
}
