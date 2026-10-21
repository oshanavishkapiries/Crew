'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useBoardData } from '@/lib/board-data';
import { taskStatuses } from '@/lib/board-types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmAction } from './confirm-action';
import { DependencyArrows } from './dependency-arrows';
import { TaskCard } from './task-card';
import { TaskPanel } from '@/components/task/task-panel';
export function BoardView({ boardId }: { boardId: string }) {
  const { data, connection, refresh } = useBoardData(boardId);
  const router = useRouter(), params = useSearchParams();
  const container = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(0);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const phase = data.status?.phases.find(phase => phase.boardId === boardId);
  return <>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Button asChild variant="link" className="h-auto p-0"><Link href="/">All boards</Link></Button><h1 className="mt-2 text-2xl font-semibold">{data.board?.workspace.name ?? 'Board'}</h1><p className="text-sm text-muted-foreground">Phase: {phase?.phase ?? data.board?.currentPhase ?? 'Loading…'}</p></div>
      <div className="flex flex-wrap gap-2"><Badge variant={connection === 'live' ? 'default' : 'outline'} aria-live="polite">{connection}</Badge><Button variant="outline" onClick={refresh}>Refresh</Button><ConfirmAction label={data.status?.stopped ? 'Resume' : 'Stop all'} disabled={!data.status || Boolean(data.errors['Budget and phase'])} destructive={!data.status?.stopped} description={data.status?.stopped ? 'Resume dispatch across all workspaces.' : 'Stop all active agents and pause dispatch across all workspaces until Resume.'} onConfirm={async () => { await api(`/api/control/${data.status?.stopped ? 'resume' : 'stop-all'}`, { method: 'POST' }); refresh(); }} /></div>
    </div>
    {Object.entries(data.errors).map(([panel, message]) => <Alert key={panel} variant="destructive"><AlertTitle>{panel} unavailable</AlertTitle><AlertDescription>{message} Use Refresh to retry. Previous data may be stale.</AlertDescription></Alert>)}
    {data.status?.stopped && <Alert><AlertTitle>Dispatcher stopped</AlertTitle><AlertDescription>Tasks stay on the board. Use Resume when you are ready to restart dispatch.</AlertDescription></Alert>}
    {phase?.draftId && <Button asChild variant="outline" className="w-fit"><Link href={`/phase?board=${encodeURIComponent(boardId)}`}>Gate waiting · review the {phase.phase} draft</Link></Button>}
    {phase?.problem && <Alert variant="destructive"><AlertTitle>Phase needs attention</AlertTitle><AlertDescription>{phase.problem}</AlertDescription></Alert>}
    <Card><CardHeader><CardTitle>Runtime budget</CardTitle></CardHeader><CardContent className="flex flex-wrap gap-6 text-sm">
      {data.status ? <><p><strong>{data.status.liveRuns.length}</strong> parallel agents running</p><p><strong>{data.tasks?.reduce((sum, task) => sum + task.retries, 0) ?? '…'}</strong> retries on this board</p><p>{data.status.liveRuns.filter(run => data.tasks?.some(task => task.id === run.taskId)).length} active runs on this board</p><p className="text-muted-foreground">Configured parallel, retry and runtime limits are not exposed by this server.</p>{data.status.liveRuns.filter(run => data.tasks?.some(task => task.id === run.taskId)).map(run => <p key={run.id} className="break-all">{run.taskId}: {data.runStarts[run.id] && now ? `${Math.max(0, Math.floor((now - Date.parse(data.runStarts[run.id])) / 1000))}s elapsed` : 'Runtime pending'}</p>)}<div className="w-full space-y-1"><div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">{data.status.agents.map(agent => <span key={agent.id} className={`flex-1 ${agent.status === 'busy' ? 'bg-primary' : 'bg-secondary'}`} />)}</div><p className="text-xs text-muted-foreground">Agent activity across workspaces: {data.status.agents.filter(agent => agent.status === 'busy').length} / {data.status.agents.length} registered agents busy. This bar shows staffing activity, not configured budget capacity.</p></div>{data.status.rateLimits.filter(limit => limit.isPaused).map(limit => <Badge key={limit.cliType} variant="outline">{limit.cliType} rate-limited{limit.resetTime ? ` until ${new Date(limit.resetTime).toLocaleTimeString()}` : ''} · resumes automatically</Badge>)}</> : data.errors['Budget and phase'] ? <p>Budget unavailable. Use Refresh.</p> : <Skeleton className="h-6 w-full" aria-label="Loading budget" />}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Merge queue</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
      {data.queue ? <>{data.queue.warnings.filter(warning => warning.workspaceId === data.board?.workspaceId).map(warning => <Alert key={warning.workspaceId}><AlertTitle>Merge paused</AlertTitle><AlertDescription>{warning.message}</AlertDescription></Alert>)}{data.queue.items.filter(item => data.tasks?.some(task => task.id === item.taskId)).length === 0 ? <p className="text-muted-foreground">No queued merges for this board.</p> : data.queue.items.filter(item => data.tasks?.some(task => task.id === item.taskId)).map(item => <p key={item.id}>#{item.position} {item.title} <Badge variant="secondary">{item.status}</Badge></p>)}</> : data.errors['Merge queue'] ? <p>Queue unavailable. Use Refresh.</p> : <Skeleton className="h-6 w-full" aria-label="Loading merge queue" />}
    </CardContent></Card>
    {data.tasks === undefined ? data.errors.Tasks ? <p>Tasks unavailable. Use Refresh.</p> : <Skeleton className="h-64 w-full" aria-label="Loading tasks" /> : <>
      {data.tasks.length === 0 && <Alert><AlertTitle>No tasks yet</AlertTitle><AlertDescription>Create tickets with <code>crew ticket create --help</code>, or continue the phase workflow.</AlertDescription></Alert>}
      <p className="text-xs text-muted-foreground">Dashed arrows point from a blocker to its dependent task. Scroll horizontally to see every status.</p>
      <div className="overflow-x-auto pb-4"><div ref={container} className="relative flex w-max items-start gap-6 p-2">
        {taskStatuses.map(status => <section key={status} className="w-64 shrink-0 space-y-3" aria-label={`${status} tasks`}><h2 className="flex items-center justify-between font-medium">{status}<Badge variant="secondary">{data.tasks?.filter(task => task.status === status).length}</Badge></h2>{data.tasks?.filter(task => task.status === status).map(task => <TaskCard key={task.id} task={task} status={data.status} refresh={refresh} onOpen={() => { const next = new URLSearchParams(params.toString()); next.set('task', task.id); router.push(`/board?${next}`, { scroll: false }); }} />)}{!data.tasks?.some(task => task.status === status) && <p className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">No {status} tasks</p>}</section>)}
        <DependencyArrows container={container} dependencies={data.dependencies} revision={data.revision} />
      </div></div>
    </>}
    {params.get('task') && <TaskPanel key={`${boardId}:${params.get('task')}`} boardId={boardId} taskId={params.get('task')!} revision={data.revision} stopped={data.status?.stopped ?? true} agents={data.status?.agents} refreshBoard={refresh} onClose={() => { const next = new URLSearchParams(params.toString()); next.delete('task'); router.push(`/board?${next}`, { scroll: false }); }} />}
  </>;
}
