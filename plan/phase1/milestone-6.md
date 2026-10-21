# Milestone 6: Board UI

The implementation plan for milestone 6 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** planned (2026-10-21). Nothing is built yet. D80 and D81 are decided; D82–D87 (§7) are Claude's proposals awaiting the user's approval.

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


## 9. Proposed during implementation

### Track B

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
  Confirm it against Track A's final merge; no response fields were guessed. No mock
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
