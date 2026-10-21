import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execa } from 'execa';
import { eq } from 'drizzle-orm';
import { createCrewDatabase } from '../../server/db/index.js';
import * as schema from '../../server/db/schema.js';
import { generateAgentToken, hashToken } from '../../server/api/security.js';
import { CodexAdapter } from '../../adapters/codex.js';
import { ClaudeCodeAdapter } from '../../adapters/claude-code.js';
import { CONFIG_TEMPLATE, loadWorkspaceConfigs } from '../../server/project-config.js';
import { BUILTIN_ROLES } from '../../roles/index.js';

export async function handleInit(): Promise<void> {
  const git = (args: string[]) => execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], { reject: false });
  const root = await git(['rev-parse', '--show-toplevel']);
  if (root.exitCode !== 0) throw new Error('crew init requires a git repository. Run git init first.');
  const repoPath = fs.realpathSync(root.stdout.trim());
  const defaultRef = await git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  let defaultBranch = defaultRef.exitCode === 0 ? defaultRef.stdout.trim().replace(/^origin\//, '') : '';
  if (!defaultBranch) {
    for (const branch of ['main', 'master']) {
      if ((await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`])).exitCode === 0) { defaultBranch = branch; break; }
    }
  }
  if (!defaultBranch) defaultBranch = (await git(['symbolic-ref', '--short', 'HEAD'])).stdout.trim();
  if (!defaultBranch) throw new Error('Cannot identify the default branch. Check out a branch and run crew init again.');
  const file = path.join(repoPath, 'crew.config.ts');
  const db = createCrewDatabase();
  try {
    // Write exclusively; an existing user config is always preserved, even on first init.
    try { fs.writeFileSync(file, CONFIG_TEMPLATE, { flag: 'wx' }); } catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    const workspace = db.sqlite.transaction(() => {
      const existing = db.db.select().from(schema.workspaces).where(eq(schema.workspaces.repoPath, repoPath)).get();
      const now = new Date();
      const id = existing?.id || `ws-${crypto.randomUUID()}`;
      if (!existing) db.db.insert(schema.workspaces).values({ id, name: path.basename(repoPath), repoPath, defaultBranch, createdAt: now }).run();
      if (!db.db.select().from(schema.boards).where(eq(schema.boards.workspaceId, id)).get()) {
        db.db.insert(schema.boards).values({ id: `board-${crypto.randomUUID()}`, workspaceId: id, currentPhase: 'grill', createdAt: now }).run();
      }
      for (const [name, role] of Object.entries(BUILTIN_ROLES)) {
        db.db.insert(schema.roles).values({ id: `builtin-${name}`, name, ...role, permissionProfile: { ...role.permissionProfile }, isBuiltin: true, createdAt: now }).onConflictDoNothing().run();
      }
      for (const [name, role] of [['Orchestrator', 'orchestrator'], ['Developer 1', 'backend'], ['Developer 2', 'backend'], ['Reviewer', 'reviewer']]) {
        const team = db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, id)).all();
        if (!team.some((agent) => agent.roleId === `builtin-${role}` && agent.name === name)) {
          db.db.insert(schema.agents).values({ id: `agent-${crypto.randomUUID()}`, workspaceId: id, roleId: `builtin-${role}`, name, cliType: 'claude-code', tokenHash: hashToken(generateAgentToken()), createdAt: now }).run();
        }
      }
      return db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get()!;
    })();
    // Init preserves existing stored settings; only start replaces workspace config.
    await loadWorkspaceConfigs(db, workspace.id, true);
    const detected = await Promise.all([new ClaudeCodeAdapter(), new CodexAdapter()].map(async adapter => {
      const result = await adapter.detect();
      return `${adapter.id}: ${result.installed ? `${result.version || 'unknown version'} (${result.headless ? 'headless ready' : 'unsupported for headless runs'})` : 'not installed'}`;
    }));
    console.log(`Detected tools: ${detected.join('; ')}`);
    console.log(`Crew initialized: ${workspace.name} (${workspace.id}).\nConfig: ${file}\nUntracked crew.config.ts pauses the merge queue; review and commit it before merging.\nNext: review and commit crew.config.ts, then run crew start.`);
  } finally { db.close(); }
}
