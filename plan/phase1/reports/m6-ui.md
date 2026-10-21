# Milestone 6 — Track B UI scaffold report

## Summary

Implemented only milestone 6 bullet 1: the separate Next.js static-export package,
shadcn primitives and theme tokens, authenticated app shell, board list, typed API
client and reconnecting SSE hook. Board/task views and Inbox/Team/Memory screens
remain future bullets; the latter three routes contain named placeholders.
Verification includes a production static build, focused client checks, mocked
browser failure/race checks and browser integration with an isolated build of
Track A's current source.

## Branch and commits

- Branch: `feat/m6-ui`, created from fetched/pulled `feat/milestone-6-board` at
  `4a3a40db9d52b6975ef3d305d33850f22d7b9119`.
- `e3d2b5b`: `feat(m6): bullet 1 - scaffold static Board UI`.
- This report and final documentation observations are committed separately after
  the implementation. The report commit is the branch tip at delivery.
- No commit or push to `main`; no force push. No changes under `src/` or `test/`.

## Done criteria (milestone-6.md §1)

- [x] Separate `npm run build:ui` produces `dist/ui`: installs the UI lockfile,
  checks strict TypeScript, runs ESLint, exports Next and copies the static output.
  Root `prepack` builds CLI first, then UI. Package dry-run includes the static
  index, chunks and placeholder routes (61 packaged files in the final check).
- [x] D81 scaffold: generated repository-owned Button, Input, Textarea, Select,
  Tabs, Dialog, Sheet, Badge, Card, Table, Tooltip, ScrollArea, Sonner, Skeleton,
  Alert, Switch, Field form pieces, Label and Separator. Feature controls compose
  these primitives. Colors, radius and font tokens live in `ui/app/globals.css`.
- [x] Scaffold authentication uses the HttpOnly session cookie. The key is removed
  from the fragment before POST; no secret-header fallback, query key or credential
  storage/logging is added. Actual cookie login, refresh and expiry were exercised.
- [x] Root tests still pass independently of UI build. Neither `npm test` nor its
  typecheck invokes the UI toolchain.
- [x] Static output runs on the actual Hono server without a Next server, using
  the isolated Track A integration build described below.
- [ ] All stories 107–116 and the full user smoke: outside bullet 1, intentionally
  not marked complete. Board/task/gates/team/memory/Stop-all UI remain unbuilt.
- [ ] This branch alone serves the Board through `crew start`: Track A's server
  prerequisites are not merged into its base. The combined integration works
  against a separately copied/built Track A source snapshot; merge Track A first.

## Test results

Before the implementation commit, ran exactly `rm -r dist && npm test`:

```text
 Test Files  49 passed (49)
      Tests  314 passed (314)
   Start at  17:43:27
   Duration  623.15s (tests 95%, import 5%)
```

Before the report commit, ran `rm -r dist && npm test` again (exit 0):

```text
 Test Files  49 passed (49)
      Tests  314 passed (314)
   Start at  17:55:08
   Duration  659.88s (tests 96%, import 4%)
```

Final `npm run build:ui` (exit 0; selected output):

```text
> @crew/board@0.1.0 typecheck
> tsc --noEmit


> @crew/board@0.1.0 lint
> eslint .


> @crew/board@0.1.0 build
> next build

▲ Next.js 16.4.2 (Turbopack)
✓ Running next.config.mjs took 84ms

  Creating an optimized production build ...
✓ Compiled successfully in 2.7s
  Running TypeScript ...
  Finished TypeScript in 3.1s ...
  Collecting page data using 7 workers ...
  Generating static pages using 7 workers (0/6) ...
  Generating static pages using 7 workers (1/6)
  Generating static pages using 7 workers (2/6)
  Generating static pages using 7 workers (4/6)
✓ Generating static pages using 7 workers (6/6) in 866ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /inbox
├ ○ /memory
└ ○ /team


○  (Static)  prerendered as static content

Board static export copied to dist/ui
```

`npm --prefix ui run check`: 4 tests passed, 0 failed. Covers cookie transport,
mutation header, JSON/204 handling, server/plain-text/network/malformed-JSON
errors, 401 notification, rejecting an external API URL, removing a key before
exchange, Strict Mode sharing, and aborting an older probe when a fresh fragment
arrives. The fresh-fragment race and malformed-JSON assertions were observed
failing before their fixes, then passing. No browser e2e suite was added.

`git diff --check` passed. `git check-ignore` confirms export, `.next`, incremental
TypeScript state and generated Next environment declarations stay untracked.
`npm pack --dry-run --ignore-scripts --json` verified packaging; the pack lifecycle
itself was not run during the root suite to avoid its CLI clean step racing tests.

## Failure paths and races tested

Manual Chromium checks via a temporary Playwright script, outside the repository:

- Real base `crew start`, throwaway git project and separate stopped CREW_HOME:
  `/api/session` returned 404 through the dev proxy; the UI showed `crew open` /
  `crew start` recovery guidance. This accurately identified the unmerged gap.
- Temporary HTTP mocks for `/api/session`, `/api/boards` and board SSE: single-use
  POST occurs once under development Strict Mode; fragment cleared; HttpOnly
  cookie hidden from page scripts; refresh reuses the session.
