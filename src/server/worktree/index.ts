import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { execa } from 'execa';
import { getCrewWorktreesDir } from '../config.js';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return slug || 'task';
}

export async function git(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return await execa('git', args, { cwd });
}

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
}

export class WorktreeManager {
  constructor(private db: CrewDatabase) {}

  getWorkspaceForBoard(boardId: string) {
    const board = this.db.db.select().from(schema.boards).where(eq(schema.boards.id, boardId)).get();
    if (!board) throw new Error(`Board not found: ${boardId}`);
    const workspace = this.db.db
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, board.workspaceId))
      .get();
    if (!workspace) throw new Error(`Workspace not found: ${board.workspaceId}`);
    return workspace;
  }

  getWorktreePath(workspaceId: string, taskId: string): string {
    return path.join(getCrewWorktreesDir(), workspaceId, taskId);
  }

  getBranchName(taskId: string, title: string): string {
    return `crew/${taskId}-${slugify(title)}`;
  }

  /**
   * Creates a worktree and branch for the task, or reuses existing one.
   */
  async ensureWorktree(task: {
    id: string;
    boardId: string;
    title: string;
    branch?: string | null;
    worktreePath?: string | null;
  }): Promise<WorktreeInfo> {
    const workspace = this.getWorkspaceForBoard(task.boardId);
    const worktreePath = task.worktreePath || this.getWorktreePath(workspace.id, task.id);
    const branch = task.branch || this.getBranchName(task.id, task.title);

    // If worktree directory already exists, reuse it
    if (fs.existsSync(worktreePath)) {
      return { worktreePath, branch };
    }

    const parentDir = path.dirname(worktreePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // Check if branch already exists in git
    let branchExists = false;
    try {
      await git(['rev-parse', '--verify', branch], workspace.repoPath);
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      await git(['worktree', 'add', worktreePath, branch], workspace.repoPath);
    } else {
      await git(
        ['worktree', 'add', '-b', branch, worktreePath, workspace.defaultBranch],
        workspace.repoPath,
      );
    }

    return { worktreePath, branch };
  }

  /**
   * Removes worktree for a task, keeping the branch so work is preserved.
   */
  async removeWorktree(task: {
    id: string;
    boardId: string;
    worktreePath?: string | null;
  }): Promise<void> {
    const workspace = this.getWorkspaceForBoard(task.boardId);
    const worktreePath = task.worktreePath || this.getWorktreePath(workspace.id, task.id);

    if (fs.existsSync(worktreePath)) {
      try {
        await git(['worktree', 'remove', '--force', worktreePath], workspace.repoPath);
      } catch {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        await git(['worktree', 'prune'], workspace.repoPath);
      } catch {
        // Ignore prune errors
      }
    }
  }

  /**
   * GC worktrees: remove worktrees whose task is terminal (merged or cancelled) or missing.
   * Then prune git worktrees.
   */
  async gc(): Promise<Array<{ taskId: string; worktreePath: string; reason: string }>> {
    const baseDir = getCrewWorktreesDir();
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    const removed: Array<{ taskId: string; worktreePath: string; reason: string }> = [];
    const workspaces = this.db.db.select().from(schema.workspaces).all();
    const workspaceMap = new Map(workspaces.map((w) => [w.id, w]));

    const workspaceDirs = fs.readdirSync(baseDir);
    for (const wsId of workspaceDirs) {
      const wsDir = path.join(baseDir, wsId);
      if (!fs.statSync(wsDir).isDirectory()) continue;

      const workspace = workspaceMap.get(wsId);
      const taskDirs = fs.readdirSync(wsDir);

      for (const taskId of taskDirs) {
        const wtPath = path.join(wsDir, taskId);
        if (!fs.statSync(wtPath).isDirectory()) continue;

        const task = this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get();
        let shouldRemove = false;
        let reason = '';

        if (!task) {
          shouldRemove = true;
          reason = 'missing task';
        } else if (task.status === 'merged' || task.status === 'cancelled') {
          shouldRemove = true;
          reason = `task is ${task.status}`;
        }

        if (shouldRemove) {
          if (workspace && fs.existsSync(workspace.repoPath)) {
            try {
              await git(['worktree', 'remove', '--force', wtPath], workspace.repoPath);
            } catch {
              fs.rmSync(wtPath, { recursive: true, force: true });
            }
          } else {
            fs.rmSync(wtPath, { recursive: true, force: true });
          }
          removed.push({ taskId, worktreePath: wtPath, reason });
        }
      }

      if (workspace && fs.existsSync(workspace.repoPath)) {
        try {
          await git(['worktree', 'prune'], workspace.repoPath);
        } catch {
          // Ignore prune errors
        }
      }
    }

    return removed;
  }
}
