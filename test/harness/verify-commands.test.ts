import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/server/db/schema.js';
import { createPipelineHarness, type PipelineHarness } from './index.js';

describe('Command gates and process group management (Milestone 3 Bullet 2)', () => {
  let harness: PipelineHarness;

  beforeAll(async () => {
    harness = await createPipelineHarness({
      startVerifier: true,
    });
  });

  afterAll(async () => {
    await harness.cleanup();
  });

  it('runs applicable verifyCommands matching path filters and skips non-matching ones', async () => {
    const taskId = 'task-cmd-path-filter';

    // Set 2 verify commands on workspace: one for *.txt, one for *.js
    harness.setVerifyCommands([
      {
        name: 'check-txt',
        command: 'test -f sample.txt',
        paths: ['*.txt'],
      },
      {
        name: 'check-js',
        command: 'node -e "process.exit(1)"', // would fail if run
        paths: ['*.js'],
      },
    ]);

    await harness.createTask({
      id: taskId,
      title: 'Path Filter Task',
      description: 'Tests that path filters only run matching commands',
    });

    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Creating sample.txt' },
      { type: 'edit_file', filePath: 'sample.txt', content: 'hello world\n' },
      { type: 'done', result: 'Created sample.txt' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for check-txt verification step
    const checkTxtStep = await harness.waitForVerificationStep(taskId, 'check-txt', 10000);
    expect(checkTxtStep.passed).toBe(true);

    const vrResults = harness.getVerificationResults(taskId);
    expect(vrResults.some((vr) => vr.step === 'check-txt' && vr.passed)).toBe(true);
    // check-js should NOT have run
    expect(vrResults.some((vr) => vr.step === 'check-js')).toBe(false);
  });

  it('reports all failing command gates together in feedback and caps output at 4KB per command (D32)', async () => {
    const taskId = 'task-cmd-multi-fail';

    // Large output string to test capping
    const largeOutput = 'A'.repeat(5000);

    harness.setVerifyCommands([
      {
        name: 'lint',
        command: 'node -e "console.log(\'Lint error: missing semicolon\'); process.exit(1)"',
      },
      {
        name: 'test-suite',
        command: `node -e "console.log('${largeOutput}'); console.log('Tests failed: 2 assertions failed'); process.exit(2)"`,
      },
    ]);

    await harness.createTask({
      id: taskId,
      title: 'Multi Command Fail Task',
      description: 'Tests reporting all failures together and output capping',
    });

    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Editing code' },
      { type: 'edit_file', filePath: 'code.ts', content: 'const a = 1' },
      { type: 'done', result: 'Edited code' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for task to return to doing with retries = 1
    const taskAfter = await harness.waitForTaskStatus(taskId, 'doing', 15000);
    expect(taskAfter.status).toBe('doing');
    expect(taskAfter.retries).toBe(1);

    const vrResults = harness.getVerificationResults(taskId);
    const lintVr = vrResults.find((vr) => vr.step === 'lint')!;
    const testVr = vrResults.find((vr) => vr.step === 'test-suite')!;

    expect(lintVr).toBeDefined();
    expect(lintVr.passed).toBe(false);
    expect(lintVr.output).toContain('Lint error: missing semicolon');

    expect(testVr).toBeDefined();
    expect(testVr.passed).toBe(false);
    expect(testVr.output).toContain('Tests failed: 2 assertions failed');
    // Full output stored in DB can be up to 64KB
    expect(testVr.output!.length).toBeGreaterThan(4500);

    // Check feedback message
    const messages = harness.getMessages(taskId);
    const feedback = messages.find((m) => m.type === 'feedback')!;
    expect(feedback).toBeDefined();
    // Both command failures reported together in feedback
    expect(feedback.body).toContain('lint');
    expect(feedback.body).toContain('Lint error: missing semicolon');
    expect(feedback.body).toContain('test-suite');
    expect(feedback.body).toContain('Tests failed: 2 assertions failed');

    // The individual section for test-suite in feedback must be capped at 4KB
    const testSuiteSection = feedback.body.split("Verification command 'test-suite' failed:")[1];
    expect(testSuiteSection.length).toBeLessThanOrEqual(4096 + 20); // within 4KB + newline
  });

  it('kills whole process group and grandchild when a verify command times out', async () => {
    const taskId = 'task-cmd-timeout-kill';

    // A verify command that spawns a grandchild process and hangs, with a 1500ms timeout
    const grandchildPidFile = 'grandchild.pid';
    harness.setVerifyCommands([
      {
        name: 'hanging-gate',
        command: `node -e "const { spawn } = require('node:child_process'); const fs = require('node:fs'); const child = spawn('sleep', ['300'], { stdio: 'ignore' }); fs.writeFileSync('${grandchildPidFile}', String(child.pid)); setInterval(() => {}, 1000);"`,
        timeoutMs: 1500,
      },
    ]);

    await harness.createTask({
      id: taskId,
      title: 'Command Timeout Task',
      description: 'Tests process group kill on verify command timeout',
    });

    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Making changes' },
      { type: 'edit_file', filePath: 'index.js', content: 'console.log(1);\n' },
      { type: 'done', result: 'Completed task' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for task to return to doing
    await harness.waitForTaskStatus(taskId, 'doing', 15000);

    const task = harness.getTask(taskId)!;
    const worktreePath = task.worktreePath!;
    const pidFilePath = path.join(worktreePath, grandchildPidFile);

    expect(fs.existsSync(pidFilePath)).toBe(true);
    const grandchildPid = Number(fs.readFileSync(pidFilePath, 'utf-8').trim());
    expect(grandchildPid).toBeGreaterThan(0);

    // Wait for process kill to complete
    await new Promise((r) => setTimeout(r, 1200));

    // Verify grandchild process is dead
    let isAlive = true;
    try {
      process.kill(grandchildPid, 0);
    } catch {
      isAlive = false;
    }
    expect(isAlive).toBe(false);

    // Verify verification_results record
    const vrResults = harness.getVerificationResults(taskId);
    const timeoutVr = vrResults.find((vr) => vr.step === 'hanging-gate')!;
    expect(timeoutVr).toBeDefined();
    expect(timeoutVr.passed).toBe(false);
    expect(timeoutVr.output).toContain('timed out after 1.5s');
  });

  it('executes verify command in specified cwd relative to worktree', async () => {
    const taskId = 'task-cmd-cwd';

    harness.setVerifyCommands([
      {
        name: 'subfolder-check',
        command: 'test -f nested.txt',
        cwd: 'packages/core',
      },
    ]);

    await harness.createTask({
      id: taskId,
      title: 'Cwd Verify Task',
      description: 'Tests verify command in specified cwd',
    });

    const runResult = await harness.runTaskWithAgent(taskId, [
      { type: 'update', message: 'Creating nested file' },
      {
        type: 'edit_file',
        filePath: 'packages/core/nested.txt',
        content: 'nested content\n',
      },
      { type: 'done', result: 'Created nested file' },
    ]);

    expect(runResult.exitCode).toBe(0);

    // Wait for subfolder-check verification step
    const step = await harness.waitForVerificationStep(taskId, 'subfolder-check', 10000);
    expect(step.passed).toBe(true);

    const vrResults = harness.getVerificationResults(taskId);
    const subVr = vrResults.find((vr) => vr.step === 'subfolder-check')!;
    expect(subVr).toBeDefined();
    expect(subVr.passed).toBe(true);
  });
});
