import { getHumanAction } from '../client.js';

interface TaskResponse {
  task: {
    id: string;
    title: string;
    status: string;
  };
  verificationResults: Array<{
    id: string;
    step: string;
    passed: boolean;
    output: string;
    createdAt: string;
  }>;
}

export async function handleResults(taskId: string): Promise<void> {
  const data = await getHumanAction<TaskResponse>(`/api/tasks/${encodeURIComponent(taskId)}`);

  if (!data || !data.task) {
    console.error(`Task ${taskId} not found.`);
    process.exitCode = 1;
    return;
  }

  const results = data.verificationResults || [];
  if (results.length === 0) {
    console.log(`No verification results for task ${taskId}.`);
    return;
  }

  console.log(`Verification results for task ${taskId}:`);
  for (const r of results) {
    const status = r.passed ? 'pass' : 'fail';
    console.log(`  [${status}] ${r.step}`);
  }

  const failures = results.filter((r) => !r.passed);
  if (failures.length > 0) {
    console.log('\nFailed step output:');
    for (const f of failures) {
      console.log(`\n--- ${f.step} ---`);
      console.log(f.output.trim());
    }
  }
}
