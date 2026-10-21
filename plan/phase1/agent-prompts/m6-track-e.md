# Milestone 6, Track E: close the two Board gaps (ticket edits, per-run logs)

Branch: `feat/m6-gaps` off `feat/milestone-6-board` (run `git pull` first). Read `m6-common.md` (delivery and report format, general rules) and `plan/phase1/milestone-6.md` §9 and the "Known gaps" paragraph in its status. The user decided both gaps belong in Phase 1. You own server, CLI, UI and docs for this task; no other agent is working in parallel. Bullets 0–5 are merged and accepted; do not rework them unless a test proves a bug. Never run paid agents.

Standing rules still apply (m5-bullet-5.md "Lessons"): no dead ends (every failure shows the human a recovery), test the races, keep it simple, verify every report claim, `rm -r dist && npm test` before each commit, never sleep in tests, D2 (every endpoint the Board uses has a human CLI command), D81 (shadcn components only, theme tokens).

## Part 1: edit tickets at the tickets gate

Today `crew approve --edit` replaces only the phase output text; the Board's ticket cards can be edited in the UI but cannot be saved, so the UI blocks approving card edits. Make the edits real.

Server (`src/server/scheduler/tickets.ts`, `src/server/api/app.ts`):
- `Tickets.edit(taskId, fields)` and `PATCH /api/tasks/:id`, human credentials only (agent tokens get 403, an Orchestrator must not edit its own tickets after the fact). Editable: `title`, `description`, `acceptanceCriteria`, `role`, `assignee`, `blockedByIds` (replaces the dependency list). Same validation rules as `create` (field names, role staffed, assignee has the role, blockers are work tickets on the same board, not cancelled/escalated) plus: no dependency cycles, a ticket cannot block itself.
- Only editable while the work ticket is `todo` or `ready` and has no live run, and the board is in the `tickets` phase with a draft waiting at its gate, or in `dispatch` while the ticket is still `todo`/`ready` and not started. Everything else returns a 409 that says why and what to do (for example `crew cancel <task>` and create a new ticket).
- Editing a ticket must be atomic with the dependency rows and must keep the Scheduler the only writer of task status (recompute `todo`/`ready` through the Scheduler when blockers change; read how `createTask` and `assign` do it). Publish a board event (`task_assignment_changed` shape or a new `task_updated` event, document it in §9) so the Board refetches.
- Approving the tickets gate must still validate the final ticket set (existing `validateTickets`).
- Deleting a ticket from the draft is `crew cancel <task>` (already exists); the UI offers it as a Remove button with confirm and the real endpoint.

CLI: `crew ticket edit <task> [--title ...] [--description ...] [--criteria ...] [--role ...] [--assignee ...] [--blocked-by <ids>]`, human only, with the same errors. Regenerate `docs/commands.md`.

Tests (harness, real CLI/API, in a new file `test/harness/ticket-edit.test.ts`): each field, validation failures (unknown field, bad role, cycle, self-block, cancelled blocker), agent token 403, not editable once running/done/merged and after the board moved on, edit racing dispatch (a ticket starting while being edited: exactly one outcome, no half-edited state), edited tickets are what the worker prompt contains, the gate approves the edited set, concurrent edits do not corrupt the dependency list. Observe at least three of them fail before the implementation.

UI (`ui/components/gates`, `ui/lib/gates-*`): the ticket cards save through the real endpoint (field by field or Save per card, with the server's error shown on the card), add a ticket (`POST /api/tasks` as the human), remove a ticket (cancel), blockers as a multi-select of the other tickets. Remove the "card edits cannot be approved" blocking now that edits persist; keep the draft-id stale protection and the double-submit guard. Update the client checks.

## Part 2: logs of every run

`GET /api/tasks/:id/logs` returns only the latest run. Add `GET /api/tasks/:id/logs?run=<runId>` (run must belong to the task, else 404), and a bounded tail: `?tail=<bytes>` (default 256 KiB, max 2 MiB; return `truncated: true` and the offset when cut), reading the file without loading a huge log into memory. `GET /api/tasks/:id` already lists runs; make sure each has `id`, `startedAt`, `endedAt`, `exitReason`, `exitCode`, adapter and agent, and that a run whose log file is missing returns an explicit `missing: true` (no 500). CLI: `crew logs <task> [--run <id>] [--tail <kb>]`, and `crew logs <task>` without options keeps today's behavior. Regenerate `docs/commands.md`. Tests: latest default unchanged, a named older run, another task's run id rejected, truncation flag, missing file, path safety (a run row with a log path outside the crew home must not be read: check how `logPath` is written and only serve files under `<crewHome>/logs`).

UI (`ui/components/task`): a run selector in the Log tab (live run streams as today; finished runs load their own log with the tail limit and a "load more" or "download" note when truncated), run summary row with exit reason, and a clear label when the log file is missing. Update the client checks.

## Verify (real, not mocked)
- `rm -r dist && npm test` passes (paste summary), `npm run build:ui` passes, `npm --prefix ui run check` passes.
- Real browser against the real built UI and a real `crew start` on a throwaway repo with a separate `CREW_HOME`, using the fake adapter or seeded data: reach a tickets gate with 3 tickets, edit a title, change a blocker, add one, remove one, approve, and see the worker prompt/DB contain the edits; open a task with at least two runs and switch between their logs. Paste what you checked and what you could not.
- Docs per AGENTS.md: `project-structure.md`, `milestone-6.md` (§9 "Track E"; update the Known gaps paragraph), `handoff.md`, `START_HERE.md`, `docs/commands.md`, and propose any decision in §9 (do not edit the PRD Decision Log; the user logs them).

Delivery: commit per part (`feat(m6): ...`), report at `plan/phase1/reports/m6-gaps.md` in the m6-common.md format, `git push origin feat/m6-gaps`; never touch `main`, never force-push, never print or store credentials. In chat, only say the report is pushed and give the hash.
