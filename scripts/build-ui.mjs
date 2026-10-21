import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const args of [
  ['ci', '--prefix', 'ui', '--include=dev'],
  ['--prefix', 'ui', 'run', 'typecheck'],
  ['--prefix', 'ui', 'run', 'lint'],
  ['--prefix', 'ui', 'run', 'build'],
]) {
  const result = spawnSync(npm, args, { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const out = new URL('../ui/out/', import.meta.url);
if (!existsSync(new URL('index.html', out))) throw new Error('Static export has no index.html');
const destination = new URL('../dist/ui/', import.meta.url);
if (existsSync(destination)) rmSync(destination, { recursive: true });
mkdirSync(destination, { recursive: true });
cpSync(out, destination, { recursive: true });
console.log('Board static export copied to dist/ui');
