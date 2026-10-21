# Milestone 7 session 3: bullets 4 and 5

## Scope and commits

Implemented stale recovery, Antigravity/Pull team configuration, private connect
prompt rotation, CLI status and Team/Board status on feat/milestone-7-breadth.
Baseline: accepted session 2 plus prompt commit 7796bba. Requested pull first hit
the local rebase setting with the unrelated unstaged tickets.ts whitespace edit;
`git pull --no-rebase --ff-only origin feat/milestone-7-breadth` succeeded (already
up to date), preserving that edit without touching/stashing it.

- f2876dd: bullet 4 — Pull stale recovery and restart grace.
- 70a5908: bullet 5 — Pull connect, Antigravity and team status.
- 25e8600: replacement-server cleanup regression and final Pull UI activity/spacing.
- Final docs/report commit follows verification.

Stop after bullet 5. Bullet 6 remains **not started**: no milestone 7 smoke script
or paid/manual-agent smoke. No paid agent is run by this session. No new package,
package pin, migration or platform change. The unrelated whitespace change in
src/server/scheduler/tickets.ts is excluded from all commits.

## What changed

Stale evaluation is server-owned with an injectable clock and interval (5 seconds
by default). Project config validates staleAfterMs as a positive integer, default
600000 ms. Each server start and human resume grants one full configured window
of grace; persisted lastHeartbeatAt is not overwritten. Stop-all suspends recovery.

Scheduler performs stale recovery in one synchronous SQLite transaction: recheck
heartbeat/current ownership; end eligible pid-less runs as stale; mark the agent
stale; move doing work/phase tasks to ready; clear ownership; keep retries, branch,
worktree and edits. A replacement can pick up that branch. Old run IDs are refused
with clear reconnect instructions, including after a replacement owns the task.
Join/next reconnect the stale identity. The last stale assignee cannot immediately
reclaim its own retired task until another agent has run it.

An open Pull Reviewer going stale leaves the task in review, clears its reviewer,
and triggers the existing Verifier selection path. Stale candidates and that
task's last stale reviewer are excluded. Phase tasks retain the same task, output
file and worktree for another Orchestrator. Idle Pull agents are never requeued:
their API/CLI/UI presentation becomes disconnected after the activity window.
Spawn agents keep their existing lifecycle. Stopped/rate-limited agents retain
those states rather than being stale-requeued.

Config team entries accept mode spawn/pull (spawn default) and Antigravity with
explicit mode pull. Antigravity spawn/implicit spawn is clearly rejected. Init/start
remain additive/idempotent and reject an existing name silently changing role,
tool or mode. Default four-agent Claude staffing remains unchanged. Antigravity's
adapter only checks executable presence on PATH and always reports headless false;
it does not execute the program, claim a version, register a spawn adapter or run
an agent.

Human POST /api/agents/:id/connect and `crew connect <ID-or-unique-name>` mint a
fresh token on each request and invalidate the previous one immediately. Only the
hash persists. Agent callers are rejected, even when accompanied by a human
secret; browser callers use the existing cookie/CSRF protections. The no-store
response is the one-paste prompt: Crew explanation, private terminal environment,
join/next loop, crew * allowlist and clear-context/rejoin after each done. Tokens
are disclosed only by that explicit human action, never in logs, SSE, status or
this report.

Human agent/status responses expose mode, projected status and heartbeat, never
tokenHash. Team uses existing shadcn Badge/Dialog/Textarea/Button primitives for
mode, connected/running/stale/rate-limited/disconnected/stopped and relative
heartbeat. Connect opens an ephemeral private dialog with a manual copy button;
closing clears it. Board shows a stale previous-run badge after recovery clears
ownership, until a replacement is assigned. CLI status has equivalent mode and
activity/heartbeat information. Board subscribes to stale/connect event names;
Team still polls every 15 seconds and has Refresh.

## Files

Production/server/CLI:
- src/server/scheduler/pull-stale.ts (new), scheduler/index.ts, dispatcher.ts;
  server/index.ts, runner/index.ts, verify/index.ts, api/app.ts, db/schema.ts
  (TypeScript exit-reason union only), project-config.ts.
- src/adapters/antigravity.ts (new), adapters/index.ts; cli/commands/connect.ts
  (new), init.ts, status.ts, declarations.ts.

