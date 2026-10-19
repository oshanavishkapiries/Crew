import * as fs from 'node:fs';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/server/db/schema.js';
import { ensureClaudeSettings } from '../../src/server/runner/index.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Claude Code Stop hook (PRD Decision D26, D36)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('ensureClaudeSettings writes valid claude-settings.json with crew hook stop', () => {
    const settingsPath = ensureClaudeSettings(harness.crewHomeDir);
    expect(fs.existsSync(settingsPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
    expect(content.hooks).toBeDefined();
    expect(content.hooks.Stop).toBeDefined();
    expect(content.hooks.Stop[0].hooks[0].type).toBe('command');
    expect(content.hooks.Stop[0].hooks[0].command).toBe('crew hook stop');
  });

  it('crew hook stop blocks while doing, gives up after 2 blocks (D36)', async () => {
    const taskId = 'task-hook-block-test';
    await harness.createTask({ id: taskId, title: 'Hook block test', description: 'Testing stop hook' });
    const agentToken = harness.addAgent('agent-hook-block');
    await harness.scheduler.transitionTask(taskId, 'doing', {
      reason: 'Assigning to agent',
      alongside: () => {
        harness.db.db
          .update(schema.tasks)
          .set({ assigneeAgentId: 'agent-hook-block' })
          .where(eq(schema.tasks.id, taskId))
          .run();
      },
    });

    const env = {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: agentToken,
      CREW_RUN_ID: 'run-block-1',
      CREW_HOME: harness.crewHomeDir,
    };

    // First stop attempt: should block (exit 2)
    const res1 = await harness.runCrew(['hook', 'stop'], env);
    expect(res1.exitCode).toBe(2);
    expect(res1.stderr).toContain('Call `crew done` when the work is finished, or `crew ask` if you\'re blocked.');

    // Second stop attempt: should block again (exit 2)
    const res2 = await harness.runCrew(['hook', 'stop'], env);
    expect(res2.exitCode).toBe(2);
    expect(res2.stderr).toContain('Call `crew done` when the work is finished, or `crew ask` if you\'re blocked.');

    // Third stop attempt: limit reached (2 blocks), should allow (exit 0)
    const res3 = await harness.runCrew(['hook', 'stop'], env);
    expect(res3.exitCode).toBe(0);
  });

  it('crew hook stop allows stopping when stop_hook_active is true on stdin', async () => {
    const taskId = 'task-hook-active-test';
    await harness.createTask({ id: taskId, title: 'Hook active test', description: 'Testing stop_hook_active' });
    const agentToken = harness.addAgent('agent-hook-active');
    await harness.scheduler.transitionTask(taskId, 'doing', {
      reason: 'Assigning to agent',
      alongside: () => {
        harness.db.db
          .update(schema.tasks)
          .set({ assigneeAgentId: 'agent-hook-active' })
          .where(eq(schema.tasks.id, taskId))
          .run();
      },
    });

    const env = {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: agentToken,
      CREW_RUN_ID: 'run-active-1',
      CREW_HOME: harness.crewHomeDir,
    };

    const stdinPayload = JSON.stringify({
      session_id: 'test-session',
      hook_event_name: 'Stop',
      stop_hook_active: true,
      last_assistant_message: 'Working on task',
    });

    const res = await harness.runCrew(['hook', 'stop'], env, { input: stdinPayload });
    expect(res.exitCode).toBe(0);
  });

  it('crew hook stop allows stopping when task is no longer doing (e.g. verifying or blocked)', async () => {
    const taskId = 'task-hook-done-test';
    await harness.createTask({ id: taskId, title: 'Hook done test', description: 'Testing status != doing' });
    const agentToken = harness.addAgent('agent-hook-done');
    await harness.scheduler.transitionTask(taskId, 'doing', {
      reason: 'Assigning to agent',
      alongside: () => {
        harness.db.db
          .update(schema.tasks)
          .set({ assigneeAgentId: 'agent-hook-done' })
          .where(eq(schema.tasks.id, taskId))
          .run();
      },
    });

    const env = {
      CREW_TASK_ID: taskId,
      CREW_AGENT_TOKEN: agentToken,
      CREW_RUN_ID: 'run-done-1',
      CREW_HOME: harness.crewHomeDir,
    };

    // Call crew done to move doing -> verifying
    const doneRes = await harness.runCrew(['done', '--result', 'Done with work'], env);
    expect(doneRes.exitCode).toBe(0);
    expect(harness.getTask(taskId)!.status).toBe('verifying');

    // Hook stop should now allow stopping (exit 0)
    const stopRes = await harness.runCrew(['hook', 'stop'], env);
    expect(stopRes.exitCode).toBe(0);
  });
});
