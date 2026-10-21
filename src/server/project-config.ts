import * as crypto from 'node:crypto';
import { generateAgentToken, hashToken } from './api/security.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createJiti } from 'jiti';
import { BUILTIN_ROLES } from '../roles/index.js';
import { eq } from 'drizzle-orm';
import type { PermissionProfile } from '../adapters/types.js';
import type { CrewDatabase } from './db/index.js';
import * as schema from './db/schema.js';

export interface ProjectConfig {
  /** Additive team entries; existing agents are never silently replaced. */
  team?: { name: string; role: string; cliType: 'claude-code' | 'codex' }[];
  verifyCommands?: { name: string; command: string; cwd?: string; timeout?: number; paths?: string[] }[];
  worktreeSetup?: string;
  mergeStrategy?: 'squash' | 'rebase';
  maxParallelAgents?: number;
  maxParallelVerifications?: number;
  maxRetries?: number;
  maxDepth?: number;
  maxRuntimeMs?: number;
  noOutputTimeoutMs?: number;
  maxTicketsPerPhase?: number;
  memoryBudgetTokens?: number;
  stopHook?: boolean;
  permissions?: { allowCommands?: string[] };
  workflow?: { gates?: Partial<Record<'grill' | 'spec' | 'tickets' | 'integrate', boolean>> };
  roles?: Record<string, { defaultPrompt?: string; permissionProfile?: PermissionProfile }>;
}
export const CONFIG_TEMPLATE = `// Crew reads this file on every crew start. The file replaces stored config.
// Commit it so worktrees and the rest of your team share the same settings.
export default {
  verifyCommands: [
    // { name: 'test', command: 'npm test', timeout: 600000, paths: ['src/**', 'test/**'] },
  ],
  // team: [{ name: 'Codex developer', role: 'backend', cliType: 'codex' }],
  // worktreeSetup: 'npm ci',
  mergeStrategy: 'squash',
  maxParallelAgents: 3,
  maxParallelVerifications: 2,
  maxRetries: 3,
  maxDepth: 3,
  maxRuntimeMs: 1800000,
  noOutputTimeoutMs: 300000,
  maxTicketsPerPhase: 20,
  memoryBudgetTokens: 8000,
  permissions: { allowCommands: [
    // 'npm test', 'npm run typecheck',
  ] },
  roles: {
    // backend: { defaultPrompt: 'Follow our backend conventions.' },
  },
  workflow: { gates: { grill: true, spec: true, tickets: true, integrate: true } },
};
`;

