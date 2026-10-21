# Milestone 6: Board UI

The implementation plan for milestone 6 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** bullets 0–5 implemented and merged on `feat/milestone-6-board` (2026-10-21): server prerequisites, UI scaffold, Board view, task detail, Inbox, phase gates, Team and Memory. The merged branch passes `rm -r dist && npm test` (324 tests), `npm run build:ui` and the UI checks (18). Bullet 6 is partly done (README quick start, UI README, gate link); the user's manual browser checklist (§6), the remaining gaps below and preview packaging (npm tag, tarball or git URL) remain. D80–D87 are decided and logged.

Closed after the merge: `/api/status` phases now carry the effective `limits` (parallel agents, retries, runtime) and the Board shows them; the SSE hook listens to `control_changed`. Track E closes the Phase 1 ticket-edit and per-run-log gaps: cards persist real edits at the tickets gate (or through the CLI before a dispatch ticket starts), and the Log tab selects every recorded run with bounded history. Remaining gaps: task dependencies are only on task detail (the Board reads them per task); the Board still polls every 5 s because run-end events are per run, not per board.

## 1. Goal

A developer opens one URL, printed by `crew start`, and sees the whole project: a Board with the task state machine, live agent logs, diffs and verification results, a questions inbox, the grill → spec → tickets gates with edit/approve/reject, the team (agents and personas), the three memory layers and a Stop-all button. It updates live over SSE. Nothing else runs besides the crew server (story 116).

### Done when

- `crew start` serves the Board at `/`; `npx crew` needs no Node dev tools or second process (D80).
- Stories 107–116 work in a real browser against a real server. Every screen below shows real data, not fixtures.
- Every UI element is a shadcn/ui component or a feature component built from them (D81). A reviewer can restyle the Board by editing theme tokens and `ui/components/ui/*` only.
- The browser reaches human endpoints and SSE with an HttpOnly session cookie, not by exposing the secret to page scripts (D82).
- `npm test` still passes on a clean checkout without building the UI; a separate `npm run build:ui` produces `dist/ui`.
- A manual browser smoke checklist (§6) was walked through by the user.

## 2. Scope

In: the stories 107–116 of the PRD; server prerequisites the UI needs (§4.1); packaging of the static build.
Out: Codex or Pull-mode screens, multi-user auth, light/dark polish beyond tokens, mobile layout, browser end-to-end tests (PRD, Board UI testing section), Phase 2 budgets.

## 3. What milestones 1 to 5 give us

REST endpoints for tasks, diff, logs, status, merge queue, memory CRUD, phase snapshot/approve, answer, cancel, retry, stop-all/resume (`src/server/api/app.ts`); board SSE (`/api/board/:id/events`: task status events from the Scheduler, `phase_changed`, `merge_item_changed`, `task_assignment_changed`, verification events, and rate-limit events published on board `*`); run SSE (`/api/runs/:id/stream`). Security: 127.0.0.1 bind, Host check, `X-Crew-Secret` for human endpoints (D13, D25).

Gaps found while planning (to close in bullet 0): no static file serving; no way for a browser to authenticate (`EventSource` cannot set headers, PRD open question); no list of boards/workspaces; no agent detail or persona update endpoint; board `*` events are not reachable through a per-board stream; task detail messages/commits/results must be checked for completeness.

## 4. Design

### 4.1 Server prerequisites (bullet 0)

- **Static serving.** Hono serves `dist/ui` at `/` with an `index.html` fallback for client routes. If the folder is missing (dev checkout, tests) `/` returns a short page saying to run `npm run build:ui`.
- **Session cookie (D82).** `crew start` prints `http://127.0.0.1:<port>/#key=<one-time login key>` (also `crew open`, which reads `server.json`). The page posts the key to `POST /api/session`; the server replies with `Set-Cookie: crew_session=…; HttpOnly; SameSite=Strict; Path=/` and the page clears the fragment. Human endpoints and SSE accept either `X-Crew-Secret` or the cookie. Mutating requests authenticated by cookie must also send `X-Crew-Board: 1` (a custom header cross-site forms cannot set). The login key is single use and expires when used or at server restart; the cookie is invalid after a restart. Never a query parameter.
- **Read endpoints:** `GET /api/boards` (id, workspace, phase, stopped), `GET /api/agents` (+ `/:id`), `PATCH /api/agents/:id` (persona/systemPrompt/personality only, human only), `GET /api/roles`. Check `/api/tasks/:id` returns messages, runs, verification results, commits and dependencies; add what is missing. Board stream also forwards `*` events (rate limits, stop-all state).
- All new endpoints are tested through the harness like the others; each is also reachable from a human CLI command or documented as Board-only (D2): `crew open` is the only new command.

