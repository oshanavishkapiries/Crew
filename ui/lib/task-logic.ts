export interface LogEntry { type: 'text' | 'tool' | 'result' | 'event'; text: string }
const maxEntries = 500;
const maxText = 8000;
export function appendLog(entries: LogEntry[], entry: LogEntry): LogEntry[] {
  const bounded = entry.text.length > maxText ? { ...entry, text: entry.text.slice(0, maxText - 20) + '\n[entry truncated]' } : entry;
  return [...entries.slice(-(maxEntries - 1)), bounded];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
export function renderEvent(type: string, payload: unknown): LogEntry[] {
  const data = object(payload);
  const content = object(data.message).content;
  if (Array.isArray(content)) return content.map(block => {
    const part = object(block);
    if (part.type === 'text') return { type: 'text', text: String(part.text ?? '') };
    if (part.type === 'tool_use') return { type: 'tool', text: `${part.name}\n${display(part.input)}` };
    if (part.type === 'tool_result') return { type: 'result', text: display(part.content) };
    return { type: 'event', text: display(part) };
  });
  const delta = object(data.delta);
  if (typeof delta.text === 'string') return [{ type: 'text', text: delta.text }];
  if (type === 'stream_event' && data.event) {
    const event = object(data.event);
    return renderEvent(String(event.type ?? type), event);
  }
  const body = data.data ?? payload;
  return [{ type: /tool|command|file_edit/.test(type) ? 'tool' : /result|error|run_ended/.test(type) ? 'result' : /text|assistant/.test(type) ? 'text' : 'event', text: display(body) }];
}
export function parseHistory(content: string): LogEntry[] {
  let entries: LogEntry[] = [];
  // Bound parsing too, not just DOM nodes. The API bounds file reads; keep parsing and DOM bounds too.
  for (const line of content.slice(-2_000_000).split('\n').slice(-1000)) {
    if (!line.trim()) continue;
    let rendered: LogEntry[];
    try { const parsed = JSON.parse(line); rendered = renderEvent(String(parsed.type ?? 'event'), parsed); }
    catch { rendered = [{ type: 'text', text: line }]; }
    for (const entry of rendered) entries = appendLog(entries, entry);
  }
  return entries;
}
export interface DiffFile { name: string; lines: { text: string; kind: 'addition' | 'deletion' | 'meta' }[] }
export function splitDiff(diff: string) {
  const limit = 250000;
  const lines = diff.slice(0, limit).split('\n');
  const truncated = diff.length > limit || lines.length > 3000;
  const files: DiffFile[] = [];
  for (const line of lines.slice(0, 3000)) {
    if (line.startsWith('diff --git ') || files.length === 0) files.push({ name: line.startsWith('diff --git ') ? line.slice(11) : 'Diff', lines: [] });
    const kind = line.startsWith('+') && !line.startsWith('+++') ? 'addition' : line.startsWith('-') && !line.startsWith('---') ? 'deletion' : 'meta';
    files[files.length - 1].lines.push({ text: line, kind });
  }
  return { files: diff ? files : [], truncated };
}
/** Stage live events during every history request, including reconnects. */
export function createLogBuffer() {
  let current: LogEntry[] = [];
  let staged: LogEntry[] = [];
  let pending = false;
  let generation = 0;
  return {
    begin() { pending = true; return ++generation; },
    receive(entry: LogEntry) { if (pending) staged = appendLog(staged, entry); else current = appendLog(current, entry); },
    finish(id: number, snapshot?: LogEntry[]) {
      if (id !== generation) return false;
      if (snapshot) current = snapshot;
      for (const entry of staged) current = appendLog(current, entry);
      staged = []; pending = false; return true;
    },
    entries() { return current; },
  };
}

/** Keep an explicitly selected historical run while new runs arrive. */
export function selectLogRun<T extends { id: string }>(runs: T[], selected: string): T | undefined {
  return selected === "latest" ? runs.at(-1) : runs.find(run => run.id === selected);
}
export function runLogPath(taskId: string, runId: string | undefined, tail: number) {
  const query = new URLSearchParams({ tail: String(tail) });
  if (runId) query.set("run", runId);
  return `/api/tasks/${encodeURIComponent(taskId)}/logs?${query}`;
}