function object(value: unknown, at: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${at} must be an object`);
}
function keys(value: Record<string, unknown>, allowed: string[], at: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown option ${at}.${key}`);
}
function strings(value: unknown, at: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${at} must be a list of non-empty strings`);
}
function positive(value: unknown, at: string, min = 1) {
  if (!Number.isSafeInteger(value) || (value as number) < min) throw new Error(`${at} must be an integer >= ${min}`);
}
function text(value: unknown, at: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${at} must be non-empty text`);
}
function profile(value: unknown, at: string) {
  object(value, at); keys(value, ['mode', 'allowCommands', 'denyCommands', 'stopHook', 'allowNetwork'], at);
  if (value.mode !== undefined && !['standard', 'full', 'read-only'].includes(value.mode as string)) throw new Error(`${at}.mode must be standard, full or read-only`);
  for (const key of ['allowCommands', 'denyCommands']) if (value[key] !== undefined) strings(value[key], `${at}.${key}`);
  if (value.stopHook !== undefined && typeof value.stopHook !== 'boolean') throw new Error(`${at}.stopHook must be boolean`);
  if (value.allowNetwork !== undefined && typeof value.allowNetwork !== 'boolean') throw new Error(`${at}.allowNetwork must be boolean`);
}
export function validateProjectConfig(value: unknown): ProjectConfig {
  object(value, 'config');
  const numbers = ['maxParallelAgents', 'maxParallelVerifications', 'maxRetries', 'maxDepth', 'maxRuntimeMs', 'noOutputTimeoutMs', 'maxTicketsPerPhase', 'memoryBudgetTokens'];
  keys(value, [...numbers, 'verifyCommands', 'worktreeSetup', 'mergeStrategy', 'stopHook', 'permissions', 'workflow', 'roles', 'team'], 'config');
  for (const key of numbers) if (value[key] !== undefined) positive(value[key], key, ['maxRetries', 'maxDepth'].includes(key) ? 0 : 1);
  if (value.mergeStrategy !== undefined && !['squash', 'rebase'].includes(value.mergeStrategy as string)) throw new Error('mergeStrategy must be squash or rebase');
  if (value.worktreeSetup !== undefined) text(value.worktreeSetup, 'worktreeSetup');
  if (value.stopHook !== undefined && typeof value.stopHook !== 'boolean') throw new Error('stopHook must be boolean');
  if (value.verifyCommands !== undefined) {
    if (!Array.isArray(value.verifyCommands)) throw new Error('verifyCommands must be a list');
    const names = new Set<string>();
    for (const command of value.verifyCommands) {
      object(command, 'verifyCommands entry'); keys(command, ['name', 'command', 'cwd', 'timeout', 'paths'], 'verifyCommands entry');
      text(command.name, 'verifyCommands.name'); text(command.command, 'verifyCommands.command');
      if (names.has(command.name as string)) throw new Error(`Duplicate verify command ${command.name}`); names.add(command.name as string);
      if (command.cwd !== undefined) text(command.cwd, 'verifyCommands.cwd');
      if (command.timeout !== undefined) positive(command.timeout, 'verifyCommands.timeout');
      if (command.paths !== undefined) strings(command.paths, 'verifyCommands.paths');
    }
  }
  if (value.permissions !== undefined) {
    object(value.permissions, 'permissions'); keys(value.permissions, ['allowCommands'], 'permissions');
    if (value.permissions.allowCommands !== undefined) strings(value.permissions.allowCommands, 'permissions.allowCommands');
  }
  if (value.workflow !== undefined) {
    object(value.workflow, 'workflow'); keys(value.workflow, ['gates'], 'workflow');
    if (value.workflow.gates !== undefined) {
      object(value.workflow.gates, 'workflow.gates'); keys(value.workflow.gates, ['grill', 'spec', 'tickets', 'integrate'], 'workflow.gates');
      for (const gate of Object.values(value.workflow.gates)) if (typeof gate !== 'boolean') throw new Error('workflow.gates values must be boolean');
    }
  }
  if (value.roles !== undefined) {
    object(value.roles, 'roles');
    for (const [name, role] of Object.entries(value.roles)) {
      if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`Invalid role name ${name}`);
      object(role, `roles.${name}`); keys(role, ['defaultPrompt', 'permissionProfile'], `roles.${name}`);
      if (role.defaultPrompt !== undefined) text(role.defaultPrompt, `roles.${name}.defaultPrompt`);
      if (role.permissionProfile !== undefined) profile(role.permissionProfile, `roles.${name}.permissionProfile`);
      if (['orchestrator', 'reviewer'].includes(name) && role.permissionProfile !== undefined) throw new Error(`roles.${name}.permissionProfile is fixed; only its prompt may be changed`);
    }
  }
  if (value.team !== undefined) {
    if (!Array.isArray(value.team)) throw new Error('team must be a list');
    const names = new Set<string>();
    for (const member of value.team) {
      object(member, 'team entry'); keys(member, ['name', 'role', 'cliType'], 'team entry');
      text(member.name, 'team.name'); text(member.role, 'team.role');
      if (!['claude-code', 'codex'].includes(member.cliType as string)) throw new Error('team.cliType must be claude-code or codex');
      if (names.has(member.name as string)) throw new Error(`Duplicate team name ${member.name}`);
      names.add(member.name as string);
      if (!Object.hasOwn(BUILTIN_ROLES, member.role as string) && !Object.hasOwn(value.roles || {}, member.role as string)) throw new Error(`Unknown team role ${member.role}`);
    }
  }
  // Persist only JSON data, not loader proxies or executable functions.
  const serialized = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'function' || typeof item === 'bigint' || typeof item === 'symbol' || item === undefined) throw new Error('Config values must be JSON data');
    return item;
  });
  return JSON.parse(serialized);
}