### 4.2 UI project (bullet 1)

`ui/` is its own package (own `package.json`, `tsconfig`, Next.js App Router, `output: 'export'`, Tailwind, shadcn/ui, lucide icons). Dependencies are pinned like the root ones. Layout:

- `ui/app/` routes (client components fetching through `ui/lib/api.ts`); `ui/components/ui/` shadcn primitives; `ui/components/` feature components (`task-card`, `board-column`, `log-viewer`, `diff-view`, `gate-editor`, …); `ui/lib/` api client, SSE hook (`fetch`-based reader or `EventSource` with the cookie), formatting; `ui/styles/theme` tokens (D81).
- `next dev` runs on its own port with `rewrites` sending `/api/*` to the crew server (D80). Production never uses it.
- Root scripts: `build:ui` (`ui` build, copy `ui/out` → `dist/ui`), included in the publish flow (`prepack`), not in `npm test`.
- Shared TypeScript types for API responses live in `ui/lib/types.ts`, copied from the real responses and checked by the harness tests asserting the same shapes (a single JSON-shape assertion per endpoint).

### 4.3 Screens (bullets 2–5)

1. **Board** (story 107, 113–115): columns for task statuses (ready/doing/verifying/review/merge-queue/merged, escalated, blocked), phase header showing the current phase of the board, dependency arrows between cards (SVG overlay computed from `taskDependencies`), agent avatars (initials + status dot), budget bar (parallel agents, retries, runtime from `/api/status`), merge queue warning banner, rate-limited badge, Stop-all / Resume buttons, connection indicator.
2. **Task detail** (108): drawer/page with live agent log (run SSE, structured events as a log, auto-scroll with pause), diff (`/api/tasks/:id/diff`), commits, verification results (pass/fail, output), messages, Cancel / Retry. History logs for finished runs from `/api/tasks/:id/logs`.
3. **Inbox + gates** (109, 110): questions inbox with answer box; phase screen showing the spec or tickets draft, an editor (markdown for spec; a table/JSON editor for tickets, validated by the server), Approve / Approve with edits / Reject with note (D61).
4. **Team and memory** (104, 111, 112): agents list with status, persona editor (shadcn form); memory view with three layer tabs, add/edit/delete/promote.

### 4.4 Live updates

One board stream per open board plus run streams per open log. Reconnect with backoff; after reconnect refetch state (no event replay is promised). Events carry ids only where the UI needs them; otherwise the UI refetches the affected resource.

## 5. Tracer bullets, in order

0. **Server prerequisites** (§4.1): static serve, session cookie + `crew open`, `GET /api/boards|agents|roles`, `PATCH /api/agents/:id`, board `*` events, task-detail gaps. Harness tests incl. cookie auth matrix (no auth 401, cookie GET ok, cookie POST without `X-Crew-Board` rejected, wrong Host rejected, key reuse rejected).
1. **UI scaffold:** Next + Tailwind + shadcn init, theme tokens, app shell, api client, SSE hook, login page handling `#key`, `build:ui`, served by `crew start`. Page shows board list and live connection state.
2. **Board view** with live task movement, agents and budget bar, Stop-all.
3. **Task detail:** live log, diff, results, messages, cancel/retry.
4. **Inbox and phase gates.**
5. **Team and memory.**
6. **Packaging and polish:** `prepack`, `files`, README quick start for the preview, manual browser checklist, docs.

Bullets 2 to 5 are independent after bullet 1 and can run on two agents in parallel (file ownership: bullet 2/3 own `ui/app/board`, `ui/components/{board,task}*`; bullet 4/5 own `ui/app/{inbox,phase,team,memory}`; shared files `ui/lib/*`, `ui/components/ui/*` change only in bullet 1 unless a new shadcn primitive is added, which is an additive file).

## 6. Testing notes

- Server work is tested through the harness (PRD: no browser end-to-end suite). Add one test that `GET /` serves the built UI when `dist/ui` exists and the fallback page when it does not.
- UI code is covered by `tsc`, `next build` (static export must succeed) and ESLint, run by `npm run build:ui`; they are not part of `npm test` (speed), but the agent's report must include their output.
- **Manual browser checklist** (user): login via printed URL; cookie works after refresh; restart server → cookie rejected, login page returns; run a small workflow (use `npm run smoke:m5` artifacts or a fake-adapter project) and watch cards move; open a live log; answer a question; approve and reject a gate with a note; edit a persona; edit memory; Stop-all and Resume.

