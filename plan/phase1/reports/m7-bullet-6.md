# Milestone 7 session 4: bullet 6 — manual smoke and final docs

## Outcome and scope

Milestone 7 implementation is complete on `feat/milestone-7-breadth`, with one
explicit live-validation gap: **mixed Claude-author / Codex-Reviewer smoke step 2
was skipped because Claude authentication was unavailable**. It is not a pass.
Steps 1, 3, 4 and 5 passed in the sole permitted repeat. Milestone 8's manual
real-project mixed-team end-to-end run is next and was not started here.

Base: `92b9c8a`. Requested pull first hit the local rebase setting and the existing
unstaged tickets.ts whitespace edit (`cannot pull with rebase: You have unstaged
changes`). `git pull --no-rebase --ff-only origin feat/milestone-7-breadth` succeeded,
already up to date. That edit was left untouched and excluded from every commit.
The script commit is `462a16bf72cc6750ed67baff264bfae421b3c9c1`; this report and
final docs are in the following docs commit. No main checkout or force-push.

No product behavior, production source, tests, UI source, dependencies, migrations,
package pins or tool minimums changed. No real provider limit was provoked. No
credentials, private connect prompts or raw model logs are included here.

## What changed and files

- `scripts/smoke-milestone-7.ts`, `package.json`: manual `npm run smoke:m7`,
  typechecked but never run by `npm test`. Real CLI init, validated config.team,
  real in-process server/Dispatcher/Runner/Verifier/merge queue and real adapters.
  Scripted terminals use real CLI connect/join/next/done child processes with
  token only in child env/memory. Direct DB seeding removes unused defaults before
  dispatch and sets the fixture board to dispatch; task state is Scheduler-owned.
- Adapter subclasses reserve launch slots before invoking the real adapter, forward
  its spawn/resume config unchanged and check actual Codex args. Claude uses its
  existing maxBudgetUsd option. No fake paid-tool adapter or executable is used.
- `plan/phase1/milestone-7.md`: current implementation status and skipped validation,
  smoke instructions, final notes, consolidated limitations. Earlier session notes
  are explicitly historical; D88 mapping/rate-limit-fixture wording is corrected.
- `plan/phase1/START_HERE.md`, `handoff.md`: current state and milestone 8 next,
  replacing stale onboarding/session-top status with precise results and limits.
- `README.md`: config examples for additive Codex/Pull staffing, private connect
  workflow, default Claude requirements and committing config before merges.
- `docs/architecture/project-structure.md`, `project-techstack.md`: smoke command,
  bounds, script purpose, current adapter/status notes and results. Corrected stale
  milestone 5 smoke/reaper statements while checking these docs against the code.
- `plan/phase1/prd.md`: only stale statements corrected: connect/open command list,
  Antigravity detection/Pull, loaded config, D88 network and Reviewer permissions.
  No new design decision or Decision Log entry was introduced.
- Removed four `plan/phase1/agent-prompts/m7-*.md` files as requested, with live
  references replaced by reports/milestone notes. Git history retains instructions;
  `m5-bullet-5.md` is retained. This report is `plan/phase1/reports/m7-bullet-6.md`.
- `npm run generate:docs` succeeded; generated `docs/commands.md` was unchanged
  because no Crew CLI declaration changed. No generated content was edited by hand.

## Bounds and real execution

Maximum seven paid launches per invocation; zero author retries and a one-launch
per-task/profile guard for Reviewers. The intentional stopped Codex author may
launch twice. Whole deadline ten minutes, run limit 120 seconds, silence limit 90
seconds, CLI subprocesses timed, cleanup watchdog twenty seconds. Claude cap is
$0.50 per launch (at most $3.50 if all seven were Claude). Codex has no USD/token
cap: task/run/time bounds constrain its exposure, not a guaranteed dollar amount.
Four one-file tasks with both tools; three when mixed-tool review is skipped.

Initial shell tool checks reported Claude 2.1.308 and Codex 0.163.0 installed and
logged in. At both smoke preflights, Claude authentication could not be confirmed;
a safe follow-up reported auth exit 1 / loggedIn false (no account details saved).
Codex login remained confirmed. No login or credential files were changed, and no
paid auth probe was used. Do not infer a reason for the changed auth result.

