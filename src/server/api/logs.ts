import * as fs from 'node:fs';
import * as path from 'node:path';

export const DEFAULT_LOG_TAIL = 256 * 1024;
export const MAX_LOG_TAIL = 2 * 1024 * 1024;
export class LogReadError extends Error {
  constructor(message: string, readonly status: 400 | 403 = 400) { super(message); }
}
export function logTailBytes(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LOG_TAIL;
  const bytes = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > MAX_LOG_TAIL)
    throw new LogReadError(`tail must be an integer from 1 to ${MAX_LOG_TAIL} bytes. Correct --tail and retry crew logs.`);
  return bytes;
}
/** Read only a bounded tail. Resolve symlinks before opening, then refuse a final symlink. */
export function readRunLog(crewHome: string, logPath: string | null, tail: number) {
  const missing = { content: '', missing: true, truncated: false, offset: 0 };
  if (!logPath) return missing;
  const root = path.join(path.resolve(crewHome), 'logs');
  const within = (base: string, target: string) => { const relative = path.relative(base, target); return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
  const unsafe = () => new LogReadError('Log path is outside the Crew logs directory. Restore the log under <crewHome>/logs, then retry crew logs.', 403);
  if (!within(root, path.resolve(logPath))) throw unsafe();
  let fd: number | undefined;
  try {
    const canonicalRoot = fs.realpathSync(root);
    if (canonicalRoot !== path.join(fs.realpathSync(crewHome), 'logs')) throw unsafe();
    const canonicalFile = fs.realpathSync(logPath);
    if (!within(canonicalRoot, canonicalFile)) throw unsafe();
    fd = fs.openSync(canonicalFile, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new LogReadError('The run log is not a regular file. Restore its .jsonl file under <crewHome>/logs and retry.', 403);
    const offset = Math.max(0, stat.size - tail);
    const buffer = Buffer.alloc(Math.min(stat.size, tail));
    let read = 0;
    while (read < buffer.length) {
      const n = fs.readSync(fd, buffer, read, buffer.length - read, offset + read);
      if (!n) break;
      read += n;
    }
    return { content: buffer.subarray(0, read).toString('utf8'), missing: false, truncated: offset > 0, offset };
  } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return missing;
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw unsafe();
    if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new LogReadError('Cannot read this run log. Check file permissions under <crewHome>/logs and retry crew logs.', 403);
    throw error;
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
