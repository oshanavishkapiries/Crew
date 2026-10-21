'use client';
import { useState } from 'react';
import type { BoardTask, StatusResponse } from '@/lib/board-types';
import { api } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
export function TaskCard({ task, status, onOpen, refresh }: { task: BoardTask; status?: StatusResponse; onOpen: () => void; refresh: () => void }) {
  const agent = status?.agents.find(agent => agent.id === (task.assigneeAgentId ?? task.staleAgentId));
  const stale = !task.assigneeAgentId && !!task.staleAgentId;
  const displayStatus = stale ? 'stale (previous run)' : agent?.status;
  const rateLimit = status?.rateLimits.find(limit => limit.cliType === agent?.cliType && limit.isPaused);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const name = agent?.name ?? task.assigneeAgentName;
  return <Card data-task-id={task.id} className="relative bg-card">
    <CardContent className="space-y-3 p-3">
      <Button variant="link" className="h-auto w-full justify-start whitespace-normal p-0 text-left" onClick={onOpen}>{task.title}</Button>
      <div className="flex flex-wrap gap-1"><Badge variant="outline">{task.status}</Badge>{task.kind === 'phase' && <Badge>Phase task</Badge>}<Badge variant="secondary">{task.retries} retries</Badge></div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary font-medium text-secondary-foreground" aria-label={name ?? 'Unassigned'}>{name ? name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase() : '—'}<span className={`absolute right-0 bottom-0 size-2 rounded-full ring-2 ring-card ${(stale || agent?.status === 'stale' || agent?.status === 'rate-limited') ? 'bg-destructive' : (agent?.status === 'busy' || agent?.status === 'running') ? 'bg-primary' : 'bg-muted-foreground'}`} /></span>
        <span>{name ?? 'Unassigned'}<br />{displayStatus ?? 'Waiting for assignment'}</span>
      </div>
      {(stale || agent?.status === 'stale') && <Badge variant="destructive">stale</Badge>}
      {rateLimit && <Badge variant="outline">Rate-limited · {agent?.cliType}</Badge>}
      {task.status === 'todo' && <p className="text-xs text-muted-foreground">Queued for dependencies or phase approval.</p>}
      {task.status === 'blocked' && <p className="text-xs text-muted-foreground">Waiting for an answer. Open Messages, then use <code>crew answer {task.id} &quot;answer&quot;</code> or Inbox.</p>}
      {task.status === 'escalated' && <div className="space-y-2"><p className="break-all text-xs text-muted-foreground">Inspect the task, then retry: <code>crew retry {task.id}</code></p><p className="text-xs text-muted-foreground">{status?.stopped ? 'Resume dispatch before retrying.' : 'Retry uses the existing branch and worktree.'}</p><Button size="sm" variant="outline" disabled={busy || !status || status.stopped} onClick={async () => {
        setBusy(true); setError(''); try { await api(`/api/tasks/${encodeURIComponent(task.id)}/retry`, { method: 'POST' }); refresh(); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
      }}>{busy ? 'Retrying…' : 'Retry'}</Button>{error && <p role="alert" className="text-xs text-destructive">{error}</p>}</div>}
    </CardContent>
  </Card>;
}