UI:
- ui/components/team/team.tsx, components/board/task-card.tsx and board-view.tsx;
  lib/agent-logic.ts (new), team-types.ts, board-types.ts, sse.ts;
  checks/agent-logic.test.mjs (new), README.md.

Tests:
- test/harness/pull-stale.test.ts (9 cases), pull-connect.test.ts (3 cases),
  config-init.test.ts (9 additional cases), harness/index.ts (scanner clock options and replacement-server cleanup).
- test/adapters/antigravity.test.ts (presence-only contract, no execution).

Docs: generated docs/commands.md, architecture structure/techstack, PRD API/config
notes, milestone-7.md §9, START_HERE and handoff, this report. No changes to UI
package rules, pins, lockfile or primitives. README quick start remains applicable.

## Verification

Final clean root repeat exited 0: 58 files / 400 tests passed, with no unhandled
errors. UI build/check and browser results are below. Own-diff review covered the
stale and connect production paths, UI/status/credential handling, tests and docs.
The cleanup/UI follow-up was read again before the final clean repeat; no source
or test changes were made during or after that repeat.

Actual output of `rm -r dist && npm test` (exit 0):

```text
> crew@0.1.0 test
> npm run typecheck && vitest run


> crew@0.1.0 typecheck
> tsc -p test/tsconfig.json


 RUN  v5.0.5 /home/oshan/Projects/Crew


 Test Files  58 passed (58)
      Tests  400 passed (400)
   Start at  01:56:27
   Duration  582.29s (tests 95%, import 4%)
```

The clean root run removes dist/ui. After it passed, the already-built and browser-
validated ui/out export was copied back to dist/ui; no UI sources changed and no
second UI build was needed.

Earlier targeted runs:

```text
npx vitest run test/harness/pull-stale.test.ts test/harness/pull.test.ts
Test Files 2 passed (2)
Tests 25 passed (25)
Start at 01:30:07
Duration 47.55s

npx vitest run test/harness/pull-connect.test.ts test/harness/config-init.test.ts test/adapters/antigravity.test.ts
Test Files 3 passed (3)
Tests 35 passed (35)
Start at 01:35:29
Duration 46.77s
```

UI typecheck and ESLint passed; initial `npm --prefix ui run check` passed 22
checks (496.085649 ms). Commands reference was regenerated from declarations.

## Browser evidence

Ran a temporary Playwright script with real headless Chromium at 1365×1000
against the shipped Next static export and actual built `crew init` / `crew start
--port 0`, in a fresh throwaway git repository and separate Crew home. Config used
one Antigravity backend Pull member and staleAfterMs=3000. Every initialized spawn
agent was marked stopped before startup; no human resume was called and the final
DB check found no run with a pid. The fixture was removed and server/browser closed.

Observed via actual browser DOM/actions and real CLI children: browser-key login
(fragment removed), HttpOnly/SameSite=Strict cookie, initial disconnected Pull mode,
private prompt contents, actual Copy button and Chromium clipboard match, closing
the dialog, absence of the token in local/session storage, real join → connected,
real next → running/current task, waiting nine seconds → stale, ready task with
zero retries and preserved worktree/draft, then Board stale previous-run badge.

I visually inspected the credential-free Team and Board screenshots. The Team
screenshot shows distinct mode/status badges, relative heartbeat and separated
Connect/Edit actions. Board shows the ready task, former agent, stale previous-run
text and stale badge. The private dialog was checked by DOM/clipboard assertions;
no screenshot or report contains its prompt/token. Team changes used Refresh and
the Board was opened after recovery; live stale-event invalidation was not manually
isolated from polling. Runtime page-error count was zero. Mobile, other browsers,
manual rate-limit state, persona editing and an actual AI terminal/model are not
claimed as browser coverage.

Exact credential-free browser output:

