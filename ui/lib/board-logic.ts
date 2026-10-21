/** One delayed fetch per burst, at most one follow-up while a fetch is pending. */
export function createCoalescer(work: () => Promise<void>, schedule: (cb: () => void) => () => void = cb => {
  const timer = setTimeout(cb, 100);
  return () => clearTimeout(timer);
}) {
  let cancel: (() => void) | undefined;
  let running = false;
  let dirty = false;
  let disposed = false;
  function invalidate() {
    if (disposed) return;
    dirty = true;
    if (running || cancel) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (disposed) return;
      dirty = false;
      running = true;
      void work().finally(() => {
        running = false;
        if (dirty) invalidate();
      });
    });
  }
  return { invalidate, dispose() { disposed = true; cancel?.(); cancel = undefined; } };
}
export interface CardRect { left: number; top: number; width: number; height: number }
export function dependencyPath(from: CardRect, to: CardRect): string {
  const x1 = from.left + from.width;
  const y1 = from.top + from.height / 2;
  const x2 = to.left;
  const y2 = to.top + to.height / 2;
  const bend = Math.max(32, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}
/** Stop/resume can create a run without changing the task timestamp. */
export function needsTaskSnapshot(version: string, cached: { version: string; runs: { id: string }[] } | undefined, liveRunIds: string[]): boolean {
  return !cached || cached.version !== version || liveRunIds.some(id => !cached.runs.some(run => run.id === id));
}
