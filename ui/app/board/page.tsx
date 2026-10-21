'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { BoardView } from '@/components/board/board-view';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
function BoardPage() {
  const id = useSearchParams().get('id');
  return id ? <BoardView key={id} boardId={id} /> : <div className="space-y-4"><h1 className="text-2xl font-semibold">Choose a board</h1><p>Select a workspace from the board list.</p><Button asChild><Link href="/">View boards</Link></Button></div>;
}
export default function Page() { return <Suspense fallback={<Skeleton className="h-64 w-full" aria-label="Loading board" />}><BoardPage /></Suspense>; }
