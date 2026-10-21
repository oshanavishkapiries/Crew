"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Coalesce invalidations; do not starve reads by aborting on every event. */
export function useResource<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const trigger = useRef<() => void>(() => {});
  const refresh = useCallback(() => trigger.current(), []);
  useEffect(() => {
    const controller = new AbortController();
    let running = false,
      again = false;
    async function run() {
      if (controller.signal.aborted) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        const value = await load(controller.signal);
        if (!controller.signal.aborted) {
          setData(value);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        running = false;
        if (!controller.signal.aborted) {
          setLoading(false);
          if (again) {
            again = false;
            void run();
          }
        }
      }
    }
    trigger.current = () => {
      void run();
    };
    void run();
    const timer = setInterval(() => {
      void run();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
      trigger.current = () => {};
    };
  }, [load]);
  return { data, error, loading, refresh };
}
