'use client';
import { useEffect, useId, useState, type RefObject } from 'react';
import { dependencyPath } from '@/lib/board-logic';
import type { Dependency } from '@/lib/board-types';
export function DependencyArrows({ container, dependencies, revision }: { container: RefObject<HTMLDivElement | null>; dependencies: Dependency[]; revision: number }) {
  const [paths, setPaths] = useState<{ key: string; path: string; title: string }[]>([]);
  const marker = useId().replaceAll(':', '');
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const origin = root.getBoundingClientRect();
        const cards = new Map(Array.from(root.querySelectorAll<HTMLElement>('[data-task-id]')).map(card => [card.dataset.taskId, card.getBoundingClientRect()]));
        const relative = (rect: DOMRect) => ({ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height });
        setPaths(dependencies.flatMap(edge => {
          const from = cards.get(edge.blockedByTaskId), to = cards.get(edge.taskId);
          return from && to ? [{ key: `${edge.blockedByTaskId}-${edge.taskId}`, path: dependencyPath(relative(from), relative(to)), title: `${edge.blockedByTaskId} blocks ${edge.taskId}` }] : [];
        }));
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    root.querySelectorAll('[data-task-id]').forEach(card => observer.observe(card));
    window.addEventListener('resize', measure);
    measure();
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); cancelAnimationFrame(frame); };
  }, [container, dependencies, revision]);
  return <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible text-muted-foreground" aria-label="Task dependencies">
    <defs><marker id={marker} markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor" /></marker></defs>
    {paths.map(path => <path key={path.key} d={path.path} fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" markerEnd={`url(#${marker})`}><title>{path.title}</title></path>)}
  </svg>;
}
