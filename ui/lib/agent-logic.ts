/** API status wins over a live-run badge when a session has been retired or paused. */
export function agentState(status: string, hasRun: boolean) {
  if (['stale', 'stopped', 'rate-limited', 'disconnected'].includes(status)) return status;
  return hasRun ? 'running' : status;
}
export function relativeHeartbeat(value: string | null | undefined, now = Date.now()) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Not reported';
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000));
  if (seconds < 1) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
