import { AGENT_TOKEN_HEADER, SECRET_HEADER } from '../../server/api/security.js';
import { getServerInfo, printAgentInstruction } from '../client.js';

async function memoryRequest(method: string, suffix: string, body?: Record<string, unknown>) {
  const token = process.env.CREW_AGENT_TOKEN;
  const info = token ? { url: process.env.CREW_SERVER_URL, secret: '' } : getServerInfo();
  if (!info.url) throw new Error('CREW_SERVER_URL is required for agent memory commands.');
  const response = await fetch(`${info.url}/api/memory${suffix}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { [AGENT_TOKEN_HEADER]: token } : { [SECRET_HEADER]: info.secret }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  printAgentInstruction(response);
  if (!response.ok) throw new Error(`crew memory failed: ${response.status} ${await response.text()}`);
  return await response.json() as { entry?: unknown; entries?: unknown[]; deleted?: boolean };
}
export async function handleRemember(learning: string) {
  console.log(JSON.stringify((await memoryRequest('POST', '', { title: learning.split('\n')[0].slice(0, 120), body: learning })).entry, null, 2));
}
export async function handleMemory(action: string, id: string | undefined, options: Record<string, string | undefined>) {
  let result;
  const suffix = id ? `/${encodeURIComponent(id)}` : '';
  if (action === 'list') {
    const query = new URLSearchParams();
    if (options.workspace) query.set('workspaceId', options.workspace);
    if (options.layer) query.set('layer', options.layer);
    result = (await memoryRequest('GET', `?${query}`)).entries;
  } else if (action === 'add') {
    result = (await memoryRequest('POST', '', { workspaceId: options.workspace, layer: options.layer || 'project', roleId: options.role, taskId: options.task, title: options.title, body: options.body })).entry;
  } else {
    if (!id) throw new Error(`crew memory ${action} requires a memory ID.`);
    if (action === 'edit') result = (await memoryRequest('PATCH', suffix, { title: options.title, body: options.body })).entry;
    else if (action === 'delete') result = await memoryRequest('DELETE', suffix);
    else if (action === 'promote') result = (await memoryRequest('PATCH', suffix, { promote: true, contextTaskId: process.env.CREW_TASK_ID })).entry;
    else throw new Error('Use crew memory list, add, edit, delete or promote.');
  }
  console.log(JSON.stringify(result, null, 2));
}
