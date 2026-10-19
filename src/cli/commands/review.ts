import { postTaskAction } from '../client.js';

export async function handleReview(
  action: string,
  options: { feedback?: string } = {},
): Promise<void> {
  if (action !== 'approve' && action !== 'changes') {
    console.error(`Invalid review action: ${action}. Must be 'approve' or 'changes'.`);
    process.exitCode = 1;
    return;
  }

  const data = await postTaskAction<{ success: boolean; status: string }>('review', 'review', {
    action,
    feedback: options.feedback,
  });

  if (action === 'approve') {
    console.log(`Review approved. Task status: ${data.status}`);
  } else {
    console.log(`Changes requested. Task status: ${data.status}`);
  }
}