```json
{
  "passed": true,
  "evidence": [
    "Real crew init/start, shipped static export, one-time browser login and HttpOnly session passed.",
    "Team initially shows Antigravity Pull mode, disconnected and no heartbeat.",
    "Human connect dialog returned a fresh prompt; Copy wrote it to the real Chromium clipboard; close removed it, with no token in browser storage.",
    "Real crew join changes Team to connected with a relative heartbeat.",
    "Real crew next starts a pid-less run and Team shows running/current task.",
    "With staleAfterMs=3000 and the production 5s scanner, Team shows stale; task returns ready with no retry charge and draft/worktree preserved.",
    "Board ready card shows the retired agent and stale (previous run) badge.",
    "No browser page errors and no spawned model run; all default spawn agents stayed stopped. Screenshots contain no connect prompt/token."
  ],
  "screenshots": [
    "/tmp/crew-m7-team-stale.png",
    "/tmp/crew-m7-board-stale.png"
  ]
}
```

Screenshots are temporary manual evidence at the paths above; the report's steps
and assertions stand alone. The temporary script is not a repository smoke script
and does not implement bullet 6.

## Failures and fixes

- First pull failed because local git pull.rebase required a clean tree. Explicit
  no-rebase/ff-only pull succeeded while retaining the unrelated whitespace edit.
- Initial typecheck caught a missing sql import in the dedicated Scheduler recovery
  method; fixed before the first targeted stale run. That run then passed all 25 tests.
- Initial UI typecheck caught an optional dialog error passed to a required string
  prop; using an empty-string fallback fixed it. UI typecheck/lint/22 checks passed.
- First clean root suite passed all 58 files / 400 tests but exited 1 due to one
  unhandled scanner callback after a restarted test server's database was closed
  (527.98s). Harness cleanup still closed its original server when a test replaced
  harness.server. It now closes the current replacement as well as the original.
  A regression advances the clock after cleanup and checks that the replacement
  HTTP listener is closed: it reproduced the database exception before the fix.
  Stale/phase suite then passed 33 tests in 46.04s without the exception.
- Initial browser attempts timed out on an exact status-text selector even though
  the Board rendered its stale badge. A credential-free Board screenshot/DOM
  inspection confirmed the name and status share a span. A substring selector
  corrected the check. The final browser run passed every assertion. Visual review
  also added spacing between Team actions and wired Pull running into the existing
  Board staffing activity bar; a fresh UI build/check/browser run passed afterward.
- Own-diff review made Antigravity's presence check explicit and included running
  alongside busy in the Board activity-dot rule. Both changes precede the final
  clean suite/build. No tests were weakened or skipped.

## Narrow windows, limitations and reviewer decisions

- Grace rule chosen here: one full configured stale window after every server
  start and human resume, while retaining persisted heartbeat. This is an explicit
  implementation rule under D90, not a silently added Decision Log entry. Repeated
  restarts/resumes can postpone recovery. Review this choice alongside the default.
- SQLite heartbeat timestamps have one-second precision. Very short staleAfterMs
  values are approximate; default is ten minutes. The scanner checks every five
  seconds, so stale presentation/recovery can lag the threshold by a scan interval.
- Only doing work/phase ownership or an open Pull review run is recovered. Idle
  agents become disconnected without a DB transition. Blocked Q&A tasks and a
  designated Reviewer that has never opened a run are not stale-requeued.
- The last stale assignee/reviewer cannot immediately reclaim that task; a team
  with only one eligible agent may leave it pending until another agent is available.
  If no alternative Reviewer is eligible, review remains pending (never skipped).
- Recovery is serialized by SQLite in one server, without a terminal lease or
  cross-server coordination. A stopped/rate-limited agent is not recovered during
  that pause. Pull agents remain external processes: Crew cannot prevent continued
  filesystem edits after stale/stop/cancel, but retired run/task mutations are refused.
- The existing review endpoint writes its verdict result before its asynchronous
  status transition. An interruption in that window may leave a result row while
  the transition is refused. This session preserves that previously reported limit.
- Connect rotates every time; concurrent human requests mean the last token wins.
  Closing a pending dialog can discard the minted prompt: reopen to rotate again.
  There is no persisted plaintext retrieval path. Clipboard persistence is controlled
  by the user's browser/OS; the manual check clears it before cleanup.
- Antigravity detection only checks an executable named antigravity on PATH. GUI-only
  installs are not detected; their external session can still use Pull. No actual
  Antigravity, Claude or Codex coding run is invoked here.
