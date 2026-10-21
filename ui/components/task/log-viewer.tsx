'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { createLogBuffer, parseHistory, renderEvent, type LogEntry } from '@/lib/task-logic';
import type { TaskLogs, TaskRun } from '@/lib/task-types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
// Named types emitted by FakeAdapter and ClaudeCodeAdapter; unknown history
// types still render as structured events. Server run streams have no replay.
const eventTypes = ['start', 'system', 'assistant', 'user', 'result', 'error', 'tool_call', 'tool_result', 'text', 'file_edit', 'custom_command', 'rate_limit', 'rate_limit_event', 'stream_event', 'content_block_delta', 'content_block_start'];
export function LogViewer({ taskId, run, onEnded }: { taskId: string; run?: TaskRun; onEnded: () => void }) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [connection, setConnection] = useState('History');
  const [paused, setPaused] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const ended = useRef(onEnded);
  useEffect(() => { ended.current = onEnded; }, [onEnded]);
  const liveRunId = run && !run.endedAt ? run.id : undefined;
  useEffect(() => {
    const controller = new AbortController();
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const buffer = createLogBuffer();
    let flush: ReturnType<typeof setTimeout> | undefined;
    function commit() { setEntries(buffer.entries()); }
    function receive(type: string, payload: unknown) {
      const events = renderEvent(type, payload);
      for (const entry of events) buffer.receive(entry);
      if (!flush) flush = setTimeout(() => { flush = undefined; if (!controller.signal.aborted) commit(); }, 80);
    }
    async function history() {
      const current = buffer.begin();
      try {
        const data = await api<TaskLogs>(`/api/tasks/${encodeURIComponent(taskId)}/logs`, { signal: controller.signal });
        if (controller.signal.aborted || !buffer.finish(current, parseHistory(data.content))) return;
        // No event IDs: the snapshot and staged events can overlap slightly.
        commit(); setError('');
      } catch (error) { if (!controller.signal.aborted && buffer.finish(current)) { setError(error instanceof Error ? error.message : String(error)); commit(); } }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    function connect() {
      if (controller.signal.aborted || !liveRunId) return;
      setConnection(retries ? 'Reconnecting' : 'Connecting');
      source = new EventSource(`/api/runs/${encodeURIComponent(liveRunId)}/stream`);
      source.onopen = () => { retries = 0; setConnection('Live'); void history(); };
      for (const type of eventTypes) source.addEventListener(type, event => {
        try { receive(type, JSON.parse((event as MessageEvent).data)); }
        catch { receive('text', (event as MessageEvent).data); }
      });
      source.addEventListener('run_ended', event => {
        source?.close(); clearTimeout(timer); setConnection('Ended');
        try { receive('run_ended', JSON.parse((event as MessageEvent).data)); } catch { /* snapshot supplies exit reason */ }
        void history(); ended.current();
      });
      source.onerror = () => {
        source?.close(); setConnection('Reconnecting');
        void api('/api/session', { signal: controller.signal }).catch(() => {});
        // A missed run_ended is recovered by the parent task snapshot/poll.
        ended.current();
        timer = setTimeout(connect, Math.min(1000 * 2 ** retries++, 30000));
      };
    }
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setLoading(true); setEntries([]); setError(''); setPaused(false);
      if (liveRunId) connect(); else setConnection('History');
      void history();
    });
    return () => { controller.abort(); source?.close(); clearTimeout(timer); clearTimeout(flush); };
  }, [taskId, liveRunId, attempt]);
  useEffect(() => { if (!paused && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight; }, [entries, paused]);
  return <div className="space-y-3"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{connection}</Badge><Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Reload log</Button>{paused && <Button size="sm" variant="secondary" onClick={() => setPaused(false)}>Follow latest</Button>}</div>
    <p className="text-xs text-muted-foreground">Latest run only. Up to 500 entries, 8,000 characters each. Older output may be omitted. Reconnecting can repeat a few events.</p>
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {loading && <Skeleton className="h-24 w-full" aria-label="Loading log" />}
    {!loading && entries.length === 0 && <p>No log output yet.</p>}
    <div ref={scroll} role="log" aria-label="Agent log" className="h-96 overflow-auto rounded-lg border p-3" onScroll={() => { const node = scroll.current; if (node) setPaused(node.scrollHeight - node.scrollTop - node.clientHeight > 40); }}>
      {entries.map((entry, index) => <div key={index} className={`mb-3 rounded-md p-2 ${entry.type === 'tool' ? 'border bg-muted' : entry.type === 'result' ? 'border-l-2 border-primary' : ''}`}><Badge variant="outline" className="mb-1">{entry.type}</Badge><pre className="whitespace-pre-wrap break-words font-mono text-xs">{entry.text}</pre></div>)}
    </div>
  </div>;
}
