import { getHumanAction } from '../client.js';

interface TaskItem {
  id: string;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  assigneeAgentName?: string | null;
  retries: number;
}

export async function handleTasks(): Promise<void> {
  const data = await getHumanAction<{ tasks: TaskItem[] }>('/api/tasks');

  if (data.tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }

  console.log(
    `${'ID'.padEnd(24)} ${'STATUS'.padEnd(14)} ${'RETRIES'.padEnd(8)} ${'ASSIGNEE'.padEnd(20)} TITLE`,
  );
  console.log('-'.repeat(80));

  for (const task of data.tasks) {
    const assignee = task.assigneeAgentName || task.assigneeAgentId || '-';
    console.log(
      `${task.id.padEnd(24)} ${task.status.padEnd(14)} ${String(task.retries).padEnd(8)} ${assignee.padEnd(20)} ${task.title}`,
    );
  }
}
