import * as schema from '../../src/server/db/schema.js';
import type { PipelineHarness } from './index.js';

type Item = typeof schema.mergeQueueItems.$inferSelect;
export function waitForMerge(h: PipelineHarness, taskId: string, predicate: (item: Item) => boolean, timeoutMs = 15000): Promise<Item> {
  const current = h.db.db.select().from(schema.mergeQueueItems).all().find(i => i.taskId === taskId && predicate(i));
  if (current) return Promise.resolve(current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsub(); reject(new Error(`Merge item ${taskId} timed out`)); }, timeoutMs);
    const unsub = h.eventBus.subscribeBoardEvents(h.boardId, e => {
      if (e.type !== 'merge_item_changed') return;
      const item = e.data as Item;
      if (item.taskId === taskId && predicate(item)) { clearTimeout(timer); unsub(); resolve(item); }
    });
  });
}
export async function readyToMerge(h: PipelineHarness, id = 'checkout') {
  await h.createTask({ id, title: `Feature ${id}`, description: 'Merge me' });
  await h.runTaskWithAgent(id, [
    { type: 'edit_file', filePath: `${id}.txt`, content: `${id}\n` },
    { type: 'done', result: 'Ready' },
  ]);
  await h.waitForTaskStatus(id, 'merge-queue');
}
