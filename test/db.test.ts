import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureCrewHome, getCrewDbPath, getCrewHome } from '../src/server/config.js';
import { createCrewDatabase, schema } from '../src/server/db/index.js';

describe('Crew Home and Database (D12, D20)', () => {
  let tempDir: string;
  const originalCrewHome = process.env.CREW_HOME;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-test-'));
    process.env.CREW_HOME = tempDir;
  });

  afterEach(() => {
    if (originalCrewHome !== undefined) {
      process.env.CREW_HOME = originalCrewHome;
    } else {
      delete process.env.CREW_HOME;
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('honors CREW_HOME override and creates directory structure', () => {
    expect(getCrewHome()).toBe(tempDir);
    expect(getCrewDbPath()).toBe(path.join(tempDir, 'crew.db'));

    ensureCrewHome();

    expect(fs.existsSync(tempDir)).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'logs'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'worktrees'))).toBe(true);
  });

  it('initializes database with all 12 PRD tables and foreign keys enabled', () => {
    const { db, sqlite, close } = createCrewDatabase({ dbPath: getCrewDbPath() });

    try {
      // Verify foreign keys are enabled
      const fkResult = sqlite.pragma('foreign_keys', { simple: true });
      expect(fkResult).toBe(1);

      // Verify WAL mode
      const journalMode = sqlite.pragma('journal_mode', { simple: true });
      expect(journalMode).toBe('wal');

      const now = new Date();

      // 1. Workspace
      db.insert(schema.workspaces)
        .values({
          id: 'ws-1',
          name: 'test-workspace',
          repoPath: '/tmp/repo',
          defaultBranch: 'main',
          config: { verifyCommands: [] },
          createdAt: now,
        })
        .run();

      const ws = db.select().from(schema.workspaces).all();
      expect(ws).toHaveLength(1);
      expect(ws[0].name).toBe('test-workspace');

      // 2. Board
      db.insert(schema.boards)
        .values({
          id: 'board-1',
          workspaceId: 'ws-1',
          currentPhase: 'grill',
          createdAt: now,
        })
        .run();

      // 3. Role
      db.insert(schema.roles)
        .values({
          id: 'role-backend',
          name: 'backend',
          defaultPrompt: 'You are a backend engineer.',
          permissionProfile: { allowBash: true },
          isBuiltin: true,
          createdAt: now,
        })
        .run();

      // 4. Agent (with tokenHash, D13)
      db.insert(schema.agents)
        .values({
          id: 'agent-1',
          workspaceId: 'ws-1',
          roleId: 'role-backend',
          name: 'Backend Worker 1',
          cliType: 'fake',
          tokenHash: 'hashed-secret-token',
          createdAt: now,
        })
        .run();

      const ag = db.select().from(schema.agents).all();
      expect(ag).toHaveLength(1);
      expect(ag[0].tokenHash).toBe('hashed-secret-token');

      // 5. Task
      db.insert(schema.tasks)
        .values({
          id: 'task-1',
          boardId: 'board-1',
          title: 'Implement DB',
          description: 'Set up SQLite with Drizzle',
          status: 'todo',
          assigneeAgentId: 'agent-1',
          roleId: 'role-backend',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      db.insert(schema.tasks)
        .values({
          id: 'task-2',
          boardId: 'board-1',
          title: 'Run Migrations',
          description: 'Migrate DB schema',
          status: 'todo',
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // 6. Task Dependency (task-2 blocked by task-1)
      db.insert(schema.taskDependencies)
        .values({
          taskId: 'task-2',
          blockedByTaskId: 'task-1',
        })
        .run();

      const deps = db.select().from(schema.taskDependencies).all();
      expect(deps).toHaveLength(1);

      // 7. Run (with sessionId D6 and resumedFromRunId D4)
      db.insert(schema.runs)
        .values({
          id: 'run-1',
          taskId: 'task-1',
          agentId: 'agent-1',
          adapter: 'fake',
          sessionId: 'session-uuid-1234',
          startedAt: now,
        })
        .run();

      db.insert(schema.runs)
        .values({
          id: 'run-2',
          taskId: 'task-1',
          agentId: 'agent-1',
          adapter: 'fake',
          sessionId: 'session-uuid-1234',
          resumedFromRunId: 'run-1',
          startedAt: now,
        })
        .run();

      const r = db.select().from(schema.runs).all();
      expect(r).toHaveLength(2);
      expect(r[1].resumedFromRunId).toBe('run-1');
      expect(r[0].sessionId).toBe('session-uuid-1234');

      // 8. VerificationResult
      db.insert(schema.verificationResults)
        .values({
          id: 'vr-1',
          runId: 'run-1',
          step: 'diff',
          passed: true,
          output: 'Clean diff',
          createdAt: now,
        })
        .run();

      // 9. Message
      db.insert(schema.messages)
        .values({
          id: 'msg-1',
          taskId: 'task-1',
          fromAgentId: 'agent-1',
          type: 'question',
          body: 'Should we use in-memory SQLite?',
          createdAt: now,
        })
        .run();

      // 10. Memory
      db.insert(schema.memory)
        .values({
          id: 'mem-1',
          workspaceId: 'ws-1',
          layer: 'project',
          title: 'Architecture Decision',
          body: 'Use Drizzle ORM with better-sqlite3',
          createdAt: now,
        })
        .run();

      // 11. PhaseOutput
      db.insert(schema.phaseOutputs)
        .values({
          id: 'po-1',
          boardId: 'board-1',
          phase: 'grill',
          body: 'Grilling questions answered.',
          status: 'draft',
          createdAt: now,
        })
        .run();

      // 12. MergeQueueItem
      db.insert(schema.mergeQueueItems)
        .values({
          id: 'mqi-1',
          taskId: 'task-1',
          position: 1,
          status: 'queued',
          createdAt: now,
        })
        .run();

      const mqi = db.select().from(schema.mergeQueueItems).all();
      expect(mqi).toHaveLength(1);
      expect(mqi[0].position).toBe(1);

      // Verify foreign key enforcement
      expect(() => {
        db.insert(schema.boards)
          .values({
            id: 'bad-board',
            workspaceId: 'non-existent-workspace',
            createdAt: now,
          })
          .run();
      }).toThrow();
    } finally {
      close();
    }
  });

  it('baselines an old unversioned DB created by initial script and upgrades it with exit_reason and prompt', () => {
    const oldDbPath = path.join(tempDir, 'legacy.db');
    const rawSqlite = new Database(oldDbPath);

    // Simulate legacy schema created by INITIAL_MIGRATION_SQL (no __drizzle_migrations table, no exit_reason, no prompt)
    rawSqlite.exec(`
      CREATE TABLE merge_queue_items (
        id text PRIMARY KEY NOT NULL, task_id text NOT NULL, position integer NOT NULL,
        status text DEFAULT 'queued' NOT NULL, conflict_task_id text, created_at integer NOT NULL
      );
      CREATE TABLE workspaces (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        repo_path text NOT NULL,
        default_branch text DEFAULT 'main' NOT NULL,
        config text,
        created_at integer NOT NULL
      );
      CREATE TABLE tasks (
        id text PRIMARY KEY NOT NULL,
        board_id text NOT NULL,
        title text NOT NULL,
        description text NOT NULL,
        acceptance_criteria text DEFAULT '' NOT NULL,
        status text DEFAULT 'todo' NOT NULL,
        assignee_agent_id text,
        role_id text,
        created_by text DEFAULT 'human' NOT NULL,
        parent_task_id text,
        depth integer DEFAULT 0 NOT NULL,
        retries integer DEFAULT 0 NOT NULL,
        branch text,
        worktree_path text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      );
      CREATE TABLE runs (
        id text PRIMARY KEY NOT NULL,
        task_id text NOT NULL,
        agent_id text NOT NULL,
        adapter text NOT NULL,
        pid integer,
        session_id text,
        resumed_from_run_id text,
        started_at integer NOT NULL,
        ended_at integer,
        exit_code integer,
        log_path text
      );
    `);

    // Insert legacy data
    const now = Date.now();
    rawSqlite.prepare(`INSERT INTO workspaces (id, name, repo_path, created_at) VALUES (?, ?, ?, ?)`).run('ws-legacy', 'Legacy Workspace', '/repo', now);
    rawSqlite.prepare(`INSERT INTO runs (id, task_id, agent_id, adapter, started_at) VALUES (?, ?, ?, ?, ?)`).run('run-old', 'task-1', 'agent-1', 'fake', now);
    rawSqlite.close();

    // Verify rawSqlite has no exit_reason column and no __drizzle_migrations
    const checkRaw = new Database(oldDbPath);
    const hasMigrationsBefore = checkRaw.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
    expect(hasMigrationsBefore).toBeUndefined();
    expect(() => checkRaw.prepare('SELECT exit_reason FROM runs').all()).toThrow();
    checkRaw.close();

    // Now open with createCrewDatabase: it should baseline 0000 and run 0001
    const { db, sqlite, close } = createCrewDatabase({ dbPath: oldDbPath });
    try {
      // 1. __drizzle_migrations exists and has 5 applied migrations
      const migrationRows = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at ASC').all() as Array<{ hash: string; created_at: number }>;
      expect(migrationRows).toHaveLength(5);

      // 2. Legacy data is preserved
      const legacyWs = db.select().from(schema.workspaces).all();
      expect(legacyWs).toHaveLength(1);
      expect(legacyWs[0].id).toBe('ws-legacy');

      const legacyRuns = db.select().from(schema.runs).all();
      expect(legacyRuns).toHaveLength(1);
      expect(legacyRuns[0].id).toBe('run-old');
      expect(legacyRuns[0].exitReason).toBeNull();
      expect(legacyRuns[0].kind).toBe('work');

      // 3. Newly added columns exit_reason, prompt, and kind exist and accept writes
      db.update(schema.runs)
        .set({ exitReason: 'done', prompt: 'test prompt', kind: 'work' })
        .where(eq(schema.runs.id, 'run-old'))
        .run();

      const updatedRun = db.select().from(schema.runs).where(eq(schema.runs.id, 'run-old')).all();
      expect(updatedRun[0].exitReason).toBe('done');
      expect(updatedRun[0].prompt).toBe('test prompt');
      expect(updatedRun[0].kind).toBe('work');
    } finally {
      close();
    }
  });

  it('upgrades a milestone 2 database to milestone 3, preserving data and adding reviewer_agent_id and runs.kind', () => {
    const m2DbPath = path.join(tempDir, 'milestone2.db');
    const rawSqlite = new Database(m2DbPath);

    // Apply 0000 and 0001 migrations
    const drizzleDir = path.resolve(import.meta.dirname, '../drizzle');
    const mig0000 = fs.readFileSync(path.join(drizzleDir, '0000_narrow_thor_girl.sql'), 'utf-8');
    const mig0001 = fs.readFileSync(path.join(drizzleDir, '0001_dark_deadpool.sql'), 'utf-8');

    rawSqlite.exec(mig0000);
    rawSqlite.exec(mig0001);

    rawSqlite.exec(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
    `);
    const migrationFiles = readMigrationFiles({ migrationsFolder: drizzleDir });
    rawSqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(migrationFiles[0].hash, migrationFiles[0].folderMillis);
    rawSqlite.prepare('INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)').run(migrationFiles[1].hash, migrationFiles[1].folderMillis);

    // Seed milestone 2 task and run
    const now = Date.now();
    rawSqlite.prepare(`INSERT INTO workspaces (id, name, repo_path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)`).run('ws-m2', 'M2 Workspace', '/repo', 'main', now);
    rawSqlite.prepare(`INSERT INTO boards (id, workspace_id, current_phase, created_at) VALUES (?, ?, ?, ?)`).run('board-m2', 'ws-m2', 'dispatch', now);
    rawSqlite.prepare(`INSERT INTO roles (id, name, default_prompt, permission_profile, created_at) VALUES (?, ?, ?, ?, ?)`).run('role-m2', 'dev', 'prompt', '{}', now);
    rawSqlite.prepare(`INSERT INTO agents (id, workspace_id, role_id, name, cli_type, token_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run('agent-m2', 'ws-m2', 'role-m2', 'Agent M2', 'fake', 'hash', now);
    rawSqlite.prepare(`INSERT INTO tasks (id, board_id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run('task-m2', 'board-m2', 'Task M2', 'Desc', now, now);
    rawSqlite.prepare(`INSERT INTO runs (id, task_id, agent_id, adapter, started_at, exit_reason) VALUES (?, ?, ?, ?, ?, ?)`).run('run-m2', 'task-m2', 'agent-m2', 'fake', now, 'done');
    rawSqlite.close();

    // Open with createCrewDatabase: it should apply 0002 and 0003
    const { db, sqlite, close } = createCrewDatabase({ dbPath: m2DbPath });
    try {
      const migrations = sqlite.prepare('SELECT * FROM __drizzle_migrations').all();
      expect(migrations).toHaveLength(5);

      const task = db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-m2')).get();
      expect(task).toBeDefined();
      expect(task?.reviewerAgentId).toBeNull();

      const run = db.select().from(schema.runs).where(eq(schema.runs.id, 'run-m2')).get();
      expect(run).toBeDefined();
      expect(run?.kind).toBe('work');
      expect(run?.exitReason).toBe('done');

      // Test writing to new columns
      db.update(schema.tasks)
        .set({ reviewerAgentId: 'agent-m2' })
        .where(eq(schema.tasks.id, 'task-m2'))
        .run();

      const updatedTask = db.select().from(schema.tasks).where(eq(schema.tasks.id, 'task-m2')).get();
      expect(updatedTask?.reviewerAgentId).toBe('agent-m2');
    } finally {
      close();
    }
  });

  it('upgrades a milestone 3 database with every existing row intact and adds merge commit_sha and output', () => {
    const dbPath = path.join(tempDir, 'milestone3.db');
    const old = new Database(dbPath);
    const migrations = readMigrationFiles({ migrationsFolder: path.resolve(import.meta.dirname, '../drizzle') });
    old.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    for (const migration of migrations.slice(0, 3)) {
      for (const statement of migration.sql) old.exec(statement);
      old.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis);
    }
    old.exec(`
      INSERT INTO workspaces VALUES ('ws', 'Milestone 3', '/repo', 'main', '{"verifyCommands":[]}', 123);
      INSERT INTO boards VALUES ('board', 'ws', 'dispatch', 123);
      INSERT INTO roles VALUES ('role', 'dev', 'prompt', '{}', 0, 123);
      INSERT INTO agents (id, workspace_id, role_id, name, cli_type, token_hash, created_at) VALUES ('agent', 'ws', 'role', 'Author', 'fake', 'hash', 123);
      INSERT INTO tasks (id, board_id, title, description, status, reviewer_agent_id, created_at, updated_at) VALUES ('task', 'board', 'Existing', 'Keep me', 'merge-queue', 'agent', 123, 123);
      INSERT INTO runs (id, task_id, agent_id, adapter, started_at, exit_reason, kind) VALUES ('run', 'task', 'agent', 'fake', 123, 'done', 'review');
      INSERT INTO verification_results VALUES ('result', 'run', 'review', 1, 'approved', 123);
      INSERT INTO messages VALUES ('msg', 'task', NULL, 'feedback', 'Keep feedback', 123);
      INSERT INTO merge_queue_items VALUES ('item', 'task', 1, 'queued', NULL, 123);
    `);
    const tables = ['workspaces', 'boards', 'roles', 'agents', 'tasks', 'runs', 'verification_results', 'messages', 'merge_queue_items'];
    const before = new Map(tables.map(t => [t, old.prepare(`SELECT * FROM ${t}`).all()]));
    old.close();
    const upgraded = createCrewDatabase({ dbPath });
    try {
      expect(upgraded.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(5);
      for (const t of tables) {
        const rows = upgraded.sqlite.prepare(`SELECT * FROM ${t}`).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject(before.get(t)![0] as Record<string, unknown>);
      }
      const item = upgraded.db.select().from(schema.mergeQueueItems).get()!;
      expect(item.commitSha).toBeNull();
      expect(item.output).toBeNull();
      upgraded.db.update(schema.mergeQueueItems).set({ commitSha: 'abc123', output: 'Merged' }).run();
      expect(upgraded.db.select().from(schema.mergeQueueItems).get()).toMatchObject({ commitSha: 'abc123', output: 'Merged' });
    } finally { upgraded.close(); }
  });

  it('upgrades a milestone 4 database with its data intact and adds task kind and creation phase', () => {
    const dbPath = path.join(tempDir, 'milestone4.db');
    const old = new Database(dbPath);
    const migrations = readMigrationFiles({ migrationsFolder: path.resolve(import.meta.dirname, '../drizzle') });
    old.exec('CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)');
    for (const migration of migrations.slice(0, 4)) {
      for (const statement of migration.sql) old.exec(statement);
      old.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?, ?)').run(migration.hash, migration.folderMillis);
    }
    old.exec(`
      INSERT INTO workspaces VALUES ('ws', 'Milestone 3', '/repo', 'main', '{"verifyCommands":[]}', 123);
      INSERT INTO boards VALUES ('board', 'ws', 'dispatch', 123);
      INSERT INTO roles VALUES ('role', 'dev', 'prompt', '{}', 0, 123);
      INSERT INTO agents (id, workspace_id, role_id, name, cli_type, token_hash, created_at) VALUES ('agent', 'ws', 'role', 'Author', 'fake', 'hash', 123);
      INSERT INTO tasks (id, board_id, title, description, status, reviewer_agent_id, created_at, updated_at) VALUES ('task', 'board', 'Existing', 'Keep me', 'merge-queue', 'agent', 123, 123);
      INSERT INTO runs (id, task_id, agent_id, adapter, started_at, exit_reason, kind) VALUES ('run', 'task', 'agent', 'fake', 123, 'done', 'review');
      INSERT INTO verification_results VALUES ('result', 'run', 'review', 1, 'approved', 123);
      INSERT INTO messages VALUES ('msg', 'task', NULL, 'feedback', 'Keep feedback', 123);
      INSERT INTO merge_queue_items VALUES ('item', 'task', 1, 'queued', NULL, 123, 'landed-sha', 'Preserve output');
      INSERT INTO memory VALUES ('memory', 'ws', 'project', NULL, NULL, 'Summary', 'Keep memory', 'human', NULL, 123);
      INSERT INTO phase_outputs VALUES ('phase', 'board', 'spec', 'Keep draft', 'draft', NULL, 123);
    `);
    const tables = ['workspaces', 'boards', 'roles', 'agents', 'tasks', 'runs', 'verification_results', 'messages', 'merge_queue_items', 'memory', 'phase_outputs'];
    const before = new Map(tables.map(t => [t, old.prepare(`SELECT * FROM ${t}`).all()]));
    old.close();
    const upgraded = createCrewDatabase({ dbPath });
    try {
      expect(upgraded.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(5);
      for (const t of tables) {
        const rows = upgraded.sqlite.prepare(`SELECT * FROM ${t}`).all();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject(before.get(t)![0] as Record<string, unknown>);
      }
      expect(upgraded.sqlite.prepare('SELECT kind, creation_phase FROM tasks').get()).toEqual({ kind: 'work', creation_phase: null });
      upgraded.sqlite.prepare("UPDATE tasks SET creation_phase = 'tickets' WHERE id = 'task'").run();
      expect(upgraded.sqlite.prepare('SELECT creation_phase FROM tasks').get()).toEqual({ creation_phase: 'tickets' });
    } finally { upgraded.close(); }
  });

  it('reopening an up-to-date DB is a safe no-op', () => {
    const dbPath = path.join(tempDir, 'reopen.db');
    const first = createCrewDatabase({ dbPath });
    first.close();

    const second = createCrewDatabase({ dbPath });
    try {
      const migrationRows = second.sqlite.prepare('SELECT * FROM __drizzle_migrations').all();
      expect(migrationRows).toHaveLength(5);
    } finally {
      second.close();
    }
  });
});