- Eight listed boards use one selected stream, preserving request capacity;
  Connect switches boards and closes the previous stream. A slow board request
  plus a burst of 30 progress events still applies the refreshed snapshot.
- Named `phase_changed` refetches; stream loss shows reconnecting and reconnect
  refetches. Navigation closes the stream. Expired session on stream failure
  returns to login; a reused fragment fails with the fragment removed.
- Server 503 message is visible, Refresh recovers, and an empty list suggests
  `crew init`. Light, dark and system theme selections change the token theme.

Actual integration uses a separate temporary copy of Track A's source from
`/tmp/Crew-m6-server`, built there with tsup, and this track's exported `ui/out`.
It does not edit, merge or rebuild the sibling checkout. A real `crew init` and
`crew start` run in a new throwaway project with its own stopped CREW_HOME; no
paid agents run. The printed login URL is captured only in process memory.

The board response types were copied from that actual `src/server/api/app.ts`:
`{ boards: [{ id, workspaceId, currentPhase, createdAt, workspace: { id, name,
repoPath, defaultBranch }, stopped }] }`. The shared base lacks that endpoint;
confirm the shape against Track A's final commit when merging.

Actual-server browser results are recorded in the final verification note below.
The phase-update check sets the phase directly in the isolated SQLite fixture,
then calls the real task-create/assign endpoints. Its real
`task_assignment_changed` event triggers a board-list refetch that displays the
new phase. This checks real SSE and reads; it does not claim to run the paid
phase workflow.

An early integration attempt copied an older sibling `dist` snapshot, whose
static fallback returned the root page for `/inbox/`. Rebuilding the current
sibling source in the isolated copy resolves that mismatch. No navigation
workaround remains in the UI.

## Deviations / proposals

Recorded under `milestone-6.md` §9, heading **Track B**:

- One selected board streams at a time; the full list polls every 15 seconds.
  Opening a permanent HTTP/1.1 stream for every row can exhaust the browser's
  connection pool. An independent read-only review found this; the eight-board
  smoke checks the correction. Refresh invalidations coalesce instead of
  aborting an in-flight snapshot on every event.
- Current shadcn replaces its `form` registry entry with `field`; installed Field,
  FieldGroup, FieldLabel, FieldDescription, FieldError and Label serve as the
  requested Form pieces. No form screens were implemented.
- Tokens follow the task's `app/globals.css` location, overriding the older
  `ui/styles/theme` plan wording. System fonts avoid a build-time font download.
- Exact versions and reasons for every direct UI dependency are in §9 for Track
  A's architecture-doc update. No PRD Decision Log changes were made.

## Docs updated

- `ui/README.md`: restyling tokens/primitives, component generation, local dev
  proxy and login, static packaging, client/stream behavior and integration gap.
- `milestone-6.md` §9 **Track B**: implementation notes, dependency inventory and
  reasons, folder/build changes, integration and Track A doc handoff.
- This report. As directed by m6-common, Track A-owned architecture docs, handoff,
  onboarding, README status and command reference are untouched. Their needed
  updates are explicitly listed in §9; no CLI declarations changed here.

## Known issues and unverified things

- Track A is not merged into this branch. Actual browser integration uses its
  copied current source, not a committed combined branch. Recheck its final
  response contract and run the merged build before publishing.
- An actual SIGTERM with an active browser SSE stream left Track A waiting in
  `server.close`; the isolated restart check uses SIGKILL, then starts a fresh
  server. This server concern is reported in §9 for Track A; no server fix was
  attempted from Track B.
- The full manual milestone checklist and real agent workflow are unrun and out
  of scope. Backoff recovery was exercised, but not every delay up to its 30-second
  cap or arbitrarily many browser tabs. No Node 22/macOS/WSL browser run was made;
  verification here used Node 24.18.0 on Linux.
- UI installation reports 9 high advisories in the development tooling graph,
  and ESLint 9 is marked deprecated by npm. ESLint 10 was tried but produced peer
  conflicts, so this set pins 9.39.5. `npm audit --prefix ui --omit=dev --json`
  reports zero runtime advisories. The root install reported its existing four
  moderate advisories. No forced dependency upgrades were applied.

## Final browser verification note

The final run used the committed Next Link implementation and the current Track A
source built in the isolated integration directory. It exited 0 and printed:

```text
PASS actual Track A CLI printed URL -> built static UI -> real cookie session, board phase and SSE live
PASS actual session survives browser refresh
PASS actual task_assignment_changed event refetches actual board list (phase changed via isolated DB fixture)
PASS static placeholder route and direct-route refresh served by actual Hono
PASS actual server restart rejects old session and fresh printed URL logs in again
PASS no Next server involved in real integration; server copied read-only from sibling Track A build
```

The restart was SIGKILL on that stopped throwaway server with no paid agents.
Expected connection-refused/closed-stream errors and 401s occurred during the
outage and invalid-cookie transition. The browser also reported a 404 for an
unprovided resource; the checked app routes and exported route payloads returned
200. No claim of a zero-console-error run is made.
