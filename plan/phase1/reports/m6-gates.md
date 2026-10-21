# Milestone 6 Track D report

## Summary

Implemented Inbox, phase gates, Team and Memory using the real cookie-authenticated
API and existing shadcn components. Browser checks against the real built static
UI and `crew start` verify answers, gate approve/edit/reject, persona editing and
all memory layers without running agents. Persisting edited ticket cards remains
blocked by a server API gap: gate `edit` saves output text but does not update
work tickets; the UI explains this and prevents misleading approval of card edits.

## Branch and commits

- Branch: `feat/m6-gates`, based on `feat/milestone-6-board` at
  `b5f2ee960e92c3e2c60567ce768cb10470a6e071` after fetch/checkout/pull.
- `8d9d561`: `feat(m6): implement Inbox and phase gates` (bullet 4).
- Final branch commit containing this report:
  `feat(m6): implement Team and Memory` (bullet 5 and delivery evidence).
- Both commits include `Co-Authored-By: OpenAI Codex <noreply@openai.com>`.
- Setup ran root `npm install` and `npm ci --prefix ui`. An external setup process
  changed the shared checkout's branch during implementation. The local commit
  reference was corrected onto `feat/m6-gates`, the base reference restored to its
  original commit, and remaining work isolated in `/tmp/Crew-m6-gates`. No remote
  history was rewritten; the original checkout was left clean on the base branch.

## Done criteria (milestone-6.md §1)

- [x] New screens run as static exports on the real Hono server. No Next process
  was used in the browser smoke. Direct `/inbox`, `/phase?board=<id>`, `/team` and
  `/memory` reloads worked with the real session cookie.
- [x] New controls compose existing shadcn Button, Input, Textarea, Select, Tabs,
  Dialog, Alert, Card, Label and Badge primitives; feature colors use theme tokens.
  No shared primitives or styles were changed and no new dependencies were added.
- [x] Browser transport uses the existing same-origin cookie client, including
  `X-Crew-Board: 1` on mutations. Smoke asserts the login fragment is cleared and
  the real session cookie is HttpOnly. No browser secret-header fallback exists.
- [x] Root tests remain independent of UI builds; separate `npm run build:ui`
  checks types/lint, exports the routes and copies them into `dist/ui`.
- [x] Inbox shows unanswered questions from blocked tasks, author/task and answer
  form, optimistic removal/rollback, retry and empty state. Dependency-only blocks
  and answered conversations are excluded. Reads poll every 15 seconds and can
  be refreshed explicitly; successful answers refetch immediately.
- [x] Phase screen shows current phase, draft, problems/instructions, feedback
  history, retry guidance and read-only no-gate state. Exact-draft approval,
  markdown output edit, reject-with-note, stale 409/refetch and double-submit
  protection were checked against the real server.
- [ ] True ticket-record editing at the tickets gate: not supported by the server.
  Structured cards validate titles, default 20/configured per-phase quota and
  unknown/cyclic blockers. Merged/earlier-phase blockers remain valid without
  entering the editable list or consuming its quota. Card edits cannot be approved;
  rejection with a note is the supported recovery path until a server contract lands.
- [x] Team reads real agents/status/roles/tasks and edits persona fields. Memory
  supports scoped create/edit/delete, confirmation and eligible role promotion.
- [ ] Entire milestone §1 / stories 107–116 / user manual checklist: not claimed.
  Board/task-detail work belongs to Track C, packaging/polish is bullet 6, and a
  complete workflow with resumed agents was outside this seeded browser smoke.

## Test results

### Root suites

Before the bullet 4 commit, ran `rm -r dist && npm test`, exit 0:

```text
 Test Files  50 passed (50)
      Tests  324 passed (324)
   Start at  19:01:03
   Duration  590.56s (tests 94%, import 6%)
```

Before the final bullet 5/report commit, ran `rm -r dist && npm test` in the
isolated worktree, exit 0:

```text
 Test Files  50 passed (50)
      Tests  324 passed (324)
   Start at  19:12:30
   Duration  603.37s (tests 95%, import 4%)
```

### UI checks

`npm --prefix ui run check`, exit 0:

```text
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

New focused checks cover ticket limits, unknown/cyclic blockers, valid merged and
previous-phase blockers, configured quota, exact edit detection, synchronous
submission guard, open-question detection, layer-specific memory scope and role
promotion eligibility. Existing API/session checks continue to pass.

Observed red before green:

- Ticket validation initially returned no errors for an unknown blocker; assertion
  expecting `Unknown blocker` failed.
- Role memory scope initially returned `{}`; assertion expecting `{ roleId: 'r' }`
  failed. Both checks passed after implementing their rules.
- Review regression initially rejected a valid earlier-phase blocker as unknown;
  the new check failed before adding separate blocker graph/context and quota.

`npm run build:ui`, exit 0, final output after dependency installation:

```text
> @crew/board@0.1.0 typecheck
> tsc --noEmit

> @crew/board@0.1.0 lint
> eslint .

> @crew/board@0.1.0 build
> next build

▲ Next.js 16.4.2 (Turbopack)
✓ Running next.config.mjs took 58ms

  Creating an optimized production build ...
✓ Compiled successfully in 5.4s
  Running TypeScript ...
  Finished TypeScript in 5.6s ...
  Collecting page data using 8 workers ...
  Generating static pages using 8 workers (0/7) ...
  Generating static pages using 8 workers (1/7)
  Generating static pages using 8 workers (3/7)
  Generating static pages using 8 workers (5/7)
✓ Generating static pages using 8 workers (7/7) in 662ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /inbox
├ ○ /memory
├ ○ /phase
└ ○ /team

