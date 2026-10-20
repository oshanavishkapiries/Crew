import fs from 'node:fs';
import { postTaskAction } from '../client.js';
export async function handlePhase(action: string | undefined, options: { output?: string }) {
  if (action !== undefined && action !== 'done') throw new Error('Use crew phase or crew phase done --output <file>.');
  if (action === 'done' && !options.output) throw new Error('crew phase done requires --output <file>.');
  const result = await postTaskAction('phase', action === 'done' ? 'phase-done' : 'phase', action === 'done' ? { output: fs.readFileSync(options.output!, 'utf8') } : {});
  console.log(JSON.stringify(result, null, 2));
}
