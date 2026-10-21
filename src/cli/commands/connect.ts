import { getHumanAction, postHumanAction } from '../client.js';

export async function handleConnect(name: string) {
  const { agents } = await getHumanAction<{ agents: { id: string; name: string }[] }>('/api/agents');
  const byId = agents.find(agent => agent.id === name);
  const matching = byId ? [byId] : agents.filter(agent => agent.name === name);
  if (matching.length !== 1) throw new Error(matching.length ? 'Agent name is ambiguous. Use its ID from crew status.' : 'Agent not found. Check crew status and use an exact name or ID.');
  const result = await postHumanAction<{ prompt: string }>(`/api/agents/${encodeURIComponent(matching[0].id)}/connect`);
  console.log(result.prompt); // Explicit human action: the only CLI disclosure of this fresh credential.
}