## 7. Decisions from this plan

Decided by the user: **D80** (Next.js static export served by Hono; proxy only in dev), **D81** (shadcn/ui everywhere, theme tokens).

Proposed by Claude, approved by the user on 2026-10-21 and logged as D82–D87:

- **D82** Browser auth is a single-use login key in the URL fragment exchanged for an HttpOnly, SameSite=Strict session cookie; cookie requests that mutate must send `X-Crew-Board`. Resolves the PRD open question on SSE auth.
- **D83** `ui/` is a separate package with pinned dependencies; `build:ui` is not part of `npm test`; `dist/ui` ships in the npm package.
- **D84** The Board uses `GET /api/boards|agents|roles` and `PATCH /api/agents/:id` (persona fields only) as new human endpoints; only `crew open` is a new CLI command.
- **D85** No event replay: after an SSE reconnect the UI refetches.
- **D86** No browser end-to-end tests in Phase 1; instead the manual checklist in §6.
- **D87** Dependency arrows and columns are rendered with plain SVG/CSS (no graph library) to keep the bundle small.

## 8. Open questions

- Which theme/look does the user want first (tokens are easy to change later)? Default: shadcn "neutral" dark+light.
- Should `crew start` open the browser automatically? Default: no, print the URL; `crew open` opens it.


## 9. Implementation notes

### Track A

Bullet 0 provides the static host, browser sessions, `crew open`, Board reads/persona updates, task-detail additions and global SSE forwarding. No UI files, dependencies or migrations were changed. Root `build:ui`/`prepack` hooks belong to Track B; the server build already works without an export and needs no hook.

#### Browser and CLI contract

- `crew start` prints `http://127.0.0.1:<port>/#key=<key>`. Keys and sessions are random, verified against in-memory hashes, and invalid after restart; a key is consumed atomically once. Unused keys remain valid until restart, including earlier URLs printed by `crew open`.
- `POST /api/session` accepts `{ key }`, returns 204 and `crew_session` with `HttpOnly; SameSite=Strict; Path=/`. Wrong, reused or old-server keys return 401 with a `crew open` recovery hint. `GET /api/session` checks the cookie (204/401); `DELETE` revokes it and clears it (204). Mutations authenticated by cookie, including logout, need `X-Crew-Board: 1` (403 otherwise). Header-secret CLI requests keep their existing behavior.
- Added **CLI-only** `POST /api/session/key`: requires `X-Crew-Secret`, returns `{ key }` with `Cache-Control: no-store`. This is how `crew open` mints a fresh URL after reading `server.json`; cookies cannot mint keys. Any agent-token header gets 403 on session endpoints and persona edits, including requests that also supply human credentials.
- `crew open` prints the URL, then calls `open` on macOS or `xdg-open` on Linux/WSL; `BROWSER` can name another executable (no shell expressions or arguments). On browser failure it exits successfully with paste-the-URL guidance. Missing/stale server discovery says to run `crew start`; connection failure says to start and retry. Keys and cookies are never written to `server.json`, logs or the report; printing a login URL is limited to the requested CLI output.
- The Board host uses package-relative `dist/ui`, independent of the managed repository's cwd. Missing export: build-and-reload page. HTML and ordinary assets revalidate; only non-HTML `_next/static` assets whose filenames contain a hexadecimal content hash (at least eight digits) get immutable caching. Exported routes resolve `<route>.html` or `<route>/index.html` before the root `index.html` fallback; missing assets and unknown `/api/*` routes return 404. Traversal and export symlinks outside the export return 403. An export without an index returns 503 with rebuild guidance.

#### Response shapes (additive)

All new read endpoints require human authentication (secret or cookie); missing credentials return 401 and agent-token callers return 403. Persona editing uses the same boundary and cookie CSRF guard. These endpoints are Board-only, as allowed by §4.1 / proposed D84; no extra list/persona CLI commands were added.

| Endpoint | JSON response |
| --- | --- |
| `GET /api/boards` | `{ boards: [{ id, workspaceId, currentPhase, createdAt, stopped, workspace: { id, name, repoPath, defaultBranch } }] }` |
| `GET /api/agents` | `{ agents: [agent] }`; all persisted agent fields **except tokenHash** |
| `GET /api/agents/:id` | `{ agent }`, same redaction; 404 if absent |
| `GET /api/roles` | `{ roles: [role] }`; id, name, defaultPrompt, permissionProfile, isBuiltin, createdAt |
| `PATCH /api/agents/:id` | `{ agent }`; accepts a nonempty object containing only string `name`, `personality`, `systemPrompt`; name must be nonblank. Invalid bodies return 400 with field guidance; absent agent returns 404 with refresh guidance. |
| `GET /api/tasks/:id` | Existing `{ success, task, messages, runs, verificationResults }` plus `dependencies: [{ taskId, blockedByTaskId }]` and `commits: [{ sha, subject?, source: 'branch' | 'merge' }]`. Dates serialize as ISO strings or null. |

