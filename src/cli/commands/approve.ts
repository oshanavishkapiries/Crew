import fs from 'node:fs';
import { getHumanAction, postHumanAction } from '../client.js';
export async function handleApprove(options: { board?: string; draft?: string; edit?: string; reject?: boolean; note?: string }) {
  if (!options.board) throw new Error('crew approve requires --board <id>. Use crew status to see boards and gates.');
  const endpoint = `/api/boards/${encodeURIComponent(options.board)}/phase`;
  const current = options.draft ? undefined : await getHumanAction<{ draft?: { id: string } }>(endpoint);
  const draftId = options.draft || current?.draft?.id;
  if (!draftId) throw new Error('No draft awaiting approval on this board.');
  const result = await postHumanAction(`${endpoint}/approve`, { draftId, edit: options.edit ? fs.readFileSync(options.edit, 'utf8') : undefined, reject: options.reject, note: options.note });
  console.log(JSON.stringify(result, null, 2));
}
