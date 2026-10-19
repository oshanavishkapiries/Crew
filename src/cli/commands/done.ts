export async function handleDone(options: { result?: string } = {}): Promise<void> {
  const serverUrl = process.env.CREW_SERVER_URL || 'http://127.0.0.1:4000';
  const taskId = process.env.CREW_TASK_ID;
  const token = process.env.CREW_AGENT_TOKEN;

  if (!taskId) {
    console.error('Error: CREW_TASK_ID environment variable is required for crew done.');
    process.exit(1);
  }

  const host = new URL(serverUrl).host;

  try {
    const res = await fetch(`${serverUrl}/api/tasks/${taskId}/done`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: host,
        ...(token ? { 'X-Crew-Agent-Token': token } : {}),
      },
      body: JSON.stringify({ result: options.result || 'Task completed' }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`Failed to submit done: ${res.status} ${err}`);
      process.exit(1);
    }

    const data = await res.json();
    console.log(`Task submitted for verification. Current status: ${data.status}`);
  } catch (err: any) {
    console.error(`Failed to connect to Crew server at ${serverUrl}: ${err.message}`);
    process.exit(1);
  }
}
