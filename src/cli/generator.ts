import { COMMANDS } from './declarations.js';
import type { CommandDefinition } from './types.js';

export function renderCommandMarkdown(cmd: CommandDefinition): string {
  const parts: string[] = [];

  parts.push(`### \`crew ${cmd.name}\`\n`);
  parts.push(`${cmd.description}\n`);

  if (cmd.args && cmd.args.length > 0) {
    parts.push(`**Arguments:**\n`);
    for (const arg of cmd.args) {
      const requiredStr = arg.required ? '(required)' : '(optional)';
      parts.push(`- \`${arg.name}\` ${requiredStr}: ${arg.description}`);
    }
    parts.push('');
  }

  if (cmd.options && cmd.options.length > 0) {
    parts.push(`**Options:**\n`);
    for (const opt of cmd.options) {
      const defaultStr = opt.defaultValue !== undefined ? ` (default: \`${opt.defaultValue}\`)` : '';
      parts.push(`- \`${opt.flags}\`: ${opt.description}${defaultStr}`);
    }
    parts.push('');
  }

  if (cmd.examples && cmd.examples.length > 0) {
    parts.push(`**Examples:**\n`);
    for (const ex of cmd.examples) {
      parts.push(`${ex.description}:\n`);
      parts.push('```bash');
      parts.push(ex.command);
      parts.push('```\n');
    }
  }

  return parts.join('\n');
}

export function generateCommandsMarkdown(commands: CommandDefinition[] = COMMANDS): string {
  const visibleCommands = commands.filter((c) => !c.hidden);
  const humanCmds = visibleCommands.filter((c) => c.category === 'human');
  const agentCmds = visibleCommands.filter((c) => c.category === 'agent');
  const orchestratorCmds = visibleCommands.filter((c) => c.category === 'orchestrator');

  const lines: string[] = [
    '# Crew Commands Reference',
    '',
    '> **Note:** This document is generated from command declarations in `src/cli/declarations.ts`.',
    '> A test enforces that this file never drifts from the CLI definitions (PRD Decision D3).',
    '',
    '## Human Commands',
    '',
    'Commands used by developers to manage workspaces, start the server, inspect agents, and approve workflow gates.',
    '',
    humanCmds.map(renderCommandMarkdown).join('\n---\n\n'),
    '',
    '## Agent Commands',
    '',
    'Commands executed by AI agents in their worktrees to communicate progress, ask questions, and submit work.',
    '',
    agentCmds.map(renderCommandMarkdown).join('\n---\n\n'),
    '',
    '## Orchestrator Commands',
    '',
    'Commands used specifically by the Orchestrator agent to create tickets, manage phases, and assign tasks.',
    '',
    orchestratorCmds.map(renderCommandMarkdown).join('\n---\n\n'),
    '',
  ];

  return lines.join('\n');
}
