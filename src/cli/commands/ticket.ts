import { postHumanAction, postWorkflowAction } from '../client.js';

export async function handleTicket(action: string, taskId: string | undefined, options: Record<string, string | undefined>): Promise<void> {
  if (action === 'edit') {
    if (!taskId) throw new Error('Use crew ticket edit <task> [fields].');
    const { task } = await postHumanAction<{ task: unknown }>(`/api/tasks/${encodeURIComponent(taskId)}`, {
      title: options.title, description: options.description, acceptanceCriteria: options.criteria,
      role: options.role, assignee: options.assignee,
      blockedByIds: options.blockedBy?.split(',').map(id => id.trim()).filter(Boolean),
    }, 'PATCH');
    console.log(JSON.stringify(task, null, 2)); return;
  }
  if (action !== 'create' || taskId) throw new Error('Use crew ticket create [fields] or crew ticket edit <task> [fields].');
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
