/** Manual, paid: three tiny Codex turns in an isolated repository. Never part of npm test. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execa } from 'execa';

const destination = path.resolve('test/fixtures/codex');
const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-codex-fixtures-'));
const records: unknown[] = [];
const version = (await execa('codex', ['--version'])).stdout.trim();
fs.mkdirSync(destination, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (key.startsWith('CREW_') || key === 'CODEX_THREAD_ID') delete env[key];
const common = ['--ignore-user-config', '--ignore-rules', '-c', 'approval_policy="never"', '-c', 'sandbox_workspace_write.network_access=false'];
async function record(name: string, args: string[], prompt: string) {
  const started = Date.now();
  const result = await execa('codex', ['exec', ...common, ...args], { cwd: repo, env, input: prompt, reject: false, timeout: 120_000 });
  // Refuse to persist any inherited credential accidentally returned by a tool.
  const secrets = Object.entries(process.env).filter(([key, value]) => /TOKEN|SECRET|API_KEY|PASSWORD/i.test(key) && value && value.length >= 12).map(([, value]) => value!);
  if (secrets.some(secret => result.stdout.includes(secret))) throw new Error('Credential detected; output was not saved.');
  fs.writeFileSync(path.join(destination, `${name}.jsonl`), result.stdout);
  const events = result.stdout.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const usage = events.filter(event => event.type === 'turn.completed').map(event => event.usage);
  const sessionId = events.find(event => event.type === 'thread.started')?.thread_id;
  const entry = { name, args, prompt, exitCode: result.exitCode, durationMs: Date.now() - started, usage, costUsd: null, costNote: 'CLI does not report USD cost; token usage recorded without estimating account billing.' };
  records.push(entry);
  console.log(JSON.stringify(entry));
  if (result.exitCode !== 0 || !events.some(event => event.type === 'turn.completed')) throw new Error(`${name} failed; stopping recording (raw stdout retained, stderr not persisted).`);
  return sessionId as string | undefined;
}
try {
  await execa('git', ['init', '-b', 'fixture'], { cwd: repo });
  await execa('git', ['-c', 'user.name=Crew Fixture', '-c', 'user.email=fixture@crew.local', '-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'fixture'], { cwd: repo });
  console.log(version);
  const sessionId = await record('short-task', ['--json', '-s', 'workspace-write', '-C', repo, '-'], 'Create hello.txt containing exactly hello followed by a newline. Do nothing else.');
  if (!sessionId || fs.readFileSync(path.join(repo, 'hello.txt'), 'utf8') !== 'hello\n') throw new Error('Missing session or expected edit.');
  await record('resume', ['-s', 'workspace-write', '-C', repo, 'resume', '--json', sessionId, '-'], 'What file did you just create? Reply with its name only; do not use tools.');
  await record('read-only', ['--json', '-s', 'read-only', '-C', repo, '-'], 'Try once to create denied.txt containing denied using a shell command. Do not request escalation or retry. Report the result briefly.');
  if (fs.existsSync(path.join(repo, 'denied.txt'))) throw new Error('Read-only run wrote denied.txt: sandbox enforcement failed.');
} catch (error) {
  // execa errors may embed environment or stderr; never print them.
  console.log(error instanceof Error && !('shortMessage' in error) ? error.message : 'Codex recording failed or timed out; no further paid runs attempted.');
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(destination, 'recording.json'), JSON.stringify({ version, recordedAt: new Date().toISOString(), records }, null, 2) + '\n');
  fs.rmSync(repo, { recursive: true, force: true });
}
