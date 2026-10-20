export const PHASES: Record<string, { instructions: string; next: string }> = {
  grill: { instructions: 'Ask the human one question at a time with crew ask. Capture requirements and constraints.', next: 'spec' },
  spec: { instructions: 'Draft goals, non-goals, architecture and acceptance criteria.', next: 'tickets' },
  tickets: { instructions: 'Plan small tickets with blockers and acceptance criteria. Ticket release is handled at the tickets gate.', next: 'dispatch' },
  dispatch: { instructions: 'Crew dispatches work by role. No Orchestrator process runs in this phase.', next: 'integrate' },
  integrate: { instructions: 'Review role learnings, explicitly promote useful ones, update the project summary and write a release summary.', next: 'done' },
};
export const PHASE_OUTPUT_FILE = 'phase-output.md';
