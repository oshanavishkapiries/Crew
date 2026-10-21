'use client';
import { useId, useState } from 'react';
import type { TaskRun } from '@/lib/task-types';
import { selectLogRun } from '@/lib/task-logic';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LogViewer } from './log-viewer';
export function RunLogs({ taskId, runs, onEnded }: { taskId: string; runs: TaskRun[]; onEnded: () => void }) {
  const [selected, setSelected] = useState('latest');
  const id = useId();
  const run = selectLogRun(runs, selected);
  if (!runs.length) return <p>No runs yet. Refresh task after a run starts.</p>;
  return <div className="space-y-3">
    <Label htmlFor={id}>Run</Label><Select value={selected} onValueChange={setSelected}><SelectTrigger id={id} className="w-full"><SelectValue /></SelectTrigger><SelectContent>
      <SelectItem value="latest">Latest run</SelectItem>
      {runs.toReversed().map(run => <SelectItem key={run.id} value={run.id}>{new Date(run.startedAt).toLocaleString()} · {run.id} · {run.exitReason ?? 'Running'}</SelectItem>)}
    </SelectContent></Select>
    {run ? <><div className="space-y-1 rounded-lg border p-3 text-sm" aria-label="Run summary">
      <p className="break-all">{run.id} · {run.kind} · {run.adapter} · {run.agent?.name ?? run.agentId}</p>
      <p>{new Date(run.startedAt).toLocaleString()} — {run.endedAt ? new Date(run.endedAt).toLocaleString() : 'Running'}</p>
      <p>Exit: {run.exitReason ?? 'In progress'}{run.exitCode !== null ? ` (code ${run.exitCode})` : ''}</p>
    </div><LogViewer key={run.id} taskId={taskId} run={run} onEnded={onEnded} /></> : <Alert><AlertDescription>This run is no longer listed. Select Latest run or Refresh task.</AlertDescription></Alert>}
  </div>;
}
