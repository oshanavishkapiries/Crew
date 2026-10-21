'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { createCoalescer } from '@/lib/board-logic';
import type { StatusResponse } from '@/lib/board-types';
import type { TaskDetail, TaskDiff } from '@/lib/task-types';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmAction } from '@/components/board/confirm-action';
import { DiffView } from './diff-view';
import { RunLogs } from './run-logs';
export function TaskPanel({ taskId, boardId, revision, stopped, agents, onClose, refreshBoard }: { taskId: string; boardId: string; revision: number; stopped: boolean; agents?: StatusResponse['agents']; onClose: () => void; refreshBoard: () => void }) {
  const [detail, setDetail] = useState<TaskDetail>();
  const [diff, setDiff] = useState<TaskDiff>();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('overview');
  const refresh = useRef<() => void>(() => {});
  const task = detail?.task;
  const valid = task?.boardId === boardId;
  useEffect(() => {
    const controller = new AbortController();
    const coalescer = createCoalescer(async () => {
      const result = await Promise.allSettled([
        api<TaskDetail>(`/api/tasks/${encodeURIComponent(taskId)}`, { signal: controller.signal }),
        api<TaskDiff>(`/api/tasks/${encodeURIComponent(taskId)}/diff`, { signal: controller.signal }),
      ]);
      if (controller.signal.aborted) return;
      const errors: Record<string, string> = {};
      const [detail, diff] = result;
      if (detail.status === 'fulfilled') { if (detail.value.task.boardId === boardId) setDetail(detail.value); else { setDetail(undefined); errors.Detail = 'This task belongs to a different board. Close the panel and choose a task on this board.'; } }
      else errors.Detail = detail.reason instanceof Error ? detail.reason.message : String(detail.reason);
      if (diff.status === 'fulfilled') setDiff(diff.value); else errors.Diff = diff.reason instanceof Error ? diff.reason.message : String(diff.reason);
      setErrors(errors);
    });
    refresh.current = coalescer.invalidate;
    coalescer.invalidate();
    return () => { controller.abort(); coalescer.dispose(); refresh.current = () => {}; };
  }, [taskId, boardId]);
  useEffect(() => { refresh.current(); }, [revision]);
  const update = () => { refresh.current(); refreshBoard(); };
  const action = async (action: 'retry' | 'cancel') => { if (action === 'retry' && stopped) throw new Error('Resume dispatch on the Board before retrying.'); await api(`/api/tasks/${encodeURIComponent(taskId)}/${action}`, { method: 'POST' }); update(); };
  return <Sheet open onOpenChange={open => { if (!open) onClose(); }}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
    <SheetHeader><SheetTitle>{valid ? task.title : 'Task detail'}</SheetTitle><SheetDescription className="break-all">{taskId}</SheetDescription></SheetHeader>
    <div className="space-y-4 px-4 pb-6">
      <Button variant="outline" onClick={() => refresh.current()}>Refresh task</Button>
      {errors.Detail && <Alert variant="destructive"><AlertDescription>{errors.Detail}</AlertDescription></Alert>}
      {!detail && !errors.Detail && <Skeleton className="h-40 w-full" aria-label="Loading task detail" />}
      {valid && detail && <><div className="flex flex-wrap items-center gap-2"><Badge>{task.status}</Badge><Badge variant="outline">{task.kind}</Badge><Badge variant="secondary">{task.retries} retries</Badge>
        {!['merged', 'cancelled'].includes(task.status) && <ConfirmAction label="Cancel task" destructive description="Stop this task and its active run. This cannot be undone." onConfirm={() => action('cancel')} />}
        {task.status === 'escalated' && <ConfirmAction label="Retry task" disabled={stopped} description="Retry this escalated task with the existing branch and worktree." onConfirm={() => action('retry')} />}
      </div>
      {stopped && task.status === 'escalated' && <p className="text-sm text-muted-foreground">Resume dispatch on the Board before retrying.</p>}
      <Tabs value={tab} onValueChange={setTab}><TabsList className="h-auto w-full flex-wrap justify-start">{['Overview', 'Log', 'Diff', 'Verification', 'Messages', 'Commits'].map(name => <TabsTrigger key={name} value={name.toLowerCase()}>{name}</TabsTrigger>)}</TabsList>
        <TabsContent value="overview" className="space-y-4">
          <Card><CardHeader><CardTitle>Description</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap break-words">{task.description || 'No description.'}</CardContent></Card>
          <Card><CardHeader><CardTitle>Acceptance criteria</CardTitle></CardHeader><CardContent className="whitespace-pre-wrap break-words">{task.acceptanceCriteria || 'No acceptance criteria.'}</CardContent></Card>
          <p>Assignee: {agents?.find(agent => agent.id === task.assigneeAgentId)?.name ?? task.assigneeAgentName ?? task.assigneeAgentId ?? 'Unassigned'}</p><p className="break-all">Branch: {task.branch ?? 'No branch yet'}</p>
          <p>Dependencies: {detail.dependencies.length ? detail.dependencies.map(edge => edge.blockedByTaskId).join(', ') : 'None'}</p>
          <h3 className="font-medium">Runs</h3>{detail.runs.length === 0 && <p>No runs yet.</p>}{detail.runs.map(run => <Card key={run.id}><CardContent className="space-y-1 p-3 text-sm"><p className="break-all">{run.id} · {run.kind} · {run.adapter}</p><p>{new Date(run.startedAt).toLocaleString()} — {run.endedAt ? new Date(run.endedAt).toLocaleString() : 'Running'}</p><p>Exit: {run.exitReason ?? 'In progress'}{run.exitCode !== null ? ` (code ${run.exitCode})` : ''}</p></CardContent></Card>)}
        </TabsContent>
        <TabsContent value="log">{tab === 'log' && <RunLogs taskId={taskId} runs={detail.runs} onEnded={update} />}</TabsContent>
        <TabsContent value="diff">{errors.Diff && <Alert variant="destructive"><AlertDescription>{errors.Diff} Use Refresh task to retry.</AlertDescription></Alert>}{diff ? <DiffView data={diff} /> : !errors.Diff && <Skeleton className="h-24 w-full" aria-label="Loading diff" />}</TabsContent>
        <TabsContent value="verification" className="space-y-3">{detail.verificationResults.length === 0 && <p>No verification steps yet.</p>}{detail.verificationResults.map(result => <Card key={result.id}><CardHeader><CardTitle><Badge variant={result.passed ? 'secondary' : 'destructive'}>{result.passed ? 'Pass' : 'Fail'}</Badge> {result.step}</CardTitle><p className="break-all text-xs text-muted-foreground">Run {result.runId}</p></CardHeader><CardContent><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{result.output || 'No output recorded.'}</pre></CardContent></Card>)}</TabsContent>
        <TabsContent value="messages" className="space-y-3">{detail.messages.length === 0 && <p>No messages yet.</p>}{detail.messages.map(message => <Card key={message.id}><CardHeader><CardTitle><Badge variant="outline">{message.type}</Badge></CardTitle><p className="text-xs text-muted-foreground">{new Date(message.createdAt).toLocaleString()} · {agents?.find(agent => agent.id === message.fromAgentId)?.name ?? message.fromAgentId ?? 'Human / system'}</p></CardHeader><CardContent className="whitespace-pre-wrap break-words">{message.body}</CardContent></Card>)}</TabsContent>
        <TabsContent value="commits" className="space-y-3">{detail.commits.length === 0 && <p>No commits available. Branch history is available while the worktree exists; merged tasks retain their integration commit.</p>}{detail.commits.map((commit, index) => <Card key={`${commit.sha}-${index}`}><CardContent className="space-y-2 p-3"><Badge variant="outline">{commit.source}</Badge><p>{commit.subject}</p><code className="break-all text-xs">{commit.sha}</code></CardContent></Card>)}</TabsContent>
      </Tabs></>}
    </div>
  </SheetContent></Sheet>;
}
