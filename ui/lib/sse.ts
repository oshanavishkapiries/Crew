'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from './api';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'offline';
// EventSource only delivers unnamed messages to onmessage. These names are
// published by src/server/{scheduler,workflow,merge,verify,runner}.
const boardEvents = [
  'task_status_changed', 'task_progress', 'phase_changed',
  'merge_item_changed', 'task_assignment_changed', 'verification_step',
  'rate_limited', 'rate_limit_cleared', 'control_changed',
];

export function useBoardEvents(boardId: string, onRefetch: (change?: { type: string; taskId?: string }) => void): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting');
  const refetch = useRef(onRefetch);
  useEffect(() => { refetch.current = onRefetch; }, [onRefetch]);
  useEffect(() => {
    let disposed = false;
    let source: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sessionProbe = new AbortController();
    let attempt = 0;
    let hasOpened = false;
    function connect() {
      if (disposed) return;
      source = new EventSource(`/api/board/${encodeURIComponent(boardId)}/events`);
      source.onopen = () => {
        if (disposed) return;
        setState('live');
        attempt = 0;
        // Refetch on the first connection too, closing the fetch/subscribe gap.
        refetch.current();
        hasOpened = true;
      };
      const changed = (event: Event) => {
        if (disposed) return;
        let taskId: string | undefined;
        try {
          const data: unknown = JSON.parse((event as MessageEvent).data);
          if (data && typeof data === 'object' && 'taskId' in data && typeof data.taskId === 'string') taskId = data.taskId;
        } catch { /* Refetch still recovers malformed or payload-free events. */ }
        refetch.current({ type: event.type, taskId });
      };
      for (const event of boardEvents) source.addEventListener(event, changed);
      source.onerror = () => {
        source?.close(); // Own retry timer; disable EventSource's native retries.
        if (disposed) return;
        setState(hasOpened ? 'reconnecting' : 'offline');
        // EventSource hides HTTP status; probe the session to handle expiry.
        void api('/api/session', { signal: sessionProbe.signal }).catch(() => {});
        const delay = Math.min(1000 * 2 ** attempt++, 30000);
        timer = setTimeout(connect, delay);
      };
    }
    connect();
    return () => { disposed = true; sessionProbe.abort(); source?.close(); clearTimeout(timer); };
  }, [boardId]);
  return state;
}