○  (Static)  prerendered as static content

Board static export copied to dist/ui
```

Initial UI lint caught mutation of markdown parser state inside a render callback
and internal navigation via `window.location.assign`. Parsing now happens in a
pure helper, and board selection uses the Next router; subsequent lint/build
passes have no warnings. `git diff --check` passes.

### Real browser and database verification

Used a one-off external Playwright/Chromium script, not a committed browser test
suite. It creates a throwaway git repo and separate `CREW_HOME`, runs the real
built `crew init` and `crew start --port 4112`, and serves a copied production
export with the real Hono static host. Copying build artifacts isolates this
check from harness tests that temporarily replace `dist/ui`.

Dispatch is stopped before startup and all seeded agents use `cliType: 'fake'`.
The production CLI has no registered fake adapter, so an answer's resume attempt
cannot start an agent. The check asserts zero run rows at the end; it proves the
answer mutation/status transition, not session resumption. Login URL stdout is
consumed in memory only; keys/cookies are not logged or saved by the script.

Final browser output (exit 0):

```text
PASS real crew start serves built export; cookie login, no Next server
PASS real browser offline answer failure rolls optimistic item back and retains answer for retry
PASS Inbox direct reload, real answer mutation, optimistic removal and DB answer/status
PASS Approve exact draft; synchronous double click sends one POST; phase advances in DB
PASS spec markdown preview/edit -> real approved output and project memory
PASS merged earlier-phase blocker is valid and outside editable ticket cards
PASS real ticket cards/blockers, unknown blocker prevents approval, Reject persists note on next phase task and displays history
PASS real stale draft 409 shown verbatim; refetch replaces gate with read-only state
PASS Team direct reload, persona Dialog saves three fields to real DB
PASS project memory real create/edit/delete DB assertions, cancel delete, direct reload
PASS role memory real create/edit/delete DB assertions, cancel delete, direct reload; promotion retains original and creates project copy
PASS task memory real create/edit/delete DB assertions, cancel delete, direct reload
PASS zero paid agents, zero runs, no browser page errors; fixture dispatch stopped throughout
```

The first browser probe read SQLite immediately after optimistic hiding, before
its POST completed; its assertion failed. The probe now waits for the real answer
response before checking rows. No product change was made for that probe race.
The final pass was repeated from the isolated worktree's built export.

## Failure paths and races tested

- Browser goes offline after typing an answer: optimistic removal rolls back,
  error is visible, answer text survives, and retry succeeds after reconnecting.
- Two synchronous clicks on Approve produce one POST and one phase advancement.
  A successful gate remains disabled while the refreshed snapshot loads.
- A draft is decided externally after rendering: real server 409 appears verbatim
  and refetch removes the stale gate in favor of read-only state.
- A rejection persists its exact note as `feedback` on the next phase task; the
  refreshed screen displays it. An edited spec persists the exact edited output
  and the matching approved-spec memory body.
- Unknown ticket blockers disable approval in the browser. Pure checks cover
  cycles, a 21st default-limit ticket, configured limits and cross-phase blockers.
- Memory delete cancellation leaves the DB row intact; confirmation deletes it.
  Promotion updates the original role timestamp and creates a project copy with
  promotion source; later deleting the original does not remove that copy.
- Source review checked the existing snapshot/error/memory contracts; a separate
  read-only review found the merged-blocker/quota mismatches and their regression
  check was observed failing before the fixes.

## Deviations / proposals

All are recorded in milestone-6.md §9, Track D:

1. Add a server-owned transactional ticket-edit contract guarded by draft ID.
   Existing gate `edit` is only output text and cannot implement edited tickets.
   This is an unresolved requirement, not a claim that output text updates tasks.
2. Connected/stale status semantics are not supplied by `/api/agents` or status;
   display raw server states, heartbeat time and actual live runs without inventing
   a heartbeat cutoff. Future pull-mode semantics belong to the server track.
3. Inbox nav count and Board phase link require shared/Track C edits. This track
   provides an Inbox-page count and `/phase?board=<id>` with a board selector;
   Track C should add the header link during integration.
4. Poll Inbox/Team/Memory every 15 seconds with explicit refresh; phase additionally
   uses the existing single-board SSE hook. No extra streams for global lists.

## Docs updated

- Only milestone-6.md §9 `Track D` and this report, as the round's ownership rules
  require. No changes to existing sections owned by Tracks A/B/C.
- Architecture, techstack, handoff, onboarding and `ui/README.md` were checked
  against scope. Their placeholder/status text needs the owning docs track's
  integration update; notes are in §9. No dependency/tool version changes or CLI
  declaration changes were made, so no commands regeneration was needed.
- No `src/**`, `test/**`, shared UI files, Board/task-detail files or package
  manifests/lockfiles changed in the branch.

## Known issues and unverified things

- Ticket card edits cannot be persisted until the server gap above is resolved.
- No full agent workflow, paid agents, actual resume, failure-to-retry execution,
  long-lived reconnect/restart exercise or user-run §6 checklist in this track.
  Retry guidance is implemented; actual retry execution belongs to existing CLI.
- Persona validation rendering is implemented; the real browser smoke exercised
  successful edits, while local nonblank-name checks prevent that invalid submit.
  It did not inject every possible persona/memory server validation failure.
- Markdown preview supports the documented basic subset, not full CommonMark.
- Checks ran on Linux/Node 24.18.0 and headless Chromium only. Mobile, WSL, macOS
  and other browsers were not tested.
- Existing install audit output reports 4 moderate root and 9 high UI advisories;
  dependencies were left unchanged under this track's ownership constraints.