Two smoke attempts total, as authorized: first exit 1, sole repeat exit 0. First
attempt used six Codex launches; repeat used five. No Claude or real Antigravity
process was launched. There was no third paid run. Three one-file local merges
completed in the successful repeat; both attempts asserted server/process cleanup
and removed their temporary repo/home, including private connect material.

| Smoke step | Repeat result | Evidence / remaining gap |
| --- | --- | --- |
| 1. Codex worker | Ran / passed | config.team Codex author dispatched through real adapter; workspace-write/network on/approval never/config+rules ignored; successful native command event for `crew done` with CLI verification response; accepted localhost completion, diff + content gates, real review, merge-queue transition, merge re-verification and one-file local merge. |
| 2. Mixed tools | Skipped | Claude auth unavailable. Claude-author → Codex Reviewer path, successful approve-command assertion and pre-merge worktree HEAD/status checks are implemented but this mixed-tool path did not run. Same-tool Codex reviews ran in the other steps. |
| 3. Pull completion | Ran / passed | Human connect output parsed privately; real CLI join/next/edit/done/rejoin; Antigravity-typed run has null pid, no spawn adapter; existing verification, real Codex review and local merge; done instructs clearing context/rejoin. |
| 4. Stale takeover | Ran / passed | Production 5s scanner, staleAfterMs=5000 and one-second persisted heartbeat precision; silent first Pull run ends stale, task ready/retries=0, same branch/worktree/draft preserved; different Pull member takes it, old run done rejected as retired/stale, replacement completes/reviews/merges. |
| 5. Codex control | Ran / passed | Stop-all via real human CLI on live pid; stopped run, dispatch paused, no live run, retries=0 and branch retained; human resume allows completed Codex replacement. No real rate-limit attempt. |

Pre-merge hook compares each spawned Reviewer's author-worktree HEAD and full
porcelain status with the snapshot at review start; observed clean and unchanged
for the actual Codex reviews. This is observation, not proof that edits are
impossible, or that temporary/reverted edits cannot occur.

## Failures, fixes and final review

- Initial script typecheck caught an override return-type mismatch: Codex resume
  env includes required CREW_SESSION_ID, which a check helper widened away. Making
  that helper generic preserves the actual config type; typecheck then passed.
- First live attempt: after stale requeue the idle Codex worker shared the backend
  role and immediately reclaimed the task. State output shows Pull stale → new
  Codex work; the script timed out waiting for ready and failed step 4. This was
  correct product scheduling, not a product bug. The fix is script-only custom
  spawn roles, leaving backend staffed by the two Pull members. No production fix
  or extra regression test was needed. The repeat passed stale takeover.
- Before the repeat, added explicit successful Codex command evidence for done
  and mixed-review approval; branch existence uses rev-parse (worktree branch
  listings can carry a marker). No retry allowance or assertion was weakened.
- Own-diff re-read checked the complete script, package command, docs and prompt
  retirement before writing this report. It also replaced a second unbounded
  Codex detect subprocess in preflight with parsing the already timed version
  result. Typecheck passed after this small post-smoke cleanup. The successful
  paid output predates only that preflight cleanup; no third paid run was made.
  The root clean suite started before it; subsequent typecheck covers the final
  script. Production code and test code did not change during verification.
- All AGENTS.md doc mappings were checked: scripts/folder purpose, tooling command,
  generated CLI reference, PRD permissions/config, status/onboarding and handoff.
  No remaining live reference points to the retired milestone 7 task prompts.

## First smoke output (exit 1)

Actual combined stdout/stderr; copied lines below have trailing whitespace trimmed.

