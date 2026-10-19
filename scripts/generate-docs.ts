import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCommandsMarkdown } from '../src/cli/generator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFile = path.resolve(__dirname, '../docs/commands.md');
const content = generateCommandsMarkdown();

fs.writeFileSync(targetFile, content, 'utf-8');
console.log(`Successfully generated ${targetFile}`);
