import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../src/cli/declarations.js';
import { generateCommandsMarkdown } from '../src/cli/generator.js';
import { createCli } from '../src/cli/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Commands reference (PRD Decision D3)', () => {
  it('docs/commands.md matches generated commands reference', () => {
    const docPath = path.resolve(__dirname, '../docs/commands.md');
    expect(fs.existsSync(docPath), 'docs/commands.md should exist').toBe(true);

    const docContent = fs.readFileSync(docPath, 'utf-8');
    const generated = generateCommandsMarkdown(COMMANDS);

    expect(docContent).toBe(generated);
  });

  it('Commander CLI registers all declared commands and generates help', () => {
    const cli = createCli(COMMANDS);
    const helpText = cli.helpInformation();

    expect(helpText).toContain('Usage: crew [options] [command]');
    expect(helpText).toContain('Turn AI coding agents into a dev team with its own memory');

    for (const cmd of COMMANDS.filter((c) => !c.hidden)) {
      expect(helpText).toContain(cmd.name);
    }
  });
});
