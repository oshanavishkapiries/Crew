import { postWorkflowAction } from '../client.js';

export async function handleTicket(action: string, options: Record<string, string | undefined>): Promise<void> {
  if (action !== 'create') throw new Error('Use crew ticket create.');
  const { task } = await postWorkflowAction<{ task: unknown }>('/api/tasks', {
    boardId: options.board, phase: options.phase, title: options.title, description: options.description,
    acceptanceCriteria: options.criteria, role: options.role, assignee: options.assignee,
    blockedByIds: options.blockedBy?.split(',').map(id => id.trim()).filter(Boolean),
  });
  console.log(JSON.stringify(task, null, 2));
}

export async function handleAssign(assignee: string, taskId: string): Promise<void> {
  const { task } = await postWorkflowAction<{ task: unknown }>(`/api/tasks/${encodeURIComponent(taskId)}/assign`, { assignee });
  console.log(JSON.stringify(task, null, 2));
}
