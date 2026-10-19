import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

// The harness drives the real `crew` binary in dist/, so build it from the current source
// first. Without this, tests would run whatever was built last (or fail on a fresh clone).
export default function setup(): void {
  const root = path.resolve(import.meta.dirname, '..');
  try {
    execFileSync('npm', ['run', 'build', '--silent'], { cwd: root, stdio: 'pipe' });
  } catch (err) {
    const output = (err as { stdout?: Buffer; stderr?: Buffer });
    throw new Error(`Building dist/ before tests failed:\n${output.stdout ?? ''}${output.stderr ?? ''}`);
  }
}
