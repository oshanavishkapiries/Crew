import { postHumanAction } from '../client.js';

export async function handleWorktree(subcommand: string): Promise<void> {
  if (subcommand === 'gc') {
    const data = await postHumanAction<{ success: boolean; removed: string[] }>(
      '/api/worktrees/gc',
    );
    if (data.removed.length === 0) {
      console.log('No orphaned worktrees found.');
    } else {
      console.log(`Cleaned up ${data.removed.length} orphaned worktree(s):`);
      for (const p of data.removed) {
        console.log(`  - ${p}`);
      }
    }
  } else {
    console.error(`Unknown worktree subcommand: ${subcommand}. Available subcommands: gc`);
    process.exitCode = 1;
  }
}