```text
> crew@0.1.0 smoke:m7
> tsx scripts/smoke-milestone-7.ts

Milestone 7 PAID smoke: maximum 7 launches; Claude $0.50/run; Codex cost unknown; 10 minute deadline. No automatic model retries.
[preflight] claude: missing, unsupported or unauthenticated; dependent steps skipped
[preflight] codex: codex-cli 0.163.0, authenticated
[task] codex-worker: ready
[task] codex-worker: doing
[launch 1/7] codex, codex-worker, standard
[launch 2/7] codex, codex-worker, standard
[step 5] RAN / PASS: live Codex stop-all/resume, zero retries, branch retained; no provider limit attempted.
[task] codex-worker: verifying
[task] codex-worker: review
[launch 3/7] codex, codex-worker, read-only
[task] codex-worker: merge-queue
[task] codex-worker: merged
[step 1] RAN / PASS: config Codex worker, real workspace-write/network-on adapter, HTTP done, verification, review, merge-queue and merge.
[step 2] SKIPPED: mixed-tool author/Reviewer needs both authenticated tools; single-tool review still used where available.
[task] pull-worker: ready
[task] pull-worker: doing
[task] pull-worker: verifying
[task] pull-worker: review
[launch 4/7] codex, pull-worker, read-only
[task] pull-worker: merge-queue
[task] pull-worker: merged
[step 3] RAN / PASS: private connect -> real CLI join/next/edit/done/rejoin, no spawned Pull process or pid, verification/review/merge.
[task] stale-worker: ready
[task] stale-worker: doing
[task] stale-worker: ready
[task] stale-worker: doing
[launch 5/7] codex, stale-worker, standard
[task] stale-worker: verifying
[task] stale-worker: review
[launch 6/7] codex, stale-worker, read-only
[FAILED] step 4 stale takeover: Timed out: production stale scan (5s window, 1s precision)
[state] {"tasks":[{"id":"codex-worker","status":"merged","retries":0},{"id":"pull-worker","status":"merged","retries":0},{"id":"stale-worker","status":"review","retries":0}],"runs":[{"task":"codex-worker","tool":"codex","kind":"work","exit":"stopped"},{"task":"codex-worker","tool":"codex","kind":"work","exit":"done"},{"task":"codex-worker","tool":"codex","kind":"review","exit":"done"},{"task":"pull-worker","tool":"antigravity","kind":"work","exit":"done"},{"task":"pull-worker","tool":"codex","kind":"review","exit":"done"},{"task":"stale-worker","tool":"antigravity","kind":"work","exit":"stale"},{"task":"stale-worker","tool":"codex","kind":"work","exit":null},{"task":"stale-worker","tool":"codex","kind":"review","exit":null}]}
[usage] [{"tool":"codex","input":60615,"cached":54400,"output":154,"usd":null},{"tool":"codex","input":46409,"cached":42752,"output":195,"usd":null},{"tool":"codex","input":48459,"cached":43904,"output":242,"usd":null}]
[cleanup] server closed; no live agent process groups.
[cleanup] throwaway repo/home and private connect material removed.
[step 4] NOT COMPLETED: smoke failed before this step finished.
```

## Sole permitted repeat output (exit 0)

```text
> crew@0.1.0 smoke:m7
> tsx scripts/smoke-milestone-7.ts

Milestone 7 PAID smoke: maximum 7 launches; Claude $0.50/run; Codex cost unknown; 10 minute deadline. No automatic model retries.
[preflight] claude: missing, unsupported or unauthenticated; dependent steps skipped
[preflight] codex: codex-cli 0.163.0, authenticated
[task] codex-worker: ready
[task] codex-worker: doing
[launch 1/7] codex, codex-worker, standard
[launch 2/7] codex, codex-worker, standard
[step 5] RAN / PASS: live Codex stop-all/resume, zero retries, branch retained; no provider limit attempted.
[task] codex-worker: verifying
[task] codex-worker: review
[launch 3/7] codex, codex-worker, read-only
[task] codex-worker: merge-queue
[task] codex-worker: merged
[step 1] RAN / PASS: config Codex worker, real workspace-write/network-on adapter, HTTP done, verification, review, merge-queue and merge.
[step 2] SKIPPED: mixed-tool author/Reviewer needs both authenticated tools; single-tool review still used where available.
[task] pull-worker: ready
[task] pull-worker: doing
[task] pull-worker: verifying
[task] pull-worker: review
[launch 4/7] codex, pull-worker, read-only
[task] pull-worker: merge-queue
[task] pull-worker: merged
[step 3] RAN / PASS: private connect -> real CLI join/next/edit/done/rejoin, no spawned Pull process or pid, verification/review/merge.
[task] stale-worker: ready
[task] stale-worker: doing
[task] stale-worker: ready
[task] stale-worker: doing
[task] stale-worker: verifying
[task] stale-worker: review
[launch 5/7] codex, stale-worker, read-only
[task] stale-worker: merge-queue
[task] stale-worker: merged
[step 4] RAN / PASS: real-time stale scan, zero retries, branch/draft preserved, different Pull agent completes and merges, old run ID refused.
[sandbox] [{"taskId":"codex-worker","mode":"standard","sandbox":"workspace-write","network":true},{"taskId":"codex-worker","mode":"standard","sandbox":"workspace-write","network":true},{"taskId":"codex-worker","mode":"read-only","sandbox":"workspace-write","network":true},{"taskId":"pull-worker","mode":"read-only","sandbox":"workspace-write","network":true},{"taskId":"stale-worker","mode":"read-only","sandbox":"workspace-write","network":true}]
[summary] 5/7 paid launches. All available steps passed; skipped steps above are not passes.
[usage] [{"tool":"codex","input":60555,"cached":54400,"output":156,"usd":null},{"tool":"codex","input":46704,"cached":40192,"output":222,"usd":null},{"tool":"codex","input":46412,"cached":39936,"output":216,"usd":null},{"tool":"codex","input":46422,"cached":42880,"output":219,"usd":null}]
[cleanup] server closed; no live agent process groups.
[cleanup] throwaway repo/home and private connect material removed.
```