Task commits contain the persisted merge-queue commit when available and current worktree commits from `<defaultBranch>..HEAD`. After worktree cleanup only the persisted integration commit is available; a complete historical list of pre-integration author commits is not persisted. Empty/no-worktree tasks return empty commit/dependency arrays as appropriate. No task-status writer was added.

#### SSE contract for Track B

`GET /api/board/:id/events` and `GET /api/runs/:id/stream` accept the cookie without a custom header (native EventSource works). Event `data` is JSON except `ping`. Each board receives its own events plus global `*` events once; events from other concrete boards are excluded. Refetch after reconnect; there is no replay or event ID contract. Auth is checked on connection; logging out invalidates new requests, but does not forcibly close an already-open stream (close EventSource on logout).

| Stream | Event | Payload |
| --- | --- | --- |
| Both | `connected` | `{ boardId, timestamp }` or `{ runId, timestamp }` |
| Both | `ping` | Literal `keep-alive` (not JSON), every 15s |
| Board | `task_status_changed` | `{ taskId, from, to, retries, reason? }` |
| Board | `task_assignment_changed` | `{ taskId, assigneeAgentId, roleId }` (nullable IDs) |
| Board | `task_progress` | `{ taskId, message }` |
| Board | `phase_changed` | `{ boardId, board, workspace, task?, draft?, memory, problem?, instructions }` (workflow snapshot; refetch phase) |
| Board | `verification_step` | `{ taskId, step, passed }`; step is `diff`, a command name, `review`, or `merge:<command>` |
| Board | `merge_item_changed` | Full merge queue row: `{ id, taskId, position, status, conflictTaskId, commitSha, output, createdAt }` |
| Board, global | `rate_limited` | `{ cliType, delayMs, resetTime }` (resetTime is epoch milliseconds) |
| Board, global | `rate_limit_cleared` | `{ cliType }` |
| Board, global | `control_changed` | `{ stopped: boolean }` after successful stop-all/resume |
| Run | Adapter event name | Adapter's structured JSON object (Claude event types such as `system`, `assistant`, `user`, `result`, `stream_event`); payload depends on the adapter. Treat as log data. |
| Run | `run_ended` | `{ runId, exitCode, exitReason }` |

No production `task_created` event is currently emitted; initial creation/status/phase consumers should refetch on the events above and after their own mutations. Run events are not sent over the board stream. No new decision was added to the PRD; these are implementation details/proposals under the assigned Track A contract.

### Track B (UI scaffold)



- Bullet 1 scaffold implemented on `feat/m6-ui`: static Next App Router package,
  neutral light/dark/system CSS tokens in `ui/app/globals.css`, repository-owned
  shadcn primitives, shell, login, board list, API client and reconnecting SSE.
  Bullets 2–5 remain unimplemented; Inbox, Team and Memory are named placeholders.
- **Pending Track A integration:** the shared base has no session or board-list
  endpoints and does not serve static UI. `ui/lib/types.ts` copies the existing
  phase/status and connected-event shapes from `src/server/api/app.ts`; the
  actual board-list shape was read from Track A's sibling checkout and copied:
  `{ boards: [{ id, workspaceId, currentPhase, createdAt,
  workspace: { id, name, repoPath, defaultBranch }, stopped }] }`.
  Confirm it against Track A's final merge; no response fields were guessed.
  Browser integration also runs against a separately built copy of that source,
  leaving both tracks' source ownership intact. No mock
  data, browser secret header, mock endpoint or fixture mode ships in the app.
- One selected board streams at a time on the list, with a Connect control to
  switch; all boards refresh every 15 seconds. This avoids exhausting HTTP/1.1
  browser connection slots when a project has six or more boards. Events during
  a pending fetch coalesce into a follow-up fetch instead of cancelling it.
  Keep one stream per open board when bullet 2 is implemented.
- Login clears the fragment before sending the exchange. Strict Mode mounts share
  the request; fresh fragment navigation starts a new exchange and aborts an old
  session probe. Stream unmount cancels retries and session probes.
