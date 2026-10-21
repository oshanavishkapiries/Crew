import { getHumanAction } from '../client.js';
import type { TaskStatus } from '../../server/scheduler/index.js';

interface TaskItem {
  id: string;
  boardId: string;
  roleId?: string | null;
  title: string;
  status: string;
  assigneeAgentId?: string | null;
  assigneeAgentName?: string | null;
  retries: number;
}
interface TaskFilters { status?: string; role?: string; board?: string; assignee?: string }
const statuses = ['todo', 'ready', 'doing', 'verifying', 'review', 'merge-queue', 'merged', 'blocked', 'escalated', 'cancelled'] satisfies TaskStatus[];

function invalid(flag: string, value: string, choices: string[]): never {
  console.error(`Invalid --${flag} ${JSON.stringify(value)}. Valid choices: ${choices.join(', ') || '(none registered)'}. See crew tasks --help.`);
  process.exit(1);
}
function resolveFilter(flag: string, value: string | undefined, choices: Array<{ id: string; name?: string }>): string | undefined {
  if (value === undefined) return undefined;
  const exact = choices.find(choice => choice.id === value);
  if (exact) return exact.id;
  const matches = choices.filter(choice => choice.name === value);
  if (matches.length === 1) return matches[0].id;
  return invalid(flag, value, choices.map(choice => choice.name ? `${choice.id} (${choice.name})` : choice.id));
}

export async function handleTasks(filters: TaskFilters = {}): Promise<void> {
  if (filters.status !== undefined && !statuses.includes(filters.status as TaskStatus)) invalid('status', filters.status, statuses);
  const data = await getHumanAction<{ tasks: TaskItem[] }>('/api/tasks');
  let roleId: string | undefined, boardId: string | undefined, assigneeId: string | undefined;
  if (filters.role !== undefined || filters.board !== undefined || filters.assignee !== undefined) {
    const metadata = await getHumanAction<{ roles: Array<{ id: string; name: string }>; phases: Array<{ boardId: string }>; agents: Array<{ id: string; name: string }> }>('/api/status');
    roleId = resolveFilter('role', filters.role, metadata.roles);
    boardId = resolveFilter('board', filters.board, metadata.phases.map(phase => ({ id: phase.boardId })));
    assigneeId = resolveFilter('assignee', filters.assignee, metadata.agents);
  }
  const tasks = data.tasks.filter(task =>
    (filters.status === undefined || task.status === filters.status) &&
    (roleId === undefined || task.roleId === roleId) &&
    (boardId === undefined || task.boardId === boardId) &&
    (assigneeId === undefined || task.assigneeAgentId === assigneeId));

  if (tasks.length === 0) {
    console.log('No tasks found.');
    return;
  }
  console.log(`${'ID'.padEnd(24)} ${'STATUS'.padEnd(14)} ${'RETRIES'.padEnd(8)} ${'ASSIGNEE'.padEnd(20)} TITLE`);
  console.log('-'.repeat(80));
  for (const task of tasks) {
    const assignee = task.assigneeAgentName || task.assigneeAgentId || '-';
    console.log(`${task.id.padEnd(24)} ${task.status.padEnd(14)} ${String(task.retries).padEnd(8)} ${assignee.padEnd(20)} ${task.title}`);
  }
}