## Usage and cost

Values below are numeric CLI usage from completed turns before temporary logs were
deleted; no model/tool text or credentials were copied. There is no synthetic
usage or pricing substituted for unavailable billing.

- First attempt reported completed turns: `{'input': 155483, 'cached': 141056, 'output': 591}`.
- Successful repeat reported completed turns: `{'input': 200093, 'cached': 177408, 'output': 813}`.
- Both attempts combined: `{'input': 355576, 'cached': 318464, 'output': 1404}`.

Cached tokens are a subset of input, not additional input. Some interrupted or
still-ending launches did not emit a completed usage record, so these numbers do
not represent complete billed usage for all eleven launches. The repeat has four
completed usage records and one intentionally interrupted launch. USD estimate is
**unavailable**: Codex reports no USD amount and account billing/pricing was not
read. Claude launch count was zero. Cost drivers are native model/context overhead,
cache hits, tiny command turns and run count; nominal one-line edits do not mean
one-line token usage. Seven launches and $3.50 Claude caps per invocation are
bounds, not a statement of actual charges or a Codex dollar cap.

## Required verification output

`rm -r dist && npm test` (clean run):

```text
> crew@0.1.0 test
> npm run typecheck && vitest run


> crew@0.1.0 typecheck
> tsc -p test/tsconfig.json


 RUN  v5.0.5 /home/oshan/Projects/Crew


 Test Files  58 passed (58)
      Tests  400 passed (400)
   Start at  22:21:01
   Duration  600.56s (tests 96%, import 4%)
```

`npm run build:ui`:

