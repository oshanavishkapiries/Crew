'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useBoardEvents, type ConnectionState } from '@/lib/sse';
import type { BoardSummary, BoardsResponse } from '@/lib/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

function BoardRow({ board, connection, children }: { board: BoardSummary; connection: ConnectionState | 'Not selected'; children?: React.ReactNode }) {
  return <TableRow>
    <TableCell><Button asChild variant="link" className="h-auto p-0 font-medium"><Link href={`/board?id=${encodeURIComponent(board.id)}`}>{board.workspace.name}</Link></Button><p className="text-xs text-muted-foreground">{board.workspace.repoPath}</p></TableCell>
    <TableCell className="font-mono text-xs">{board.id}</TableCell>
    <TableCell><Badge variant="secondary">{board.currentPhase}</Badge>{board.stopped && <Badge variant="outline" className="ml-2">Stopped</Badge>}</TableCell>
    <TableCell aria-live="polite"><Badge variant={connection === 'live' ? 'default' : 'outline'}>{connection}</Badge>{children}</TableCell>
  </TableRow>;
}

function LiveBoardRow({ board, refetch }: { board: BoardSummary; refetch: () => void }) {
  const connection = useBoardEvents(board.id, refetch);
  return <BoardRow board={board} connection={connection} />;
}

export function BoardsList() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [activeBoardId, setActiveBoardId] = useState<string | null>(null);
  const dirty = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const load = useCallback(function refresh() {
    if (request.current) { dirty.current = true; return; }
    const controller = new AbortController();
    request.current = controller;
    void api<BoardsResponse>('/api/boards', { signal: controller.signal }).then(data => {
      if (controller.signal.aborted) return;
      if (!Array.isArray(data.boards)) throw new Error('Crew returned an invalid board list.');
      setBoards(data.boards);
      setActiveBoardId(active => data.boards.some(board => board.id === active) ? active : data.boards[0]?.id ?? null);
      setError(null);
    }).catch(error => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Could not load boards');
    }).finally(() => {
      if (request.current !== controller) return;
      request.current = null;
      if (dirty.current && !controller.signal.aborted) { dirty.current = false; refresh(); }
    });
  }, []);
  useEffect(() => {
    load();
    // Discover boards added while this page is open, even with no streams yet.
    const timer = setInterval(load, 15000);
    return () => { clearInterval(timer); request.current?.abort(); request.current = null; dirty.current = false; };
  }, [load]);
  return <>
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">Boards</h1><p className="mt-1 text-sm text-muted-foreground">Workspaces, phases and live connections.</p></div>
      <Button variant="outline" onClick={() => { load(); toast('Refreshing boards'); }}><RefreshCw />Refresh</Button>
    </div>
    {error && <Alert variant="destructive"><AlertTitle>Cannot load boards</AlertTitle><AlertDescription><p>{error}</p><p>Check the Crew server, then use Refresh to retry.</p></AlertDescription></Alert>}
    <Card>
      <CardHeader><CardTitle>Your workspaces</CardTitle><CardDescription>Open a board for the live view. All phases refresh every 15 seconds.</CardDescription></CardHeader>
      <CardContent>
        {boards === null ? (error ? <p className="text-sm text-muted-foreground">Boards unavailable.</p> : <Skeleton aria-label="Loading boards" className="h-28 w-full" />) : boards.length === 0 ? <p className="text-sm text-muted-foreground">No boards yet. Run <code>crew init</code> in your project, then refresh.</p> :
          <Table><TableHeader><TableRow><TableHead>Workspace</TableHead><TableHead>Board</TableHead><TableHead>Phase</TableHead><TableHead>Connection</TableHead></TableRow></TableHeader>
            <TableBody>{boards.map(board => activeBoardId === board.id ? <LiveBoardRow key={board.id} board={board} refetch={load} /> : <BoardRow key={board.id} board={board} connection="Not selected"><Button size="sm" variant="ghost" className="ml-2" aria-label={`Connect to ${board.workspace.name}`} onClick={() => setActiveBoardId(board.id)}>Connect</Button></BoardRow>)}</TableBody>
          </Table>}
      </CardContent>
    </Card>
  </>;
}
