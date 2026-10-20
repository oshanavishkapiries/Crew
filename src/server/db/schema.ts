import {
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoPath: text('repo_path').notNull(),
  defaultBranch: text('default_branch').notNull().default('main'),
  config: text('config', { mode: 'json' }).$type<Record<string, unknown>>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const boards = sqliteTable('boards', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  currentPhase: text('current_phase').notNull().default('grill'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const roles = sqliteTable('roles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  defaultPrompt: text('default_prompt').notNull(),
  permissionProfile: text('permission_profile', { mode: 'json' })
    .notNull()
    .$type<Record<string, unknown>>(),
  isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  roleId: text('role_id')
    .notNull()
    .references(() => roles.id),
  name: text('name').notNull(),
  personality: text('personality').notNull().default(''),
  systemPrompt: text('system_prompt').notNull().default(''),
  cliType: text('cli_type').notNull(), // 'claude-code' | 'codex' | 'fake' | 'antigravity'
  mode: text('mode').notNull().default('spawn'), // 'spawn' | 'pull'
  status: text('status').notNull().default('idle'), // 'idle' | 'busy' | 'rate-limited' | 'stopped'
  lastHeartbeatAt: integer('last_heartbeat_at', { mode: 'timestamp' }),
  tokenHash: text('token_hash').notNull(), // D13
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  boardId: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description').notNull(),
  acceptanceCriteria: text('acceptance_criteria').notNull().default(''),
  status: text('status').notNull().default('todo'),
  assigneeAgentId: text('assignee_agent_id').references(() => agents.id),
  reviewerAgentId: text('reviewer_agent_id').references(() => agents.id),
  roleId: text('role_id').references(() => roles.id),
  createdBy: text('created_by').notNull().default('human'),
  parentTaskId: text('parent_task_id'),
  depth: integer('depth').notNull().default(0),
  retries: integer('retries').notNull().default(0),
  branch: text('branch'),
  worktreePath: text('worktree_path'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const taskDependencies = sqliteTable(
  'task_dependencies',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    blockedByTaskId: text('blocked_by_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.blockedByTaskId] })],
);

export type ExitReason =
  | 'done'
  | 'asked'
  | 'exited'
  | 'timeout'
  | 'no-output'
  | 'stopped'
  | 'rate-limited'
  | 'cancelled'
  | 'resume-failed';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  adapter: text('adapter').notNull(), // 'claude-code' | 'codex' | 'fake' | 'antigravity'
  pid: integer('pid'),
  sessionId: text('session_id'), // D6
  resumedFromRunId: text('resumed_from_run_id'), // D4
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  endedAt: integer('ended_at', { mode: 'timestamp' }),
  exitCode: integer('exit_code'),
  exitReason: text('exit_reason').$type<ExitReason>(), // D21
  kind: text('kind').notNull().default('work').$type<'work' | 'review'>(), // D34
  logPath: text('log_path'),
  prompt: text('prompt'),
});

export const verificationResults = sqliteTable('verification_results', {
  id: text('id').primaryKey(),
  runId: text('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  step: text('step').notNull(), // 'diff' | 'lint' | 'typecheck' | 'test' | 'review'
  passed: integer('passed', { mode: 'boolean' }).notNull(),
  output: text('output'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  fromAgentId: text('from_agent_id').references(() => agents.id),
  type: text('type').notNull(), // 'comment' | 'question' | 'answer' | 'result' | 'feedback'
  body: text('body').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const memory = sqliteTable('memory', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  layer: text('layer').notNull(), // 'project' | 'role' | 'task'
  roleId: text('role_id').references(() => roles.id),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  source: text('source'),
  promotedAt: integer('promoted_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const phaseOutputs = sqliteTable('phase_outputs', {
  id: text('id').primaryKey(),
  boardId: text('board_id')
    .notNull()
    .references(() => boards.id, { onDelete: 'cascade' }),
  phase: text('phase').notNull(), // 'grill' | 'spec' | 'tickets' | 'dispatch' | 'integrate'
  body: text('body').notNull(),
  status: text('status').notNull().default('draft'), // 'draft' | 'approved'
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});

export const mergeQueueItems = sqliteTable('merge_queue_items', {
  id: text('id').primaryKey(),
  taskId: text('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  status: text('status').notNull().default('queued'), // 'queued' | 'rebasing' | 'verifying' | 'merging' | 'merged' | 'conflict' | 'failed'
  conflictTaskId: text('conflict_task_id').references(() => tasks.id),
  commitSha: text('commit_sha'),
  output: text('output'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
