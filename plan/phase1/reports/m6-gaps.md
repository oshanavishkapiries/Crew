# Summary

Track E implements both assigned gaps: persisted pending-ticket edits and per-run log history, with human CLI parity and Board controls. Ticket fields, replacement dependencies and Scheduler readiness commit together; gate approval still validates the persisted graph and pins the displayed draft. Logs select any task-owned run, read bounded file tails, report missing files and reject paths outside Crew's logs directory. No paid agents were run.

# Branch and commits

- Branch: `feat/m6-gaps`, created after fetching, checking out and pulling `feat/milestone-6-board`.
- Base: `843113c6fc1e8b0f0e0cc35ad1a35e661ae5d138`.
- Part 1: `b07364185219c6af5b90fa7bc4e3075242620e92` — `feat(m6): persist ticket edits at the tickets gate`.
- Part 2 and this report: `feat(m6): add bounded per-run log history` (the commit containing this report).
- Both part commits include the Co-Authored-By trailer. No main checkout, main commit or force push.

# Done criteria (milestone-6.md §1)

- [x] Built static Board served by a real `crew start`, without a Next server. Browser smoke copies the built CLI/export into an isolated installation, initializes a throwaway git repository with a separate CREW_HOME and follows the real login flow.
- [x] Assigned UI flows use real data: start with three ticket cards; edit a title; replace a blocker; add a fourth ticket; cancel removal confirmation, then remove it; remove a referenced blocker and repair its dependent; approve once despite a synchronous double click. SQLite assertions verify fields, dependency rows, cancellation, phase advancement and readiness.
- [x] Real harness workers receive edited title, description and criteria. Another harness scenario creates a real tickets draft through Dispatcher/Runner/CLI, saves edits, approves the final set and verifies the subsequent worker prompt.
- [x] Log tab switches two recorded runs, displays the selected run's exit summary, labels a missing file and expands a truncated 256 KiB tail to the 2 MiB cap. Browser asserts no mixed history after switching. A separate harness test reads actual Runner logs before and after ask/answer resume.
- [x] New controls compose existing shadcn components and theme tokens: ticket cards, Switch/Label blocker multi-select, confirmation Dialog, Select run picker and bounded-history controls. No dependencies or primitives added.
- [x] Browser login clears the fragment and yields an HttpOnly cookie. Board mutations use the existing cookie client and X-Crew-Board header; the cache regression probe also uses the real cookie-authenticated PATCH route.
- [x] Root suite runs after removing dist and independently of a UI build. UI typecheck, lint, client checks and static export are separate.
- [ ] The user's complete manual checklist in §6 remains outstanding. This report does not mark milestone 6 or preview packaging complete.

# Test results

Setup completed: root `npm install`, `npm ci --prefix ui`. Installs reported inherited audit findings (4 moderate in root, 9 high in UI); manifests and lockfiles were unchanged.

Part 1, before its commit: `rm -r dist && npm test`, exit 0:

```text
 Test Files  51 passed (51)
      Tests  330 passed (330)
   Start at  20:04:39
   Duration  482.91s (tests 95%, import 4%)
```

Part 2, before its commit: `rm -r dist && npm test`, exit 0:

```text
 Test Files  52 passed (52)
      Tests  337 passed (337)
   Start at  20:17:11
   Duration  461.63s (tests 95%, import 4%)
```

Focused harness checks:

- `ticket-edit.test.ts`: 6 passing cases; also ran it with the existing `tickets.test.ts` to check CLI create/assign compatibility.
- `run-logs.test.ts`: 7 passing cases (5.52s), including actual Runner ask/answer histories.
- Before implementing ticket edits, all five initial ticket-edit cases failed. Before implementing log history, all five initial log cases failed. Additional gate, symlink-root and real-Runner cases were added afterwards; no red-first claim for those.

Final `npm --prefix ui run check`, exit 0:

```text
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`npm run build:ui`, exit 0 (strict TypeScript, ESLint, Next static export and copy):

```text
> crew@0.1.0 build:ui
> node scripts/build-ui.mjs
> @crew/board@0.1.0 typecheck
> tsc --noEmit
> @crew/board@0.1.0 lint
> eslint .
> @crew/board@0.1.0 build
> next build
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 561ms
  Finished TypeScript in 1340ms ...
