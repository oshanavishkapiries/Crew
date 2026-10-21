'use client';
import { useMemo, useState } from 'react';
import { splitDiff, type DiffFile } from '@/lib/task-logic';
import type { TaskDiff } from '@/lib/task-types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
function FileDiff({ file }: { file: DiffFile }) {
  const [open, setOpen] = useState(true);
  return <Card><CardHeader className="p-3"><Button variant="ghost" className="h-auto justify-start whitespace-normal break-all text-left" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '−' : '+'} {file.name}</Button></CardHeader>{open && <CardContent className="overflow-x-auto p-0"><pre className="text-xs">{file.lines.map((line, index) => <div key={index} className={`min-h-4 px-3 ${line.kind === 'addition' ? 'bg-accent text-accent-foreground' : line.kind === 'deletion' ? 'bg-destructive/10 text-destructive' : 'text-muted-foreground'}`}>{line.text}</div>)}</pre></CardContent>}</Card>;
}
export function DiffView({ data }: { data: TaskDiff }) {
  const diff = useMemo(() => splitDiff(data.diff), [data.diff]);
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">{data.branch}{data.baseBranch ? ` compared with ${data.baseBranch}` : ''}</p>{data.error && <p role="status">{data.error}</p>}{!data.diff && !data.error && <p>No changes in this task worktree.</p>}{diff.truncated && <p role="status">Large diff truncated at 250,000 characters or 3,000 lines. Use <code>crew diff</code> or inspect the branch for the full diff.</p>}{diff.files.map((file, index) => <FileDiff key={`${index}-${file.name}`} file={file} />)}<p className="text-xs text-muted-foreground">Additions use accent; deletions use destructive. The + and − prefixes also identify changes.</p></div>;
}