- shadcn 4.22.1 was initialized with Radix Nova, neutral, CSS variables and lucide.
  Its current `form` registry entry is replaced by `field`; the installed Form
  pieces are Field/FieldGroup/FieldLabel/FieldDescription/FieldError plus Label.
  Tokens are in `app/globals.css` (the task prompt overrides §4.2's older
  `ui/styles/theme` location). System fonts keep builds independent of Google Fonts.
- Root `build:ui` installs the separate lockfile with dev tools, checks types,
  lints, exports and copies to `dist/ui`; `prepack` builds the CLI first (its
  clean step removes `dist`) and then the UI. `npm test` stays independent of UI.
  Next rewrites exist only during development, controlled by `CREW_SERVER_URL`
  (default 127.0.0.1:4000, verified in the CLI).

#### Exact dependency versions and reasons (for Track A's tech-stack doc)

| Package | Version |
| --- | --- |
| `class-variance-authority` | 0.7.1 |
| `clsx` | 2.1.1 |
| `cn` | 0.5.0 |
| `lucide-react` | 1.61.0 |
| `next` | 16.4.2 |
| `next-themes` | 0.4.6 |
| `radix-ui` | 1.8.1 |
| `react` | 19.3.1 |
| `react-dom` | 19.3.1 |
| `sonner` | 2.0.8 |
| `tailwind-merge` | 3.7.0 |
| `tw-animate-css` | 1.4.0 |
| `@tailwindcss/postcss` | 4.3.3 |
| `@types/node` | 26.6.5 |
| `@types/react` | 19.3.0 |
| `@types/react-dom` | 19.3.0 |
| `eslint` | 9.39.5 |
| `eslint-config-next` | 16.4.2 |
| `shadcn` | 4.22.1 |
| `tailwindcss` | 4.3.3 |
| `typescript` | 6.0.3 |

Reasons: Next/React/React DOM implement D80's static App Router shell; TypeScript
and its Node/React types enforce strict checks. Tailwind and its PostCSS plugin
compile token-based styles. shadcn provides the checked-in Radix components and
shared Tailwind rules; radix-ui supplies accessible interaction primitives;
lucide-react supplies icons. cn, clsx, tailwind-merge and class-variance-authority
are shadcn's class/variant utilities; tw-animate-css supplies primitive animations.
next-themes implements system/light/dark selection and Sonner supplies toasts.
ESLint and the matching Next config check React and Next conventions (ESLint 9
avoids the peer conflicts seen with 10 in this dependency set). All direct
versions are exact and `ui/package-lock.json` pins the full graph.

#### Doc handoff for Track A

- `project-structure.md`: `ui/` now contains app routes, feature components,
  `components/ui` primitives, lib clients/types, focused Node checks and its own
  package/config/lockfile; `scripts/build-ui.mjs` builds and copies static assets.
- `project-techstack.md`: replace the unpinned milestone-6 placeholder using the
  exact versions above. The UI uses no runtime Next server or remote fonts.
- `START_HERE.md`, `handoff.md` (and README status/table if necessary): record
  bullet 1 implemented with Track A session/list/static integration still pending;
  Board/task/inbox/team/memory screens and the full user smoke remain future work.
- `docs/commands.md`: no CLI declarations changed; no regeneration needed here.
- PRD: no edits; these are implementation notes/proposals for review, not newly
  approved decisions. Track B intentionally leaves Track A-owned docs unchanged.

#### Track B integration observations for Track A

The final browser smoke uses an isolated build copied from Track A's current
source, the real CLI in a throwaway git repository and a separate stopped
CREW_HOME, plus this track's static export. No paid agents run. The report records
the resulting login, real cookie/read/SSE, route and restart checks. This does
not merge Track A code into Track B.

A graceful SIGTERM while the browser kept its SSE stream open left the isolated
server waiting in `server.close`; the restart check therefore kills that
throwaway server and starts it again. Track A should review stream shutdown
before packaging. Track B did not edit server sources to address it.

### Track C

#### Bullet 2: Board view

