import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Agent commands through the real CLI (D13)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness();
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  const startTask = async (id: string) => {
    await harness.createTask({ id, title: id, description: 'test task' });
    await harness.scheduler.transitionTask(id, 'doing', { reason: 'test' });
  };

  it('rejects crew update with an unknown token and records nothing', async () => {
    await startTask('task-bad-token');

    const result = await harness.runCrew(['update', 'sneaky update'], {
      CREW_TASK_ID: 'task-bad-token',
      CREW_AGENT_TOKEN: 'crew_agent_not_a_real_token',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('401');
    expect(harness.getMessages('task-bad-token')).toHaveLength(0);
  });

  it("rejects one agent acting on another agent's task (user story 125)", async () => {
    await startTask('task-other-agent');
    const otherToken = harness.addAgent('agent-intruder');

    const result = await harness.runCrew(['done', '--result', 'not mine'], {
      CREW_TASK_ID: 'task-other-agent',
      CREW_AGENT_TOKEN: otherToken,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('403');
    expect(harness.getTask('task-other-agent')!.status).toBe('doing');
    expect(harness.getMessages('task-other-agent')).toHaveLength(0);
  });

  it('fails with a clear error when CREW_AGENT_TOKEN is missing', async () => {
    await startTask('task-no-token');

    const result = await harness.runCrew(['update', 'hello'], { CREW_TASK_ID: 'task-no-token' });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CREW_AGENT_TOKEN');
  });

  it('answers crew done on a task in the wrong state with 409 and keeps no partial writes', async () => {
    // Ready, not doing: done is not a valid transition
    await harness.createTask({ id: 'task-not-started', title: 'not started', description: 'test task' });

    const result = await harness.runCrew(['done', '--result', 'too early'], {
      CREW_TASK_ID: 'task-not-started',
      CREW_AGENT_TOKEN: harness.agentToken,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('409');
    expect(harness.getTask('task-not-started')!.status).toBe('ready');
    expect(harness.getMessages('task-not-started')).toHaveLength(0);
  });

  it('passes messages with quotes and shell syntax through verbatim', async () => {
    const tricky = `He said "ship it" $(echo pwned) \`whoami\` 'done'`;
    await harness.createTask({ id: 'task-quoting', title: 'quoting', description: 'test task' });

    const run = await harness.runTaskWithAgent('task-quoting', [
      { type: 'update', message: tricky },
      { type: 'update', message: '--looks-like-a-flag' },
      { type: 'done', result: tricky },
    ]);

    expect(run.exitCode).toBe(0);
    const bodies = harness.getMessages('task-quoting').map((m) => m.body);
    expect(bodies).toEqual(expect.arrayContaining([tricky, '--looks-like-a-flag']));
    expect(bodies.filter((b) => b === tricky)).toHaveLength(2);
    expect(harness.getTask('task-quoting')!.status).toBe('verifying');
  });

  it('join requires an agent token without falling back to human credentials', async () => {
    const result = await harness.runCrew(['join']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('CREW_AGENT_TOKEN');
    expect(result.stderr).not.toContain('not implemented');
  });
});
