# Track C: Board view and task detail

## Summary

Implemented milestone 6 bullets 2 and 3: a live Board with scheduler columns, dependency arrows, runtime/activity information and global dispatch controls; and a task Sheet with overview, live/history logs, diff, verification, messages and commits. All data comes from the real Crew API and session cookie. Inbox, gates, Team, Memory, server sources and shared clients remain outside this change.

## Branch and commits

- Branch: `feat/m6-board`, based on `b5f2ee9` from `feat/milestone-6-board` after fetch/checkout/pull.
- `4487d92`: `feat(m6): bullet 2 - live Board view`.
- The final `feat(m6): bullet 3 - task detail and delivery report` commit contains task detail and this report; its hash is the branch tip after push.
- Work isolated in `/tmp/Crew-m6-board` so the parallel track can retain the shared checkout. Root `npm install` and `npm ci --prefix ui` ran; incidental root lockfile metadata was restored. No dependency changes.

## Done criteria (milestone-6.md §1)

- [x] Static `/board?id=…` and `?task=…` routes served by the real Hono host; production requires no Next server. Browser refresh passed.
- [x] Stories 107, 108, 113–115 within Track C: real cards moving, dependencies, status/phase, rate limits, Stop-all/Resume, task content/actions. Browser used an isolated real CLI `crew start` with a local executable stub replacing Claude; no paid agent was run.
- [x] Feature controls compose existing shadcn primitives; feature colors use existing theme tokens. No new primitive/dependency/global token edits.
- [x] Browser API/SSE uses existing HttpOnly session authentication and mutation client. No secret is put into browser code or query parameters.
- [x] Clean root tests work without UI output; static UI builds separately. Exact results below.
- [ ] Full milestone 6 and stories 109–112/116 packaging: other tracks/later bullet. This is only bullets 2 and 3.
- [ ] User's manual browser checklist: not claimed. Agent browser checks cover the Track C flow only.

## Test results

`npm --prefix ui run check`: 12 passed, 0 failed (the existing API/session checks plus eight new Board/task checks).

Observed initial failures before fixes: event burst scheduled 100 requests instead of one; geometry returned no path; unbounded log had 1,200 entries instead of 500; absent structured history/diff logic; missing resumed-run cache invalidation and snapshot staging; tiny-line diff did not truncate. Final checks cover the real pure production logic, cancellation/disposal, stale responses and payload/DOM bounds.

Clean suite before bullet 2 commit, `rm -r dist && npm test`:

```text
 Test Files  50 passed (50)
      Tests  324 passed (324)
   Start at  19:03:31
   Duration  648.05s (tests 95%, import 5%)
```

Final clean suite before the bullet 3/report commit, `rm -r dist && npm test`:

```text
 Test Files  50 passed (50)
      Tests  324 passed (324)
   Start at  19:17:54
   Duration  538.89s (tests 95%, import 4%)
```

`npm run build:ui` final output (exit 0):

```text
> @crew/board@0.1.0 typecheck
> tsc --noEmit
> @crew/board@0.1.0 lint
> eslint .
> @crew/board@0.1.0 build
> next build
▲ Next.js 16.4.2 (Turbopack)
✓ Compiled successfully in 556ms
  Finished TypeScript in 2.4s ...
✓ Generating static pages using 8 workers (7/7) in 681ms
Route (app)
┌ ○ /
├ ○ /_not-found
├ ○ /board
├ ○ /inbox
├ ○ /memory
└ ○ /team
○  (Static)  prerendered as static content
Board static export copied to dist/ui
```

Both clean root suites passed without any root test failures. Initial typecheck found nullable task-detail references, fixed by narrowing the render; initial lint rejected synchronous effect state reset, moved into the guarded initialization microtask. Subsequent strict checks and export passed.

## Failure paths and races tested