- `/board?id=<boardId>` is a static-export page with `useSearchParams` behind Suspense. The board list links to it. All ten task states match `src/server/scheduler/index.ts`: `todo`, `ready`, `doing`, `verifying`, `review`, `merge-queue`, `merged`, `blocked`, `escalated`, `cancelled`. The queue item's `queued` status is displayed in the merge panel, never invented as a task status.
- The Board uses the existing per-board SSE hook. A 100 ms coalescer batches bursts and allows one follow-up during an in-flight snapshot; first connect/reconnect refetches. A five-second snapshot poll also discovers changes omitted by the shared hook (`control_changed`, run endings and externally added tasks). Shared client/hook sources are unchanged under the round's ownership rules. Proposal: the shared hook owner should subscribe to `control_changed` so cross-tab Stop/Resume need not await the poll.
- Tasks, phase/status, merge queue and board metadata have independent errors and retain clearly marked stale snapshots after failures. Dependencies are read from task detail (four concurrent reads maximum, reused until task timestamp changes or status reports a new live run). Plain SVG arrows run from blocker to dependent, with ResizeObserver and resize/data updates. Proposal: include dependency edges in the task-list response to avoid detail reads for every card on large boards.
- Stop-all and Resume use confirmation dialogs and apply globally, with pending/error states; stopped dispatch has a recovery banner. Escalation has the real Retry endpoint and CLI recovery command. Retry requires Resume while stopped: the existing server interrupts worktree setup on retry during Stop-all (otherwise returning HTTP 500); the Board disables that action and explains recovery. Blocked cards explain answering; merge warnings preserve the server's message. Agent initials/status dots and tool rate-limit badges use existing theme tokens.
- **Server gap:** `/api/status` includes live run IDs but no configured `maxParallelAgents`, `maxRetries`, `maxRuntimeMs`, or run start times. The budget area shows actual live agent counts, this board's retries, staffing activity (busy/registered agents), and elapsed runtime joined from task-detail run starts. It explicitly labels configured limits unavailable; it does not invent defaults or represent staffing as budget capacity. Proposal: expose configured limits and live run start times in `/api/status` for a true remaining-budget bar.
- No server, CLI, dependency, migration, shared primitive, or Track D route changes. The only existing UI change outside owned directories is the allowed board-list link. Bullet 3 adds task detail as described below.

#### Bullet 3: Task detail

- Cards open a keyed Sheet through `?task=<id>` on the same static route. Missing tasks and cross-board task IDs have explicit recovery; task changes and closing the panel unmount the previous identity. Overview shows description, criteria, assignee, dependencies and runs with exit reasons; Verification, Messages and Commits display actual detail response data with empty states.
- Log mounts only for the selected Log tab. It loads the latest run's raw history from `/api/tasks/:id/logs` and subscribes to the live run's named events through `/api/runs/:id/stream`. Tool uses, text and results are distinct; incoming events are flushed in batches and bounded to 500 entries / 8,000 characters each. History parsing is bounded to a 2 MB tail and 1,000 source lines. Scrolling up pauses following; Follow latest resumes it. Stream cleanup runs on hidden tab, close, task/run change, session unmount and `run_ended`; missed end events are recovered by task polling. Reconnect backs off from 1 to 30 seconds, rechecks session and reloads history.
- Each history request stages incoming events until the snapshot arrives. A generation guard discards stale responses without dropping events received during reconnect. The server has no event IDs, so history/live overlap may repeat a few entries; the log explains this. **Server gap/proposal:** the history endpoint exposes only the latest run and reads the whole file. Per-run history and a bounded/paginated tail would support earlier run inspection and avoid transferring an entire long log. The runs list remains complete; no fake historical output is supplied.
- Diff uses the actual worktree endpoint, file collapses, theme-token additions/deletions, and explicit truncation at 250,000 characters or 3,000 lines. Missing worktrees preserve the server explanation. Cancel is confirmed; escalated Retry is confirmed in detail and requires Resume while stopped. Server errors are displayed verbatim, with retry/refresh paths. An open Retry confirmation also disables if external Stop-all is observed; confirmation and execution both check the current disabled state.
- Focused checks cover event-burst coalescing/disposal, arrow coordinates, same-task-timestamp resumed runs, count/payload bounds, structured history, snapshot/live races, stale responses, diff grouping/classification and both diff bounds. Initial coalescing and geometry checks were observed failing before implementation, as were the initial log/diff checks and the line-count regression. Browser evidence and exact clean-suite/build summaries are in `reports/m6-board.md`.

### Track D

#### Bullet 4: Inbox and phase gates

- Inbox now derives unanswered questions from blocked tasks and their ordered
  messages. It shows the question's author, preserves answer text on failure,
  removes an answer optimistically with rollback, and refetches after mutations,
  on demand and every 15 seconds. Dependency blocks without an unanswered ask
  are excluded. Its count is on the Inbox page; a nav badge needs a shared-shell
  edit and is deferred under this round's ownership rules.