/** Only the CLI startup calls this: user config never executes during harness setup. */
export async function loadWorkspaceConfigs(db: CrewDatabase, onlyWorkspaceId?: string, provisionOnly = false): Promise<void> {
  const pending: { id: string; config: ProjectConfig }[] = [];
  for (const workspace of db.db.select().from(schema.workspaces).all()) {
    if (onlyWorkspaceId && workspace.id !== onlyWorkspaceId) continue;
    const file = path.join(workspace.repoPath, 'crew.config.ts');
    if (!fs.existsSync(file)) continue; // Milestones 1–4 workspaces may have no config yet.
    try {
      const jiti = createJiti(file, { moduleCache: false, fsCache: false, interopDefault: true });
      const loaded = await jiti.import(file, { default: true });
      pending.push({ id: workspace.id, config: validateProjectConfig(loaded) });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const location = /\((\d+):(\d+)\)/.exec(detail) || new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:(\\d+):(\\d+)`).exec(error instanceof Error ? error.stack || '' : '');
      throw new Error(`${file}${location ? `:${location[1]}:${location[2]}` : ''}: ${detail}\nFix crew.config.ts, then run crew start again.`);
    }
  }
  db.sqlite.transaction(() => {
    for (const { id, config } of pending) {
      // Keep referenced role identities, but never retain removed configuration privileges.
      for (const role of db.db.select().from(schema.roles).all()) {
        if (!provisionOnly && role.id === `configured-${id}-${role.name}` && !Object.hasOwn(config.roles || {}, role.name)) {
          db.db.update(schema.roles).set({ defaultPrompt: `You are a Crew ${role.name} agent. Follow the task acceptance criteria and repository conventions.`, permissionProfile: { mode: 'standard' } }).where(eq(schema.roles.id, role.id)).run();
        }
      }
      if (!provisionOnly) db.db.update(schema.workspaces).set({ config: config as Record<string, unknown> }).where(eq(schema.workspaces.id, id)).run();
      for (const [name, role] of Object.entries(config.roles || {})) {
        if (Object.hasOwn(BUILTIN_ROLES, name)) continue;
        const definition = { defaultPrompt: role.defaultPrompt || `You are a Crew ${name} agent. Follow the task acceptance criteria and repository conventions.`, permissionProfile: { ...(role.permissionProfile || { mode: 'standard' }) } };
        db.db.insert(schema.roles).values({ id: `configured-${id}-${name}`, name, ...definition, isBuiltin: false, createdAt: new Date() })
          .onConflictDoUpdate({ target: schema.roles.id, set: definition }).run();
      }
      for (const member of config.team || []) {
        const roleId = Object.hasOwn(BUILTIN_ROLES, member.role) ? `builtin-${member.role}` : `configured-${id}-${member.role}`;
        const existing = db.db.select().from(schema.agents).where(eq(schema.agents.workspaceId, id)).all().find(agent => agent.name === member.name);
        if (existing) {
          if (existing.cliType !== member.cliType || existing.roleId !== roleId) throw new Error(`Team member ${member.name} already exists with a different role or tool; choose a new name.`);
          continue;
        }
        db.db.insert(schema.agents).values({ id: `agent-${crypto.randomUUID()}`, workspaceId: id, roleId, name: member.name, cliType: member.cliType, tokenHash: hashToken(generateAgentToken()), createdAt: new Date() }).run();
      }
    }
  })();
}

/** Treat config entries as command prefixes, never expressions or permission syntax. */
export function commandPrefixes(commands: string[]): string[] {
  const gitSubcommands = new Set(['diff', 'status', 'log', 'show', 'add', 'commit', 'rebase', 'rev-parse', 'ls-files', 'ls-tree', 'grep', 'blame']);
  return commands.map((command) => command.trim()).filter((command) => {
    if (!command || /[\n\r;&|<>`$()\\*?]/.test(command)) return false;
    const [executable, subcommand] = command.split(/\s+/);
    // Global options and arbitrary Git prefixes evade tool-specific push rules.
    if (path.basename(executable) === 'git') return executable === 'git' && gitSubcommands.has(subcommand);
    return true;
  });
}