```text
> crew@0.1.0 build:ui
> node scripts/build-ui.mjs

npm warn deprecated eslint@9.39.5: This version is no longer supported. Please see https://eslint.org/version-support for other options.

added 672 packages, and audited 673 packages in 19s

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
✓ Running next.config.mjs took 35ms

  Creating an optimized production build ...
✓ Compiled successfully in 1118ms
  Running TypeScript ...
  Finished TypeScript in 1461ms ...
  Collecting page data using 9 workers ...
  Generating static pages using 9 workers (0/8) ...
  Generating static pages using 9 workers (2/8)
  Generating static pages using 9 workers (4/8)
  Generating static pages using 9 workers (6/8)
✓ Generating static pages using 9 workers (8/8) in 794ms
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

`npm --prefix ui run check`:

```text
> @crew/board@0.1.0 check
> node --test checks/*.test.mjs

✔ retired, paused and disconnected states override old live-run data (1.158612ms)
✔ relative heartbeat handles missing, malformed, future and elapsed times (0.498388ms)
✔ cookie transport, mutation header, JSON and empty responses (72.798345ms)
✔ server error message and unauthorized event, including plain text errors (2.768482ms)
✔ event bursts coalesce and events during a request schedule one follow-up (8.19642ms)
✔ dependency geometry uses card edges and container-relative coordinates (1.148401ms)
✔ a resumed live run invalidates detail even with an unchanged task timestamp (0.945257ms)
✔ ticket approval rejects unknown and cyclic blockers and the 21st ticket (5.006361ms)
✔ edits compare exact text and structured cards; synchronous guard blocks duplicate submissions (0.779918ms)
✔ merged and earlier-phase blockers remain valid without consuming this phase quota (0.92301ms)
✔ ticket saves send persisted editable fields only and replace blockers without duplicates (0.87728ms)
✔ inbox excludes dependency blocks and answered questions; selects latest unanswered ask (1.681059ms)
✔ memory creation sends only the selected layer scope, requiring role/task selection (4.910151ms)
✔ only an unpromoted role learning can be promoted by the human (0.661595ms)
✔ fragment is removed before exchange and concurrent mounts share one POST (51.490618ms)
✔ a fresh fragment exchanges its key even when an older session check is in flight (1.888346ms)
✔ long runs bound both event count and individual payload size (60.346325ms)
✔ history preserves text and tool calls as distinct entries, tolerating non-JSON (1.321454ms)
✔ diffs group files, classify headers correctly and truncate large output (0.90818ms)
✔ reconnect snapshot retains events arriving in flight and ignores stale responses (2.355905ms)
✔ a diff with thousands of tiny lines also has a bounded DOM (2.084138ms)
✔ run history selection stays on an older run while latest advances; request pins task/run/tail (0.783553ms)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 978.261907
```

## Limitations and unverified paths

- Mixed real Claude-author/Codex-Reviewer step 2 is skipped, not passed. Its paid
  path and Claude budget forwarding are not live-validated here; both tools are
  required for it. Missing-both-tools scripted Pull Reviewer fallback is also not
  exercised. Final preflight cleanup is typechecked, not paid-rerun.
- This uses real in-process server components plus real CLI clients; it does not
  claim a new built-server SIGKILL/restart experiment, macOS run, actual Antigravity
  terminal or browser pass. Existing harness/UI evidence remains in prior reports.
- No real provider limit occurred; rate-limit fixtures remain synthetic. Stop-all
  was used instead. Full grill-to-integrate real-project validation is milestone 8.
- Codex command lists/push denial/state reads/scoped phase writes and Reviewer's
  no-edit rule are prompt rules; workspace-write permits external network too.
  Full lacks OS containment. OS read-only with network off cannot call Crew HTTP.
- Pull terminals are not sandboxed or killable by Crew; retired run IDs protect
  API task submissions, not arbitrary terminal filesystem edits. Single-server
  serialization and shared-token replay are not independent terminal leases.
- Full startup/resume stale grace can postpone recovery if repeated; persisted
  heartbeats have one-second precision, scanner interval five seconds. A solo
  last-stale assignee cannot immediately reclaim its own task. Blocked Q&A and
  designated Reviewers with no run are outside stale recovery. Review never skips
  because an alternate Reviewer is unavailable.
- Existing verdict-write/asynchronous-transition window and connect last-token-wins
  behavior remain. Full consolidated limits and historical notes: milestone-7.md §9.

Delivery: normal push of this branch only; main and the unrelated tickets.ts edit
are untouched. Final status/check results are recorded below before committing.

## Final delivery checks

- Clean `rm -r dist && npm test`: exit 0, **58 files / 400 tests**, 600.56s,
  no unhandled errors. Full real stdout/stderr is pasted above.
- `npm run build:ui`: exit 0, typecheck/lint/Next static export passed.
  `npm --prefix ui run check`: exit 0, **22 passed**, 978.261907ms.
  The export remains in dist/ui; its index matches ui/out after the root suite.
- The install diagnostics above come from the unchanged pinned UI tree
  (ESLint deprecation, audit and pending allow-scripts messages). No audit fix,
  dependency upgrade or package script approval was made.
- Final `npm run typecheck` exited 0 on the final script, after preflight cleanup:

```text
> crew@0.1.0 typecheck
> tsc -p test/tsconfig.json
```

The smoke ran at most twice; the successful repeat's mixed-tool step is still
skipped, not passed. Own-diff/doc checks and `git diff --check` passed. Only the
explicit docs/report/prompt-removal paths are staged for the docs commit; no
src/, test/, ui/, lockfile or credential content is staged. The unrelated
tickets.ts whitespace edit remains in the working tree. No milestone 8 work.
