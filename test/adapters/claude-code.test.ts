import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter, BASE_ALLOWED_TOOLS, FIXED_DENIED_TOOLS, MINIMUM_CLAUDE_CODE_VERSION } from '../../src/adapters/claude-code.js';

describe('Claude Code Adapter Contract Tests (PRD Milestone 2 Bullet 8)', () => {
  const adapter = new ClaudeCodeAdapter();

  describe('detect', () => {
    it('detects installed claude cli and reports version and headless support', async () => {
      const result = await adapter.detect();
      expect(result.installed).toBe(true);
      expect(result.headless).toBe(true);
      expect(result.version).toBeDefined();

      // Ensure version is at least MINIMUM_CLAUDE_CODE_VERSION (2.1.0)
      const semverRegex = /^(\d+)\.(\d+)\.(\d+)/;
      expect(result.version).toMatch(semverRegex);
      const match = result.version!.match(semverRegex)!;
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      expect(major > 2 || (major === 2 && minor >= 1)).toBe(true);
    });
  });

  describe('buildSpawn', () => {
    it('builds spawn command with standard permission profile (dontAsk, allowed tools, deny list)', () => {
      const sessionId = '11111111-2222-3333-4444-555555555555';
      const spawnConfig = adapter.buildSpawn({
        prompt: 'Implement auth feature',
        workDir: '/path/to/worktree',
        permissions: {
          mode: 'standard',
          allowCommands: ['npm test'],
          denyCommands: ['curl'],
        },
        taskId: 'task-100',
        serverUrl: 'http://127.0.0.1:4000',
        agentToken: 'crew_agent_token_123',
        sessionId,
      });

      expect(spawnConfig.command).toBe('claude');
      expect(spawnConfig.args).toContain('-p');
      expect(spawnConfig.args).toContain('--output-format');
      expect(spawnConfig.args).toContain('stream-json');
      expect(spawnConfig.args).toContain('--verbose');
      expect(spawnConfig.args).toContain('--session-id');
      expect(spawnConfig.args).toContain(sessionId);
      expect(spawnConfig.args).toContain('--permission-mode');
      expect(spawnConfig.args).toContain('dontAsk');
      expect(spawnConfig.args).toContain('--permission-prompts');
      expect(spawnConfig.args).toContain('none');

      // Check allowed tools
      const allowedToolsIdx = spawnConfig.args.indexOf('--allowedTools');
      expect(allowedToolsIdx).toBeGreaterThan(-1);
      const allowedToolsStr = spawnConfig.args[allowedToolsIdx + 1];
      for (const tool of BASE_ALLOWED_TOOLS) {
        expect(allowedToolsStr).toContain(tool);
      }
      expect(allowedToolsStr).toContain('Bash(npm test');

      // Check disallowed tools
      const disallowedToolsIdx = spawnConfig.args.indexOf('--disallowedTools');
      expect(disallowedToolsIdx).toBeGreaterThan(-1);
      const disallowedToolsStr = spawnConfig.args[disallowedToolsIdx + 1];
      for (const tool of FIXED_DENIED_TOOLS) {
        expect(disallowedToolsStr).toContain(tool);
      }
      expect(disallowedToolsStr).toContain('Bash(curl');

      // Check env vars
      expect(spawnConfig.env.CREW_TASK_ID).toBe('task-100');
      expect(spawnConfig.env.CREW_SERVER_URL).toBe('http://127.0.0.1:4000');
      expect(spawnConfig.env.CREW_AGENT_TOKEN).toBe('crew_agent_token_123');
      expect(spawnConfig.env.CREW_SESSION_ID).toBe(sessionId);
    });

    it('builds spawn command with full permission profile (acceptEdits, Bash(*), while retaining fixed deny list)', () => {
      const sessionId = '99999999-8888-7777-6666-555555555555';
      const spawnConfig = adapter.buildSpawn({
        prompt: 'Full access task',
        workDir: '/path/to/worktree',
        permissions: {
          mode: 'full',
          allowCommands: [],
          denyCommands: [],
        },
        taskId: 'task-full',
        serverUrl: 'http://127.0.0.1:4000',
        agentToken: 'token_full',
        sessionId,
      });

      expect(spawnConfig.args).toContain('--permission-mode');
      expect(spawnConfig.args).toContain('acceptEdits');
      expect(spawnConfig.args).toContain('--permission-prompts');
      expect(spawnConfig.args).toContain('none');

      const allowedToolsIdx = spawnConfig.args.indexOf('--allowedTools');
      const allowedToolsStr = spawnConfig.args[allowedToolsIdx + 1];
      expect(allowedToolsStr).toContain('Bash(*)');

      // Fixed deny list must still be present in disallowedTools
      const disallowedToolsIdx = spawnConfig.args.indexOf('--disallowedTools');
      const disallowedToolsStr = spawnConfig.args[disallowedToolsIdx + 1];
      expect(disallowedToolsStr).toContain('Bash(git push *)');
      expect(disallowedToolsStr).toContain('Bash(sudo *)');
      expect(disallowedToolsStr).toContain('Bash(rm -rf / *)');
    });
  });

  describe('buildResume', () => {
    it('builds resume command with --resume flag and session ID', () => {
      const sessionId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
      const resumeConfig = adapter.buildResume({
        sessionId,
        prompt: 'Use ESM modules',
        workDir: '/path/to/worktree',
        permissions: {
          mode: 'standard',
        },
        taskId: 'task-resume',
        serverUrl: 'http://127.0.0.1:4000',
        agentToken: 'resume_token',
      });

      expect(resumeConfig.command).toBe('claude');
      expect(resumeConfig.args).toContain('-p');
      expect(resumeConfig.args).toContain('--resume');
      expect(resumeConfig.args).toContain(sessionId);
      expect(resumeConfig.args).toContain('--output-format');
      expect(resumeConfig.args).toContain('stream-json');
      expect(resumeConfig.args).toContain('--verbose');
      expect(resumeConfig.args).toContain('--permission-mode');
      expect(resumeConfig.args).toContain('dontAsk');
      expect(resumeConfig.args).toContain('--permission-prompts');
      expect(resumeConfig.args).toContain('none');

      expect(resumeConfig.env.CREW_SESSION_ID).toBe(sessionId);
    });
  });

  describe('parseOutput', () => {
    it('parses real recorded short-task stream-json fixture', () => {
      const fixturePath = path.resolve(import.meta.dirname, '../fixtures/claude-code/short-task.jsonl');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const events = adapter.parseOutput(content);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.type).toBeDefined();
        expect(event.sessionId).toBe('c115c935-6316-4ae9-8869-82597eedb4af');
      }

      // Check specific event types exist in fixture
      const types = events.map((e) => e.type);
      expect(types).toContain('system');
      expect(types).toContain('assistant');
      expect(types).toContain('rate_limit_event');
      expect(types).toContain('result');

      // Check result event is captured properly
      const resultEvent = events.find((e) => e.type === 'result');
      expect(resultEvent).toBeDefined();
      expect(resultEvent!.isError).toBe(false);
      expect((resultEvent!.data as any).total_cost_usd).toBeGreaterThan(0);
    });

    it('parses real recorded resume stream-json fixture', () => {
      const fixturePath = path.resolve(import.meta.dirname, '../fixtures/claude-code/resume.jsonl');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const events = adapter.parseOutput(content);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(event.sessionId).toBe('c115c935-6316-4ae9-8869-82597eedb4af');
      }

      const rateLimitEvent = events.find((e) => e.type === 'rate_limit_event');
      expect(rateLimitEvent).toBeDefined();
      expect(rateLimitEvent!.rateLimitResetTime).toBeDefined();
      // Unix timestamp 1792406400 -> valid ISO date
      expect(new Date(rateLimitEvent!.rateLimitResetTime!).getTime()).toBe(1792406400 * 1000);
    });
  });

  describe('isRateLimit', () => {
    it('returns false for rate_limit_event when status is allowed', () => {
      const allowedEvent = {
        type: 'rate_limit_event',
        data: {
          rate_limit_info: {
            status: 'allowed',
            resetsAt: 1792406400,
          },
        },
        timestamp: new Date().toISOString(),
      };
      expect(adapter.isRateLimit(allowedEvent)).toBe(false);
    });

    it('returns true for rate_limit_event when status is rejected', () => {
      const rejectedEvent = {
        type: 'rate_limit_event',
        data: {
          rate_limit_info: {
            status: 'rejected',
            resetsAt: 1792406400,
          },
        },
        timestamp: new Date().toISOString(),
      };
      expect(adapter.isRateLimit(rejectedEvent)).toBe(true);
    });

    it('returns true for error events with rate_limit_error or code 429', () => {
      const errorEvent1 = {
        type: 'error',
        data: {
          error: {
            type: 'rate_limit_error',
            message: 'Too many requests',
          },
        },
        timestamp: new Date().toISOString(),
      };
      expect(adapter.isRateLimit(errorEvent1)).toBe(true);

      const errorEvent2 = {
        type: 'error',
        data: {
          error: {
            code: 429,
            message: 'Rate limit exceeded',
          },
        },
        timestamp: new Date().toISOString(),
      };
      expect(adapter.isRateLimit(errorEvent2)).toBe(true);
    });

    it('recognises synthetic rate limit fixture', () => {
      const fixturePath = path.resolve(import.meta.dirname, '../fixtures/claude-code/rate-limit-synthetic.jsonl');
      const content = fs.readFileSync(fixturePath, 'utf-8');
      const events = adapter.parseOutput(content);

      expect(events).toHaveLength(2);
      expect(adapter.isRateLimit(events[0])).toBe(true);
      expect(adapter.isRateLimit(events[1])).toBe(true);
      expect(events[0].rateLimitResetTime).toBe(new Date(1792406400 * 1000).toISOString());
    });
  });
});
