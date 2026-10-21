export interface TicketDraft {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string;
  blockedByIds: string[];
}
export function validateTickets(
  tickets: TicketDraft[],
  options: { blockers?: TicketDraft[]; limit?: number } = {},
): string[] {
  const errors: string[] = [];
  const limit = options.limit ?? 20;
  if (tickets.length > limit)
    errors.push(`At most ${limit} tickets are allowed for this phase.`);
  const graph = [...(options.blockers ?? []), ...tickets];
  const byId = new Map(graph.map((ticket) => [ticket.id, ticket]));
  if (byId.size !== graph.length) errors.push("Duplicate ticket ID.");
  for (const ticket of graph) {
    if (!ticket.id.trim() || !ticket.title.trim())
      errors.push("Ticket ID and title are required.");
    for (const id of ticket.blockedByIds)
      if (!byId.has(id)) errors.push(`Unknown blocker: ${id}`);
  }
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) {
      errors.push("Ticket dependency cycle.");
      return;
    }
    if (visited.has(id)) return;
    active.add(id);
    for (const blocker of byId.get(id)?.blockedByIds ?? []) visit(blocker);
    active.delete(id);
    visited.add(id);
  }
  for (const ticket of graph) visit(ticket.id);
  return [...new Set(errors)];
}
export function hasEdits(original: unknown, edited: unknown) {
  return JSON.stringify(original) !== JSON.stringify(edited);
}
export function submissionGuard() {
  let busy = false;
  return {
    enter() {
      if (busy) return false;
      busy = true;
      return true;
    },
    leave() {
      busy = false;
    },
  };
}