- `/phase?board=<id>` reads the real snapshot, subscribes to that board's existing
  SSE hook, refetches on reconnect/events and polls as a fallback. It renders
  problem text, instructions, no-gate state, `crew retry` guidance for escalated
  or cancelled phase runs, and feedback/rejection history from phase-task messages.
  Gate decisions use the exact displayed draft ID and CLI-compatible body. A
  synchronous guard plus disabled controls prevents duplicate in-flight decisions;
  successful decisions remain disabled until the refreshed draft replaces them.
  Stale/validation errors preserve the server message and refetch the snapshot.
- The markdown textarea has a small safe rendered preview (headings, paragraphs,
  bullets and fenced code; HTML and links stay literal). Ticket cards expose
  title, description, acceptance criteria and blocker IDs, validate unknown/cyclic
  blockers and the phase's configured quota (default 20). Earlier-phase and merged
  blockers remain in the dependency graph but outside editable cards and quota.
- **Server gap / proposal:** `Workflow.approve` accepts `edit` only as output text;
  it never applies that text to persisted work tickets. There is no task-update
  endpoint for title, description, acceptance criteria or dependencies. Therefore
  edited ticket cards deliberately cannot be approved; the screen explains this
  and offers rejection with a note to request changes. Original tickets and edited
  output text can still be approved using the existing endpoint. Completing true
  ticket editing needs a server-owned transactional ticket-edit contract that
  checks the draft ID and graph before releasing tickets. No server code was
  changed, and text edits are never presented as saved ticket edits.
- `/phase` is reachable directly or via its board selector. Track C owns the
  Board-header entry point; shared Boards list and shell files were not edited.
- New response subsets and checks stay in Track D's `*-types.ts` / `*-logic.ts`
  files. Existing API, SSE, types, shell and primitives remain unchanged; all
  controls compose the checked-in shadcn components and theme tokens.
- Verification: strict types, ESLint, static export and focused client checks pass.
  Two initial client checks were observed failing (unknown blockers and role scope)
  before fixes, plus a failing merged-blocker regression before its fix. Real
  Chromium against an isolated copy of the built CLI/static export verifies an
  answer, approval, edited spec saved to memory, ticket rejection/note history,
  direct route reloads and a stale gate's real 409/refetch. Dispatch stays stopped;
  all fixture adapter names are `fake` and no agent runs are started. Full root
  suite output and final browser evidence are recorded in the Track D report.

#### Bullet 5: Team and Memory

- Team reads real agents, roles, tasks and status. It shows each persisted server
  status verbatim, actual live-run task(s), tool, role, mode and heartbeat time,
  plus tool rate-limit and stopped-dispatch information. A workspace filter
  scopes the list. Persona editing uses a Dialog and PATCHes only name,
  systemPrompt and personality. Nonblank names are checked locally; server
  messages are preserved and attached to matching fields as well as the form.
- **Server status limitation:** no connected/stale boolean, heartbeat cutoff or
  connected/stale derived state is returned today. Team does not invent one;
  raw statuses (including any future connected/stale values), heartbeat timestamp
  and real live-run presence are shown. Future pull-mode status semantics remain
  server-owned.
- Memory has Project / Role / Task tabs, workspace selection and layer-specific
  filters. Create sends only the selected layer's scope; role options use the
  same builtin/configured/staffed workspace rule as MemoryStore and task options
  come only from boards in the selected workspace. Edit sends title/body only.
  Delete requires a Dialog confirmation. Promote is offered only for unpromoted
  role entries; its server-created project copy and original timestamp are
  refreshed. Source and promotion information are visible, including phase specs.
- Reads coalesce refreshes, cancel on unmount and poll every 15 seconds; mutations
  use the shared cookie API client and preserve server failures. All forms and
  confirmations compose existing shadcn primitives. No dependency, shared file,
  server, test harness, Board or task-detail changes were made.
- Real-browser verification covers persona name/system prompt/personality saved
  in SQLite, create/edit/delete in all three memory layers with DB assertions,
  cancelling delete, role promotion retaining the original plus project copy,
  and direct reloads of `/team` and `/memory`. The final seeded smoke asserts zero
  run rows and no browser page errors. It does not claim a resumed agent run or
  a full paid/fake phase workflow; the CLI has no registered adapter named fake.
- Documentation ownership for this round is respected: architecture/techstack,
  onboarding, handoff and UI README are unchanged. The owning docs track should
  record these new feature folders/routes and replace placeholder/status text
  when integrating Tracks C/D. No CLI declarations changed, so commands reference
  regeneration is unnecessary. Full evidence and remaining limitations are in
  `plan/phase1/reports/m6-gates.md`.