- Browser coverage above specifies exact observed flows. Other browsers, mobile,
  real external agents and paid milestone smoke remain unverified. Bullet 6 remains
  **not started**. No further implementation is included in this session.

## UI verification output (trailing whitespace trimmed)

`npm run build:ui` exited 0 after the final UI follow-up:

```text
> crew@0.1.0 build:ui
> node scripts/build-ui.mjs

npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.

added 672 packages, and audited 673 packages in 10s

233 packages are looking for funding
  run `npm fund` for details

9 high severity vulnerabilities

To address issues that do not require attention, run:
  npm audit fix

To address all issues (including breaking changes), run:
  npm audit fix --force

Run `npm audit` for details.
npm warn allow-scripts 1 package has install scripts not yet covered by allowScripts:
npm warn allow-scripts   unrs-resolver@1.12.2 (postinstall: node postinstall.js)
npm warn allow-scripts
npm warn allow-scripts Run `npm approve-scripts --allow-scripts-pending` to review, or `npm approve-scripts <pkg>` to allow.

> @crew/board@0.1.0 typecheck
> tsc --noEmit


> @crew/board@0.1.0 lint
> eslint .


> @crew/board@0.1.0 build
> next build

▲ Next.js 16.4.2 (Turbopack)
✓ Running next.config.mjs took 23ms

  Creating an optimized production build ...
✓ Compiled successfully in 508ms
  Running TypeScript ...
  Finished TypeScript in 2.0s ...
  Collecting page data using 9 workers ...
  Generating static pages using 9 workers (0/8) ...
  Generating static pages using 9 workers (2/8)
  Generating static pages using 9 workers (4/8)
  Generating static pages using 9 workers (6/8)
✓ Generating static pages using 9 workers (8/8) in 678ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /board
├ ○ /inbox
├ ○ /memory
├ ○ /phase
└ ○ /team


○  (Static)  prerendered as static content

Board static export copied to dist/ui
```

`npm --prefix ui run check` exited 0:

```text
> @crew/board@0.1.0 check
> node --test checks/*.test.mjs

✔ retired, paused and disconnected states override old live-run data (1.302514ms)
✔ relative heartbeat handles missing, malformed, future and elapsed times (0.420419ms)
✔ cookie transport, mutation header, JSON and empty responses (30.754951ms)
✔ server error message and unauthorized event, including plain text errors (2.690279ms)
✔ event bursts coalesce and events during a request schedule one follow-up (4.441171ms)
✔ dependency geometry uses card edges and container-relative coordinates (0.663178ms)
✔ a resumed live run invalidates detail even with an unchanged task timestamp (0.894399ms)
✔ ticket approval rejects unknown and cyclic blockers and the 21st ticket (2.753849ms)
✔ edits compare exact text and structured cards; synchronous guard blocks duplicate submissions (0.456399ms)
✔ merged and earlier-phase blockers remain valid without consuming this phase quota (0.470448ms)
✔ ticket saves send persisted editable fields only and replace blockers without duplicates (0.414259ms)
✔ inbox excludes dependency blocks and answered questions; selects latest unanswered ask (1.218363ms)
✔ memory creation sends only the selected layer scope, requiring role/task selection (1.934891ms)
✔ only an unpromoted role learning can be promoted by the human (0.168589ms)
✔ fragment is removed before exchange and concurrent mounts share one POST (15.1705ms)
✔ a fresh fragment exchanges its key even when an older session check is in flight (0.510664ms)
✔ long runs bound both event count and individual payload size (37.535266ms)
✔ history preserves text and tool calls as distinct entries, tolerating non-JSON (0.878699ms)
✔ diffs group files, classify headers correctly and truncate large output (0.590245ms)
✔ reconnect snapshot retains events arriving in flight and ignores stale responses (1.454553ms)
✔ a diff with thousands of tiny lines also has a bounded DOM (1.313356ms)
✔ run history selection stays on an older run while latest advances; request pins task/run/tail (0.524656ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 515.99122
```

The install diagnostics above belong to the unchanged pinned UI dependency tree
(including npm's audit/ESLint/allow-scripts messages); no audit fix, script approval,
package upgrade or pin change was made. A separate real SIGKILL recovery experiment
for an active Pull session was not run; restart grace was exercised through real
server close/start with persisted SQLite state and the injected clock.