- Burst invalidations coalesce into one fetch and one follow-up during pending work; disposing stops future work. Board uses five-second snapshots for changes missing from the shared named-event hook and refetches after connection/reconnect.
- Review found resumed runs can retain the task timestamp, and snapshot loads could overwrite live events. New checks and fixes invalidate by live run ID and stage events for every snapshot with generation guards. Independent reviewer rechecked those fixes.
- Real Chrome against real exported UI and real CLI server: login, board-list navigation, stopped state, exact task statuses, empty board, SVG dependency, rate-limited agent badge, `/board?id=…` reload, task creation via API and ready→doing movement, live structured text/tool output, real git diff, real verification output, messages, commits, Stop-all/Resume confirmations, escalated Retry and Cancel.
- Native EventSource instrumentation verified hidden Log tabs and ended runs close run streams. Streams are not mocked; the instrumentation only observes native construction/close.
- Initial browser checker incorrectly selected a Card title as a heading; corrected its locator. A fixture signal could arrive before the local stub installed its watcher; fixture now checks an existing signal immediately after subscribing. These were check/fixture failures, not concealed product passes.
- Browser exposed a server `WorktreeSetupInterruptedError` / HTTP 500 for Retry during Stop-all. UI now disables Retry until Resume, explaining recovery. Reviewer then identified an already-open confirmation could stay enabled after external Stop-all; a real browser reproduction failed before its fix. Confirmation and execution guard now respect the current stopped state. Final real browser pass confirmed the open Retry dialog disables after external Stop-all, then Resume, Retry and Cancel all succeed. A nested-dialog close selector in the disposable check was also corrected; no runtime browser errors remained.
- No test contains new sleeps. Browser fixture waits for observed state/events. No paid agents or smoke scripts were run.

## Deviations / proposals

Recorded in milestone-6.md §9 Track C:

- `/api/status` does not expose configured budget limits or live run start times. UI shows actual run count, retries, runtime joined from task details, and staffing activity, explicitly identifying unavailable limits. A true remaining-budget capacity bar needs server fields; no defaults are invented.
- Dependencies are exposed only on task detail: four concurrent reads, caching unchanged snapshots. Propose list-level edges for large boards.
- Shared SSE hook omits `control_changed` and run endings; retain existing hook and coalesce periodic refreshes under ownership rules. Propose shared subscription update.
- Logs endpoint returns only latest-run full history. UI bounds rendering/parsing and explicitly labels latest-run-only; propose per-run paginated tails. Snapshot/live overlap may repeat a few entries because there are no event IDs.
- Existing server rejects worktree setup during stopped Retry. UI requires Resume; underlying server was not changed.

## Docs updated

Only Track C's section in `plan/phase1/milestone-6.md` §9 and this report. Checked AGENTS.md's docs matrix: Track C prompt explicitly forbids editing structure, techstack, PRD, handoff and shared status sections, so implementation notes/proposals are confined here. No CLI declaration changed; generated commands stay untouched. `ui/README.md` contains earlier scaffold-only status and integration TODOs; updating it belongs to shared docs/packaging ownership, not this round.

## Known issues and unverified things

- The user has not walked the whole milestone checklist. No real paid tool was invoked; the browser worker is a local executable stub with the real Runner/CLI/git/verification path.
- No browser end-to-end suite was added (D86). Disposable browser scripts/screenshots are in `/tmp`, not shipped. Very large project browser performance, mobile polish, every historical adapter event subtype, a real rate-limit recovery timer, and a browser network disconnection/restart were not manually exercised this round. Pure reconnect snapshot/race logic is checked.
- Configured budget capacity and older per-run logs require server additions described above. No server/test files were edited.
- Root install reported 4 moderate audit findings; UI install/build reported 9 high audit findings and an existing deprecated ESLint warning. Existing package install-script approval warnings were preserved; no forced audit fix or dependency upgrade.
- Stop-all can still race a just-submitted Retry before the next five-second snapshot; server errors remain visible and Resume/Retry provides recovery. No client can atomically guarantee the server's state remains unchanged between checks and mutations.
