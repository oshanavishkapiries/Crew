export const PHASES: Record<string, { instructions: string; next: string }> = {
  grill: { instructions: 'Ask the human one question at a time with crew ask. Capture requirements and constraints.', next: 'spec' },
  spec: { instructions: 'Draft goals, non-goals, architecture and acceptance criteria.', next: 'tickets' },
  tickets: { instructions: 'Read the approved spec in project memory and refresh the project summary in your output. Create small tickets now with crew ticket create, staffed roles, --blocked-by and acceptance criteria. Include every ticket ID in the summary. Existing tickets survive rejection: reuse their IDs from the rejected plan; use crew ask for the human to inspect crew tasks or cancel unwanted tickets. Submit a summary with crew phase done. Tickets stay todo until the human approves the tickets gate.', next: 'dispatch' },
  dispatch: { instructions: 'Crew dispatches work by role. No Orchestrator process runs in this phase.', next: 'integrate' },
  integrate: { instructions: 'Review role learnings with crew memory list. Explicitly promote useful role entries with crew memory promote <id> (allowed to the Orchestrator only during integrate). Rewrite the project summary and include a release summary in phase-output.md, then submit it with crew phase done --output phase-output.md. Human approval publishes this text as project memory with a visible phase source and completes the board; do not edit the project checkout.', next: 'done' },
};
export const PHASE_OUTPUT_FILE = 'phase-output.md';
