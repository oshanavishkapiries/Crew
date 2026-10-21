'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { useBoardEvents } from './sse';
import { createCoalescer, needsTaskSnapshot } from './board-logic';
import type { BoardData, BoardTask, Dependency, QueueResponse, StatusResponse } from './board-types';
import type { BoardsResponse } from './types';

export function useBoardData(boardId: string) {
  const [data, setData] = useState<BoardData>({ dependencies: [], runStarts: {}, errors: {}, revision: 0 });
  const refresh = useRef<() => void>(() => {});
  const invalidate = useCallback(() => refresh.current(), []);
  const connection = useBoardEvents(boardId, invalidate);
  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const dependencyCache = new Map<string, { version: string; edges: Dependency[]; runs: { id: string; startedAt: string }[] }>();
    const coalescer = createCoalescer(async () => {
      const results = await Promise.allSettled([
        api<{ tasks: BoardTask[] }>('/api/tasks', options),
        api<StatusResponse>('/api/status', options),
        api<QueueResponse>('/api/merge-queue', options),
        api<BoardsResponse>('/api/boards', options),
      ]);
      if (controller.signal.aborted) return;
      const [tasks, status, queue, boards] = results;
      const errors: Record<string, string> = {};
      results.forEach((result, i) => { if (result.status === 'rejected') errors[['Tasks', 'Budget and phase', 'Merge queue', 'Board'][i]] = result.reason instanceof Error ? result.reason.message : String(result.reason); });
      const filtered = tasks.status === 'fulfilled' ? tasks.value.tasks.filter(task => task.boardId === boardId) : undefined;
      // Dependencies are exposed on task detail only. Limit concurrent reads and
      // reuse unchanged task snapshots rather than fan out on every SSE event.
      if (filtered) {
        const pending = [...filtered];
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, async () => {
          for (let task = pending.shift(); task; task = pending.shift()) {
            if (controller.signal.aborted) return;
            const liveIds = status.status === 'fulfilled' ? status.value.liveRuns.filter(run => run.taskId === task.id).map(run => run.id) : [];
            if (!needsTaskSnapshot(task.updatedAt, dependencyCache.get(task.id), liveIds)) continue;
            try {
              const detail = await api<{ dependencies: Dependency[]; runs: { id: string; startedAt: string }[] }>(`/api/tasks/${encodeURIComponent(task.id)}`, options);
              dependencyCache.set(task.id, { version: task.updatedAt, edges: detail.dependencies, runs: detail.runs });
            } catch (error) { if (!controller.signal.aborted) errors.Dependencies = error instanceof Error ? error.message : String(error); }
          }
        }));
      }
      if (controller.signal.aborted) return;
      setData(previous => ({
        tasks: filtered ?? previous.tasks,
        status: status.status === 'fulfilled' ? status.value : previous.status,
        queue: queue.status === 'fulfilled' ? queue.value : previous.queue,
        board: boards.status === 'fulfilled' ? boards.value.boards.find(board => board.id === boardId) : previous.board,
        dependencies: filtered ? filtered.flatMap(task => dependencyCache.get(task.id)?.edges ?? []) : previous.dependencies,
        runStarts: Object.fromEntries([...dependencyCache.values()].flatMap(value => value.runs.map(run => [run.id, run.startedAt]))),
        errors: boards.status === 'fulfilled' && !boards.value.boards.some(board => board.id === boardId) ? { ...errors, Board: 'Board not found. Return to Boards and choose an existing workspace.' } : errors,
        revision: previous.revision + 1,
      }));
    });
    refresh.current = coalescer.invalidate;
    coalescer.invalidate();
    // The shared hook does not subscribe to control_changed or run_ended.
    // Refresh snapshots periodically for cross-tab Stop/Resume and run endings.
    const poll = setInterval(coalescer.invalidate, 5000);
    return () => { clearInterval(poll); coalescer.dispose(); controller.abort(); refresh.current = () => {}; };
  }, [boardId]);
  return { data, refresh: invalidate, connection };
}
