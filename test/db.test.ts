import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
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
});
