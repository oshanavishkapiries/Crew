# Milestone 6: Board UI

The implementation plan for milestone 6 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** bullet 0 (Track A server prerequisites) implemented (2026-10-21); Board UI and browser smoke remain. D80 and D81 are decided; D82–D87 (§7) are Claude's proposals awaiting the user's approval.

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

Proposed by Claude, awaiting approval:

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
