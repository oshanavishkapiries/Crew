import { api } from './api';

let pending: Promise<void> | undefined;
let controller: AbortController | undefined;

/** Share the one-time exchange across Strict Mode remounts. Never persist the key. */
export function establishSession(): Promise<void> {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  const key = fragment.get('key');
  if (fragment.has('key')) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  if (pending && !fragment.has('key')) return pending;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  pending = key
    ? api('/api/session', { signal, method: 'POST', body: JSON.stringify({ key }) })
    : api('/api/session', { signal });
  const current = pending;
  void current.finally(() => { if (pending === current) pending = undefined; }).catch(() => {});
  return current;
}