✓ Generating static pages using 9 workers (8/8) in 525ms
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /board
├ ○ /inbox
├ ○ /memory
├ ○ /phase
└ ○ /team
Board static export copied to dist/ui
```

Also ran UI typecheck, lint and direct static builds during implementation. `git diff --check` passes. Commands reference regenerated through `npm run generate:docs`.

# Failure paths and races tested

Ticket harness:

- Every editable field through the real human CLI: title, description, acceptanceCriteria, role, assignee and replacement blockers; clearing blockers recomputes todo → ready.
- Unknown field, blank title, unknown role/assignee/blocker, self-block, cycle and cancelled blocker rejected. Failed edits roll back the proposed title and graph. Corrected edits succeed.
- Agent-token PATCH returns 403; doing, verifying, merged and moved-on-board edits return 409 with recovery guidance. A tickets-phase edit before a waiting draft is rejected, then succeeds once the real draft exists.
- Two concurrent replacements leave one coherent final field/dependency/status set and deduplicate repeated blocker IDs.
- A real worktree-setup command waits on an HTTP barrier. Editing the task to depend on unfinished work while setup is pending leaves it todo with no run; dispatch cannot start a half-edited ticket. No sleep is used for the race.
- Exact-draft gate approval releases only the final dependency-ready set; edited fields reach the real worker prompt.

Log harness:

- Default latest output and named older run through real API and CLI; CLI stdout preservation checked with the harness's final-newline stripping disabled.
- CLI --list discovers only this task's run IDs; another task's or unknown run ID returns 404.
- Invalid/empty/out-of-range tail sizes return 400; invalid CLI KiB limits fail with guidance.
- A 3 MiB log returns the exact bounded default and maximum tails with byte offsets and truncation flags; CLI reports truncation separately on stderr.
- Missing and null log paths return missing=true; a task without runs returns an empty nonmissing response.
- Outside path, traversal, file symlink escape, a directory in place of a log and a symlinked logs root are rejected without serving the outside sentinel.
- Real Runner ask/answer produces two histories; latest and older selections return distinct output.

Browser verification (one-off Playwright probe, not a committed browser suite):

```text
PASS real crew start serves built export; cookie login, no Next server
PASS browser saves a ticket title via real PATCH; unsaved changes block approval
PASS browser replaces blocker selection in real dependency rows
PASS browser adds a ticket, cancels confirmation, then removes it through real cancel
PASS removed blocker remains selectable for dependent repair before approval
PASS browser approves edited persisted set once; DB retains title and blocker, dependency readiness correct
PASS Board refetches changed dependency after an edit within the same timestamp second
PASS browser switches between two real run logs, with exit summary and no mixed output
PASS browser labels a missing historical log explicitly
PASS browser reports truncation, loads a larger bounded tail, and explains complete local log access
PASS zero paid agents, only two seeded runs, no browser page errors; fixture dispatch stopped throughout
```

Dispatch stayed stopped throughout the browser probe, and fixture agent adapter names were changed to fake as a second guard. Its only two run rows were seeded historical data. Worker-prompt verification was performed by the real fake-adapter harness, not claimed as a browser-dispatched worker.

Observed failures and corrections:

- The first dispatch-race probe used environment variables in the setup child, but the existing setup runner deliberately filters them. Replaced that fixture with an HTTP barrier, keeping credentials in memory and avoiding sleeps.
- A browser repair probe used Playwright uncheck on a switch that disappears once cleared; changed the probe to click. Another probe clicked disabled Approve before the refreshed validation arrived; it now waits for the enabled control before exercising the double click.
- A real browser regression exposed stale Board arrows after two ticket edits in the same SQLite timestamp second. Observed the missing-arrow timeout before fixing selective SSE cache invalidation, then reran the whole browser probe successfully.
- One repeat UI-check command was started while build:ui was reinstalling ui/node_modules; all seven test files failed to import TypeScript. It was rerun sequentially after installation/build, with 20 checks passing. No code change was needed.
- The first log CLI assertion expected a trailing newline, while the harness's execa helper strips it. The check now explicitly preserves stdout newlines; no product change was needed.

# Deviations / proposals

Recorded in milestone-6.md §9, Track E; PRD Decision Log unchanged:

- Reuse task_assignment_changed for successful ticket edits, including text/dependency-only changes, with the existing task/assignee/role payload. Existing consumers refetch; the Board additionally uses the edit event to invalidate that task's detail cache even if updatedAt is unchanged.
- Pending-ticket edits use the existing SQLite transaction and last committed write wins; no version column, migration or custom lock service. A worktree set up during an edit can retain its old title-derived branch name, while its worker receives the persisted edited prompt.
- Add `crew logs <task> --list` so CLI users can discover the run IDs used by --run and recover from a bad selection. It uses the existing task-detail endpoint.
- Tail is bytes on the API and integer KiB on the CLI. Default 256 KiB, cap 2 MiB. Larger complete logs remain local files; no unbounded download endpoint or pagination was added.
- The only rework of accepted Board code fixes the browser-proven dependency-cache bug. Unrelated events and polling retain caching; reconnect/manual refresh invalidates all cached detail.

# Docs updated

- docs/commands.md regenerated from declarations for ticket edit and logs --run/--tail/--list.
- docs/architecture/project-structure.md documents new harness/reader/components and SSE cache hints.
- milestone-6.md updates Known gaps and adds §9 Track E contracts, proposals and evidence.
- START_HERE.md and handoff.md record both closed gaps and the remaining manual checklist/packaging work.
- ui/README.md explains persisted cards, cancelled-blocker repair and per-run history.
- This report. Reviewed README.md and project-techstack.md: existing quick start remains correct; no folders, dependency versions, tools or platforms changed, so those files need no edit. No PRD Decision Log changes.

# Known issues and unverified things

- The user's full manual browser checklist and preview packaging are not done. No paid-agent smoke, mixed-tool workflow, macOS/WSL or other browser was run in this task.
- Browser verification uses Chromium and seeded gate/history data with dispatch stopped. Live streaming logic remains in the existing viewer and passes client checks, but an active worker stream was not exercised in the new browser probe.
- A byte tail can begin inside a JSONL record or UTF-8 character; the viewer safely treats partial JSON as text and may show a replacement character at that boundary. Its existing parsing and DOM bounds may omit more output than the server tail.
- Log path checks are not an OS sandbox against a local actor concurrently swapping parent directories after validation. File deletion is handled, but an adversarial filesystem race or injected permission failure was not tested.
- A complete-log browser download is not provided: the viewer expands to the requested 2 MiB cap and then explains where to open the full local .jsonl file.
- Dependency edges still require task-detail reads, and Board discovery of run endings still uses the existing poll. No unrelated screen, workflow or adapter redesign.