### Track E

#### Part 1: persisted ticket edits

- Human-only `PATCH /api/tasks/:id` and `crew ticket edit <task>` accept title,
  description, acceptance criteria, staffed role, compatible assignee and replacement
  blockers. Only unstarted todo/ready work tickets at a waiting tickets gate or in
  dispatch are editable. Other states return 409 with cancel/create/refresh recovery.
- Scheduler owns atomic field/dependency/readiness writes. All validation and cycle
  detection roll back together. An edit during worktree setup that adds an unfinished
  blocker demotes the ticket to todo; the dispatch transition rechecks status and
  cannot start it. Already-started tickets cannot be edited.
- Reuses `task_assignment_changed` with its existing `{ taskId, assigneeAgentId,
  roleId }` payload after every successful edit, including text/blocker-only edits,
  so existing consumers refetch. No new event name or migration.
- Ticket cards save through PATCH; Add uses POST and Remove confirms cancellation.
  Blockers use a multi-select composed of shadcn Switch/Label. Unsaved changes block
  approval, saved changes do not. Approval still validates the persisted graph and
  pins the displayed draft ID. Cancelled tickets continue consuming creation quota.
- Proposal: edits use last committed write wins (no optimistic version field).
  Dispatch and edits serialize at the database transaction; a worktree may be set
  up using the pre-edit title, but the worker prompt reads the persisted edited task.
  No PRD Decision Log changes; this implements the user's Track E scope.

- Part 1 verification: clean root suite 51 files / 330 tests (482.91s);
  UI typecheck, lint, static build and 19 client checks pass. Real Chromium with
  isolated CLI start verifies edit/blocker replacement/add/cancel/repair/approve
  and one request on double click, with DB assertions and zero agent runs.


#### Part 2: logs of every run

- `GET /api/tasks/:id/logs?run=<id>&tail=<bytes>` selects a task-owned run or
  defaults to the latest, ordered by start time then rowid. Other tasks' run IDs
  return 404. Tail defaults to 262144 bytes; valid range is 1–2097152 inclusive.
  Response retains content/runId/logPath/exit metadata and adds `missing`,
  `truncated`, and byte `offset`. A task with no runs returns empty content and
  missing=false; a recorded run without a file has missing=true. Missing-file races return this shape too.
- `server/api/logs.ts` uses an fd, fstat, bounded allocation and positional reads;
  it never loads the whole file. Both lexical and canonical paths must remain
  under the actual Crew home's logs directory; a symlinked logs root or a file
  symlink escaping it is rejected. Non-files and permission failures have explicit
  recovery. This is path validation, not an OS sandbox against a local process
  concurrently replacing parent directories after validation.
- Task detail retains all run metadata and adds only safe current agent identity
  (`agent: { id, name } | null`), with deterministic chronological ordering.
  `crew logs --run <id> --tail <kb>` has the same limits in KiB. Small latest logs
  keep their old stdout; truncation is reported on stderr, missing files explicitly.
- Proposal / CLI parity: `crew logs <task> --list` lists run IDs, times, adapter,
  agent and exit results so terminal users can discover IDs before selecting them.
  It uses the existing task-detail endpoint and cannot combine with read/follow flags.
- The Log tab keeps an explicit historical selection as new runs arrive, displays
  run identity/time/adapter/agent/exit summary, and keys the viewer by selected run.
  Switching cancels the prior history/stream; only active selected runs stream.
  History offers a larger 2 MiB tail and, at the cap, guidance to the complete local
  .jsonl file. Missing files have a clear label and Reload recovery. Existing DOM,
  parse bounds, reconnect, snapshot/live staging and follow/pause controls remain.
- Existing Track C/D server-gap notes above are historical and superseded by Track E.
  No new dependency, migration, paid-agent run or PRD Decision Log edit.
- A real-browser regression exposed stale Board dependency arrows for two edits
  within one SQLite timestamp second. The SSE hook now passes task/type hints;
  Board detail-cache versions include an edit-event counter for that task.
  Reconnect/manual refresh invalidates all cached details, while ordinary polling
  and unrelated events keep the cache. In-flight reads retain their captured
  version so a later edit cannot be hidden by a stale response.

- Track E final clean root verification: 52 files / 337 tests (461.63s), after
  removing dist; 20 client checks pass. Chromium against the isolated real built
  server/export verifies all assigned flows plus cancelled-blocker repair and
  same-second dependency invalidation. Full evidence/limits: reports/m6-gaps.md.
