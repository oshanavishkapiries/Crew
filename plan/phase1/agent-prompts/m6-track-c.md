# Milestone 6, Track C: Board view and task detail (bullets 2 and 3)

Branch: `feat/m6-board` off `feat/milestone-6-board` (run `git pull` first). Read `m6-common.md` (delivery format, report format, general rules) and `plan/phase1/milestone-6.md` §4.3 and §9 (what Tracks A and B built: session cookie, API shapes, SSE event names). `ui/README.md` explains how to run the UI against a real `crew start`. Bullets 0 and 1 are merged and accepted; do not rework them unless a test proves a bug.

## Rules for this round (they replace the ownership rules in m6-common.md)
- Track D works in parallel on Inbox, phase gates, Team and Memory. You do not touch those routes or components.
- **You own:** `ui/app/board/**`, `ui/components/board/**`, `ui/components/task/**`, `ui/lib/board-*.ts`, `ui/lib/task-*.ts`, `ui/checks/board-*`, `ui/checks/task-*`.
- **Shared, do not edit existing lines:** `ui/lib/types.ts`, `ui/lib/api.ts`, `ui/lib/sse.ts`, `ui/components/app-shell.tsx`, `ui/components/ui/*`. Put your response types in `ui/lib/board-types.ts` / `ui/lib/task-types.ts`. If you need a new shadcn primitive, add it (new file only) and check first that it does not exist. The only edits you may make to existing files: `ui/components/boards-list.tsx` (link each board to `/board?id=<boardId>`) and one nav change in `app-shell.tsx` if the Board link needs it.
- Static export has no dynamic routes: the Board is `ui/app/board/page.tsx` reading `?id=` (use `useSearchParams` inside a Suspense boundary), the task detail is a Sheet or a panel opened with `?task=<id>`, not a new route. Check that `npm run build:ui` still exports and that reload of `/board?id=...` works on the real Hono server.
- Do not edit `src/**` or `test/**`. If the server lacks something you need, write it in your report and in §9 "Track C" of `milestone-6.md`, and use the best existing endpoint meanwhile.
- Docs: only your own section "Track C" in `milestone-6.md` §9 and your report. Do not edit the PRD, the techstack or structure docs, or the handoff.
- D81: every control is a shadcn component or a feature component composing them. No raw styled controls, no hard-coded colors; use the theme tokens. Anything new that is not a token goes in `globals.css` tokens, not inline.

## Build
**Bullet 2: Board view (stories 107, 113, 114, 115).**
- Board page for one board: phase header (current phase, gate waiting badge), columns for task statuses in the state machine order of the PRD (include escalated and blocked/queued states exactly as the server names them; read `src/server/scheduler` and the PRD state machine, do not guess), task cards (title, status, assignee avatar with initials and a status dot, retries, kind badge for phase tasks), dependency arrows (plain SVG overlay computed from the dependency data, recomputed on resize and on data change; no graph library, D87), merge-queue warning banner, rate-limited badge, budget bar (parallel agents, retries and runtime from `/api/status`), Stop-all and Resume buttons with a confirm dialog and clear states (stopped banner), connection indicator.
- Data: `GET /api/tasks`, `GET /api/status`, `GET /api/merge-queue`, board SSE through the existing hook. Use the events to patch or refetch (D85: after reconnect always refetch). Coalesce refetches. A burst of events must not issue one request per event.
- Empty, loading and error states for every panel. A board with 0 tasks, with a stopped dispatcher, with an escalated task and with a rate-limited agent must each look right and say what the human can do (for example the `crew retry <task>` command next to an escalated card, with a Retry button calling the real endpoint).

**Bullet 3: Task detail (story 108).**
- Opens from a card. Tabs: Overview (description, acceptance criteria, assignee, runs list with exit reasons), Log (live agent events through `/api/runs/:id/stream` for the live run, history through `/api/tasks/:id/logs`; structured events rendered by type, auto-scroll that pauses when the user scrolls up, a bounded buffer so a long run cannot freeze the page, clear separation of tool calls and text), Diff (`/api/tasks/:id/diff`, per-file collapsible, additions/deletions colored via tokens, large diffs truncated with a note), Verification (each step pass/fail with its output), Messages (questions, answers, feedback, results), Commits.
- Actions: Cancel (confirm), Retry for escalated tasks. Show errors from the server verbatim.
- Close the run stream when the panel closes or the run ends; never keep streams open for hidden panels.

## Verify (real, not mocked)
- `npm run build:ui` must pass (typecheck, lint, export). `npm test` must still pass without a UI build: run `rm -r dist && npm test` once before your final commit and paste the summary lines.
- Add small client checks in `ui/checks/` for the pure logic you add (event-to-state reducer, refetch coalescing, log buffer bound, arrow geometry). Observe at least two of them fail before the fix.
- In a real browser against a real built UI served by a real `crew start` on a throwaway repo and separate `CREW_HOME`: create a few tasks with `crew` commands or the API (use the fake adapter or seed through the harness scripts if no paid agent is wanted; never run paid agents), watch cards move live, open a task, view a live log (a fake-adapter run is enough), a diff, verification results, stop-all and resume, reload `/board?id=...`. Paste what you checked and what you could not.
- Report honestly what you did not run.

Stop after bullet 3. Do not build inbox, gates, team or memory.
