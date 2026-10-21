# Milestone 6, Track D: Inbox, phase gates, Team and Memory (bullets 4 and 5)

Branch: `feat/m6-gates` off `feat/milestone-6-board` (run `git pull` first). Read `m6-common.md` (delivery format, report format, general rules) and `plan/phase1/milestone-6.md` §4.3 and §9 (what Tracks A and B built: session cookie, API shapes, SSE event names). `ui/README.md` explains how to run the UI against a real `crew start`. Bullets 0 and 1 are merged and accepted; do not rework them unless a test proves a bug.

## Rules for this round (they replace the ownership rules in m6-common.md)
- Track C works in parallel on the Board view and task detail. You do not touch `ui/app/board`, `ui/components/board`, `ui/components/task`.
- **You own:** `ui/app/inbox/**`, `ui/app/phase/**`, `ui/app/team/**`, `ui/app/memory/**`, `ui/components/{inbox,gates,team,memory}/**`, `ui/lib/{inbox,gates,team,memory}-*.ts`, `ui/checks/{inbox,gates,team,memory}-*`.
- **Shared, do not edit existing lines:** `ui/lib/types.ts`, `ui/lib/api.ts`, `ui/lib/sse.ts`, `ui/components/app-shell.tsx`, `ui/components/boards-list.tsx`, `ui/components/ui/*`. Put your response types in your own `*-types.ts` files. If you need a new shadcn primitive, add it (new file only) and check first that it does not exist.
- Static export has no dynamic routes: use query parameters (`/phase?board=<id>`), never `[id]` routes. Check that reload of such URLs works on the real Hono server.
- Do not edit `src/**` or `test/**`. If the server lacks something you need, write it in your report and in §9 "Track D" of `milestone-6.md`, and use the best existing endpoint meanwhile.
- Docs: only your own section "Track D" in `milestone-6.md` §9 and your report. Do not edit the PRD, the techstack or structure docs, or the handoff.
- D81: every control is a shadcn component or a feature component composing them; no raw styled controls or hard-coded colors; theme tokens only.

## Build
**Bullet 4: Inbox and phase gates (stories 109, 110).**
- Inbox: lists open questions (tasks waiting on a `crew ask`; derive from `/api/tasks` and the task messages, check `src/server/api/app.ts` for what is available), shows the question with its task and the agent, an answer box that calls `POST /api/tasks/:id/answer`, optimistic state with rollback on error, and removes the item when the task moves on (SSE or refetch). Empty state. An unread count badge on the Inbox nav item is a nice-to-have only if it needs no edit of shared files (otherwise report it).
- Phase screen `/phase?board=<id>`: reads `GET /api/boards/:id/phase`. Shows the current phase, the draft output waiting at a gate, any problem text from the server, and the history of the rejection note. Gates: Approve, Approve with edits, Reject with a required note, calling `POST /api/boards/:id/phase/approve` exactly like `crew approve --board --draft [--edit] [--reject --note]`: read `src/cli/commands/` for the exact body and the draft id handling, and the stale/concurrent gate errors; show the server's message verbatim and refetch on 409-style errors. Editor: the spec is markdown (textarea with a read-only rendered preview is enough, no heavy editor dependency); tickets are a structured list (title, description, acceptance criteria, blockers) rendered as editable cards or a table, validated before submit against the 20-ticket limit and unknown/cyclic blockers (the server validates too, show its error). Disable buttons while a request is in flight so a double click cannot approve twice. Phases with no gate show a clear read-only state. A failed phase run shows `crew retry` guidance.
- Add a link or entry point to the phase screen from the Boards list only if you can do it without editing shared files; otherwise report and reach it by URL for now (Track C owns the Board header link).

**Bullet 5: Team and Memory (stories 104, 111, 112).**
- Team: agents list from `GET /api/agents` and `/api/status` (connected, running, stale, rate-limited, stopped as the server names them), role, tool, current task, persona editor in a Sheet or Dialog (name, system prompt, personality) calling `PATCH /api/agents/:id`, with the server's validation errors shown on the fields.
- Memory: three layer tabs (project, role, task), list with source and promotion info, create, edit, delete (confirm), and promote where the API allows it. Read the memory endpoints and CLI (`src/cli/commands/memory.ts`) so the UI follows the same rules as the CLI (scopes, human-only actions, promotion rules). Filter by role and task where the layer needs it.

## Verify (real, not mocked)
- `npm run build:ui` must pass. `rm -r dist && npm test` must pass once before your final commit; paste the summary lines.
- Add small client checks in `ui/checks/` for the pure logic (ticket draft validation, edit-vs-original detection, double-submit guard, memory scope rules). Observe at least two fail before the fix.
- In a real browser against the real built UI served by a real `crew start` on a throwaway repo and separate `CREW_HOME`, with the fake adapter or seeded database (never paid agents): answer a question, approve a gate, approve with an edit, reject with a note (check the note in the database or the next phase prompt), edit a persona, create/edit/delete memory in each layer, reload each page. Paste what you checked and what you could not.
- Report honestly what you did not run.

Stop after bullet 5. Do not touch the Board view or task detail.
