# Milestone 7: Breadth (Codex, Pull mode, heartbeat)

The implementation plan for milestone 7 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** implementation done (bullets 0–6), D88–D93 approved. The manual
`npm run smoke:m7` passed steps 1, 3, 4 and 5 on 2026-10-22: real Codex worker
and Reviewers, Pull completion, stale takeover and Codex stop/resume. **Step 2
(mixed Claude author / Codex Reviewer) was skipped because Claude authentication
was unavailable at preflight.** That live validation remains open; it is not a
pass. See [session 4 report](reports/m7-bullet-6.md) for both attempts, usage and
final checks. Earlier implementation evidence: [0–1](reports/m7-bullet-0-1.md),
[2–3](reports/m7-bullet-2-3.md), [4–5](reports/m7-bullet-4-5.md).
Next is milestone 8's manual end-to-end run on a real project with a mixed team.
Milestone 7 task prompts are retired; their instructions remain in git history.

## 1. Goal

A team can mix Claude Code and Codex agents, and any agent (including Antigravity, D17) can run in the developer's own terminal in Pull mode. Pull-mode work passes the same verification gates, and a dead Pull session never strands a task.

### Done when

- `cliType: codex` agents are dispatched, resumed (`ask`/`answer`), rate-limit-paused and stopped exactly like Claude Code agents (stories 21, 130, 131).
- `crew join`, `crew next --wait` and `crew done` work for a Pull agent, with verification, review and merge unchanged (stories 66–70).
- A Pull agent with no `crew` call for the stale window is shown stale and its task is re-queued (story 69).
- Team and Board show mode (spawn/pull) and connected / running / stale / rate-limited (story 111).
- Adapter contract tests for Codex pass against **recorded real fixtures** (PRD testing section); the pipeline harness covers Pull mode and stale handling with the fake adapter.
- Docs, `docs/commands.md` and decisions are updated in the same commits (AGENTS.md).

## 2. Scope

In: Codex adapter; Pull mode API + CLI; heartbeat/stale; Antigravity as a Pull agent type; Team/Board status; smoke script.
Out: an Antigravity headless adapter (D17), other tools, Phase 2 budgets, the milestone 8 end-to-end run (separate, manual).

## 3. Baseline before milestone 7

- `AgentAdapter` interface (`src/adapters/types.ts`): `detect`, `buildSpawn`, `parseOutput`, `isRateLimit`, `buildResume`. Claude Code and fake implement it; the Runner, rate-limit backoff, session resume and the `done` fallback already go through it.
- `agents.mode` (`spawn|pull`) and `lastHeartbeatAt` exist in the schema, unused. `join`/`next` are declared in `src/cli/declarations.ts` but have no handlers or endpoints. Declared endpoints in the PRD: `POST /api/agents/join`, `GET /api/agents/:id/next-task?wait=90`, `POST /api/agents/:id/heartbeat`.
- Codex CLI 0.163.0 is installed here (`codex exec --json`, `-s read-only|workspace-write|danger-full-access`, `codex exec resume`).

## 4. Design

### 4.1 Codex adapter

- `buildSpawn`: `codex exec --json -s <sandbox> -C <workDir>` with the prompt on stdin. Current D88 mapping: `read-only` → `workspace-write` by default so `crew review` can reach localhost; only `allowNetwork: false` uses OS `read-only`. `standard`/`orchestrator` → `workspace-write`; explicit `full` → `danger-full-access`. Workspace-write network is on by default; `allowNetwork: false` disables it. This permits external networking too. The Codex Reviewer's no-edit restriction is a prompt rule, not an OS boundary.
- **Limitation (stated, not hidden):** Codex has no per-command allow/deny lists like Claude Code. `allowCommands`/`denyCommands` are advisory prompt rules, not executable command filters. The PRD permission section and Team UI say so.
- `parseOutput` turns `--json` lines into `AgentEvent`s and captures the session id; `buildResume` uses `codex exec resume <id>`. `isRateLimit` recognises structured Codex rate-limit errors (D7); the rate-limit fixture is explicitly synthetic because no real limit was obtained.
- No Stop hook equivalent: completion comes from `crew done`, and the existing "run ended without `crew done`" fallback applies (same path as Claude without the hook).

### 4.2 Pull mode

- Agent token as today. `crew join --token` returns role, persona, rules, workdir and project memory (story 41) and marks the agent `connected` (`lastHeartbeatAt = now`).
- `crew next --wait 90` long-polls (<90 s, below tool timeouts). The server provisions the worktree and moves the task `ready → doing` exactly as the Dispatcher does for spawn agents, but **assigns to the connected Pull agent instead of spawning**; the response carries the full prompt (same prompt builder as spawn). No task: `{ retryIn }` and the CLI tells the agent to call again.
- Every `crew` call from a Pull agent (`update`, `ask`, `remember`, `done`, `next`) refreshes `lastHeartbeatAt`; a dedicated `POST /api/agents/:id/heartbeat` exists for idle waiting.
- After `crew done` the response tells the agent to clear context and run `crew join` again (story 68). Verification, review, retries and merge are unchanged (story 70).
- Pull runs have no child process: the run record has no pid, `crew logs` shows the reported updates, and Stop-all/cancel mark the task and tell the agent on its next call.

### 4.3 Heartbeat and stale

- A Pull agent with a `doing` task and no call for `staleAfterMs` (default 10 min, configurable) becomes `stale`; the task goes back to `ready` without charging a retry, the run is ended `stale`, and the worktree branch is kept for the next assignee. A stale agent that calls again is reconnected, and its old task is refused with a clear message.
- Spawn agents are unchanged (process exit is the signal).

### 4.4 Antigravity

Pull mode only (D17): `cliType: antigravity`, mode `pull`; Crew prints a one-paste connect prompt (join + next loop). No adapter code beyond `detect` reporting `headless: false`.

### 4.5 UI

Team shows mode and status including stale; Board card agent badge shows stale; a "Connect prompt" copy button for Pull agents. shadcn components only (D81).

## 5. Tracer bullets

0. **Codex fixtures + adapter.** Record real `codex exec --json` runs (normal, resume, rate-limit if obtainable) as fixtures; implement the adapter; contract tests. *Needs a human-run recording (paid), like milestone 3.*
1. **Codex wiring.** `cliType: codex` in init/team/config, detection in `crew init`, dispatch/resume/rate-limit through the harness with a Codex-shaped fake, sandbox mapping tests.
2. **Pull join/next/heartbeat.** Endpoints, CLI handlers, long-poll, assignment without spawn, prompt parity test, auth isolation tests.
3. **Pull completion path.** `done`/`ask`/`update`/`remember` from a Pull agent through verification → review → merge in the harness; stop-all/cancel semantics.
4. **Stale detection.** Scanner, requeue without retry charge, reconnect behaviour, restart recovery.
5. **Antigravity + connect prompt + UI status.** Team/Board changes, `crew status` shows Pull/stale.
6. **Smoke and docs.** `scripts/smoke-milestone-7.ts` (manual, paid), generated commands reference, handoff.

## 6. Testing notes

Harness first (PRD): Pull mode uses the fake adapter driven through the real CLI as a "pull agent" process; stale handling uses the injected clock. Real Codex is only in recorded fixtures and the manual smoke. UI covered by `build:ui` and the manual checklist.

## 7. Decisions (approved, logged as D88–D93)

- **D88** Codex sandbox mapping as in §4.1, with the documented limitation that per-command allow/deny lists are not enforceable on Codex.
- **D89** Pull assignment reuses the Dispatcher's provisioning and prompt builder; the only difference is "hand to the polling agent" instead of "spawn".
- **D90** Stale window default 10 minutes (`staleAfterMs`), requeue without charging a retry, branch preserved.
- **D91** Every Pull agent `crew` call is a heartbeat; no background heartbeat process is required.
- **D92** Pull runs have no pid; Stop-all/cancel reach the agent on its next call.
- **D93** Milestone 7 ships Codex and Pull in one release line; Antigravity is a Pull agent type with a copy-paste connect prompt (D17).

## 8. Open questions

- Resolved for session 1: `scripts/record-codex-fixtures.ts` was run once as explicitly requested by the task prompt; see §9 and the report for real output and cost limitations.
- Is 10 minutes the right stale window for slow human-driven Pull sessions? Default: yes, configurable.

## 9. Implementation notes

Sessions 1–3 below are historical records. Later D88 updates and the final
consolidation supersede their initial sandbox/network limits and “not started”
status statements.

### Session 1: bullets 0 and 1

- Bullet 0: Codex adapter, minimum 0.163.0, explicit D88 sandbox mapping, stdin
  prompts, resume with exec-level sandbox/cwd options before the subcommand,
  isolated per-run JSONL parsers and structured rate-limit detection. CLI config
  and execpolicy rules are ignored, approval policy is never, workspace network
  follows `allowNetwork`. Only explicit full selects danger-full-access.
- Real recorder ran exactly once: edit 19.553 s, resume 11.826 s, read-only
  18.292 s (49.671 s total CLI time). Token usage is in recording.json. USD cost
  is unavailable from the CLI and is not estimated. No real rate limit occurred;
  `rate-limit-synthetic.jsonl` is labelled synthetic. The read-only response
  reports denial and no file was created, but it has no command event: an actual
  attempted syscall denial is not proven. No extra paid probe was attempted.
- Bullet 1: default Runner registration and exports, installed-tool reporting in
  init, additive validated config.team creation on init/start. Default Claude
  staffing remains. Team fields are name, role and cliType (claude-code|codex);
  names are idempotent, changing a name's role/tool is an error, omission never
  deletes. No UI, Pull mode, heartbeat or Antigravity implementation.
- Runner captures Codex's real thread ID instead of preassigning one; stored
  Claude IDs now follow the actual adapter spawn env too. Complete final lines
  use the same event/session/rate-limit path before retiring a run; repeated
  rate-limit error/terminal events advance backoff only once per run. A dispatch/answer race exposed by
  the new harness is fixed by choosing session resume for answered asked runs
  and coalescing concurrent work starts for the same agent (authors and Reviewers remain separate). The harness asserts exactly two runs.
- Codex-shaped fake processes use real CLI calls, real worktrees and the real
  Codex parser for dispatch, ask/answer, rate-limit reset/backoff, stop/resume,
  process-group timeout and no-output kill. A successful Codex turn without
  crew done remains an exited run and consumes a retry/escalates (D22); no Stop
  hook is invented.

### Limitations and reviewer decisions

Command lists, git push denial, state-file read rules and the Orchestrator's
single-output-file rule are advisory prompt rules on Codex; workspace-write
allows writes throughout the worktree. Full has no OS filesystem/network
containment. The PRD permission section now says this explicitly (D88).

Network-disabled sandbox HTTP connectivity to localhost Crew was not verified
with a paid run. Codex read-only normally disables network, and full cannot
restrict it; the workspace-write network flag is honoured exactly. Explicit
allowNetwork can enable workers' HTTP CLI calls but also permits external
network access. A network-disabled read-only Reviewer needs a future scoped
local transport/network design. Reviewer: decide that follow-up before claiming
a real mixed-tool review pipeline works. The harness proves engine behavior,
not real-tool sandbox networking. Team UI permission caveats/status changes are
not implemented in this server session.

Final clean-build verification: `rm -r dist && npm test` passed **54 files /
361 tests**, 440.58 s (typecheck and fresh CLI build). Full output, earlier
failures and targeted regression results are in the session report.

Open questions about who runs the recorder are closed for session 1: it ran once
as explicitly requested by the task prompt. At the end of session 1, bullets 2–6 were **not started**.

### Codex network default (D88 update, 2026-10-22)

A real probe showed a network-disabled `workspace-write` Codex sandbox cannot reach `127.0.0.1` (curl exit 7; a Unix socket also failed), so a Codex worker could not call `crew ask`/`crew done`. Crew now enables `sandbox_workspace_write.network_access` by default (`allowNetwork: false` turns it off). The cost: Codex workers can also reach external hosts, so the sandbox is a filesystem boundary, not a network one. Verified with real Codex 0.163.0 through the harness: a worker ran `crew done` and the task reached `verifying` (run exit `done`). Still open: a read-only Reviewer on Codex has no network and therefore cannot run `crew review` over HTTP; needs a scoped transport or running the Reviewer with workspace-write plus prompt rules.

### Codex Reviewer sandbox (D88 update, 2026-10-22)

The `read-only` profile maps to Codex `workspace-write` (network on) unless `allowNetwork: false`, so the Reviewer can call `crew review`. The no-edit rule is now a prompt rule, not an OS boundary: a Codex Reviewer could modify the author's worktree. The Diff gate and merge-time checks still run on what the author committed, but a Reviewer edit in the worktree is possible. Verified with real Codex 0.163.0 (fake author, Codex Reviewer, harness): the Reviewer ran `git diff`, `git show` and `crew review approve`, the task reached `merge-queue`, and no files were edited.

### Session 2: Pull provisioning (bullet 2)

Join/next/heartbeat and CLI handlers are implemented. Connection is represented by
lastHeartbeatAt plus idle/busy scheduling status; join returns connected: true.
The server uses token headers, refuses spawn tokens and human auth on Pull endpoints,
and refreshes heartbeat on every token-authenticated API call (injected Runner clock).
next caps idle waiting at 85 seconds, checks every 250 ms, cleans abort listeners and
returns retryIn when empty. Provisioning is serialized with spawn dispatch, including
worktree setup. Concurrent polls for one agent replay one run/assignment; they do
not create two worktrees/runs. No token rotation, process or runtime timer for Pull.
The same prompt/permission-context builder and main-checkout snapshot serve both modes.
Initial targeted coverage: 11 Pull harness tests passed (21.48s). Bullet 3 is also
complete; the final clean suite passed 55 files / 378 tests (506.21s), including
all 16 Pull cases. Bullets 4–6 remain not started.

### Session 2: completion (bullet 3)

Pull done closes its pid-less run before the verifying event and uses the existing
Diff/command/Reviewer/merge queue path. A failed gate or review returns feedback
in the next protected prompt and charges the existing retry policy. Done tells the
agent to clear context, rejoin and poll. Ask closes the run as asked; human answer
returns to doing without spawning/resuming a child. Next returns full Q&A; other
authenticated calls receive a bounded answer reminder in X-Crew-Instruction.
Stop/cancel notices use that header, including on error responses. Reminders may
repeat. Updates append ordinary run-log events; status includes pid-less runs.
Stop-all ends those runs as stopped, keeps the doing task/worktree and blocks task
mutations until resume and a new next. Cancel ends them as cancelled, removes the
worktree and rejects late task writes. Returned runId is required on Pull task,
phase and review mutations (CREW_RUN_ID / X-Crew-Run-Id), refusing a prior run after
stop/resume. Token authentication and task/reviewer ownership still apply.

The shared review-context reader serves both spawn and Pull Reviewers. A selected
Pull Reviewer is left pending until it polls; its verdict uses the existing review
endpoint and retry/merge path. Pull Orchestrator phase completion uses the existing
phase endpoint/gate and cleans its worktree after submission. No adapter is invoked
for either kind of Pull run. Real CLI harness covers these paths, including a fake
terminal agent that launches real CLI children. No paid agents ran.

Narrow windows/limits: serialization is in one Dispatcher/server (not cross-server
coordination). Repeated polls with one token replay the same active run: they are
one identity, not independent terminal leases. No extra persistent delivery cursor
or background heartbeat is introduced. Idle waiting is capped at 85 seconds; existing
worktree/setup/provisioning (including a pass ahead in the shared queue) may take
longer than the idle wait. A disconnected client can retrieve that assignment on
its next poll.
Pull connection means lastHeartbeatAt is recorded, not that Crew owns the terminal
process. Permissions are advisory for that external process. Stop/cancel signals
arrive on the next Crew call and cannot prevent subsequent terminal file edits;
old task mutations are refused. No stale scanner/requeue, Antigravity/connect UI,
status UI, smoke script or paid smoke is implemented: bullets 4–6 **not started**.

The own-diff read added a final transaction-time Pull run check for done/ask/review
and a post-body check for update, so late or duplicate calls cannot submit for a
retired run. Notification selection prioritizes active owned/reviewer tasks before
older terminal history. A real CLI concurrency test asserts one done result and
one verifying transition outcome.

Existing review-endpoint ordering is retained: it writes the verdict result before
the asynchronous Scheduler transition. Interruption while that transition awaits
worktree preparation can leave a verdict-result row even when the final transition
is refused; the Pull run check protects the status change, not rollback of that
pre-existing write. No general review transaction redesign was added here.

First clean full suite: 54 files passed, one failed; 377 tests passed, one failed
(513.71s). The only failure was the historical agent-commands expectation that join
is unimplemented. It now asserts the implemented command rejects missing agent
credentials instead. Production code was unchanged; the fresh clean full repeat passed **55 files /
378 tests**, 506.21s. Exact output and all prior failures are in the session report.

### Session 3: stale detection (bullet 4)

Server-owned scanner uses an injectable clock/interval (default 5 seconds), with
validated staleAfterMs (positive integer ms; default 600000). Startup and human
resume each grant one full configured window of grace. Persisted lastHeartbeatAt
is retained, so downtime alone never triggers immediate recovery; stopped dispatch
suspends scanning. SQLite heartbeat precision remains one second.

Recovery is a synchronous Scheduler transaction: recheck heartbeat/current task
ownership, retire only that agent's eligible pid-less runs, mark stale, and return
doing work/phase tasks to ready without retry charge or worktree/branch cleanup.
Clear ownership so another matching agent can pick up the same branch. An open
Pull review stays in review, clears its reviewer, and re-enters the existing
Verifier selection path; stale candidates and the last stale reviewer for this
task are excluded. An unconnected designated reviewer with no run is not scanned.
A reviewer may remain pending if nobody else is eligible.

Join/next reconnect a stale agent, with a retired-run notice; old task mutations
remain refused. The last stale author/reviewer cannot immediately reclaim the
same task until a different agent has run it. Idle agents are only projected as
disconnected, never requeued. Scanner passes cannot interleave with done's SQLite
transaction; both success-before-expiry and stale-before-late-done are tested.
Targeted stale + existing Pull suite: 2 files / 25 tests passed, 47.55s.
Final session verification is recorded below. Bullet 6 is not started.

### Session 3: Antigravity, connect prompt and status (bullet 5)

Config accepts team.mode (spawn default), Claude/Codex in either mode and
Antigravity only with explicit mode: pull. Existing name/role/tool/mode mismatches
are errors; init/start stay additive/idempotent. Detection checks only an executable
named antigravity on PATH, never launches it and always reports headless false.
No GUI-installation/version or headless-capability claim is made.

Human POST /api/agents/:id/connect and crew connect <ID-or-unique-name> rotate
a fresh token on every request. Only the hash persists; the previous token stops
authenticating immediately. No-store response contains the one-paste prompt,
including crew * allowlisting, terminal env, join/next loop and clear-context/rejoin
after done. Cookies require the existing Board CSRF header and agent tokens are
refused even with a human secret. CLI prints the prompt only on this explicit
human command. Team shows it in a shadcn dialog with a manual copy button; close
clears its state. No token is put in UI storage, SSE, logs or reports.

Human agent/status responses project Pull connected/running/stale/rate-limited/
disconnected (plus stopped), mode and heartbeat; raw schedulingStatus is retained
on the agent inspector. Idle Pull agents become disconnected without a DB/status
transition. Team shows mode/status badges and relative heartbeat. Board retains a
previous-run stale badge using latest stale work-run history after the assignee is
cleared, until a replacement is assigned. A background resource poll updates Team
every 15 seconds; Refresh is available. Board also listens for stale/connect SSE.

Targeted config/connect/detection suite: 3 files / 35 tests passed (46.77s). UI
typecheck/lint and 22 client checks passed. Final clean suite, UI build and real
browser checks also passed (details below). No paid agents; bullet 6 remains not started.

Limits: the last stale assignee/reviewer cannot immediately reclaim its own retired
task; another eligible agent must run it first. A single-agent team can therefore
leave that task pending on reconnect. Reviewers with no open run remain outside
stale scanning; blocked Q&A tasks are not requeued. Rate-limited agents are not
stale-requeued during a tool pause. A duplicate human connect request rotates again,
so the last prompt wins. Closing a still-loading dialog can discard a newly minted
prompt; reopen to mint another. These choices add no persistent terminal lease or
credential retrieval mechanism. Existing review-result/transition window above
remains. Restart/resume grace is an implementation rule under D90, not a new
Decision Log entry; reviewer should assess that explicit rule and these limits.

Session 3 verification follow-up: the first clean suite passed all 58 files / 400
tests but exited 1 for a late scanner callback from a replaced test server after
its DB closed (527.98s). Harness cleanup had retained the original server even
when a restart test replaced harness.server. It now closes the current server
and the original when different. The restart regression advances the injected
clock after cleanup and checks the replacement HTTP listener is closed; it failed
before the fix and passed afterward. Stale + phase suite: 33 tests passed (46.04s).

UI build (typecheck/lint/static export) and 22 client checks passed. Real Chromium
against actual crew init/start in an isolated repo/home passed: stopped all default
spawn agents before start; configured Antigravity Pull worker; authenticated with
the actual one-time browser URL; Team disconnected, private dialog/copy/no-storage,
join connected, next running, then stale with staleAfterMs=3000 and production
5s scanner; ready task kept draft/worktree/retries; Board showed stale previous-run
badge. Screenshots were taken only after clearing the private dialog. The initial
Board wait used exact text on a span containing both name and status; diagnosis
confirmed the badge rendered and the selector was corrected. A final UI pass spaces
Team actions and includes Pull running in the Board staffing bar. No browser page
errors or model processes. The final `rm -r dist && npm test` exited 0: 58 files /
400 tests passed in 582.29s, with no unhandled errors. The previously validated
ui/out export was restored to dist/ui after the root clean run. Full output and
precise browser coverage/limits: reports/m7-bullet-4-5.md. Bullet 6 is not started.

### Session 4: bullet 6 — manual smoke and final docs

`scripts/smoke-milestone-7.ts` is manual, paid and typechecked by `npm test`, never
executed by it. Read its top-level bounds before running `npm run smoke:m7` from
the repo root. Authenticate both tools for all five steps; absent/unauthenticated
tools cause explicit skips. No real Antigravity installation is required: real
CLI child processes play the Pull terminal. Neither the smoke nor Crew pushes the
fixture repo. The script deletes its temporary repo/home after closing the server
and checking recorded process groups; private connect output stays in memory.

With both tools, expect seven paid launches: Codex interrupted author + replacement,
Claude Reviewer, Claude author + Codex Reviewer, and two real reviews of Pull work
(the review tool depends on available candidates). The hard cap is seven, with no
author/Reviewer retries; runs are limited to 120 seconds, silence to 90 seconds,
and the whole smoke to ten minutes plus bounded cleanup. Claude has its existing
$0.50 per-run cap (at most $3.50 if every allowed launch were Claude). Codex has
no dollar cap: tiny tasks/runtime/run-count bounds constrain exposure, and the
CLI reports token usage rather than USD. This is not a total-dollar guarantee.

First attempt: steps 1, 3 and 5 passed, step 2 skipped (Claude auth unavailable),
step 4 failed because an idle Codex worker shared the Pull role and reclaimed
stale work before the script could observe ready. Production behavior was correct.
The script now gives spawn workers separate fixture roles, and asserts real
Codex command success in addition to API/DB/merge evidence. The sole permitted
repeat exited 0: steps 1, 3, 4 and 5 passed, step 2 explicitly skipped. Five Codex
launches in the repeat, six in the first attempt, no Claude or real Antigravity
launch. Both attempts closed the server, checked process groups and removed their
fixtures. No further paid run was made. Full outputs and usage: session 4 report.

The smoke checks the actual Codex arguments returned to Runner (workspace-write,
network on, approval never, user config/rules ignored), a successful real CLI done
command and localhost completion, diff/command verification, a real Reviewer
verdict, merge-queue transition, re-verification, one-file local merge and cleanup.
Before ref publication it compares the author worktree's HEAD/status with its
pre-review snapshot. Pull checks include connect/join/next/done/rejoin, null pid,
real-time stale scanning, preserved branch/draft, zero retries, another Pull agent's
takeover and retired-run rejection. Stop/resume uses the human CLI on a live Codex
process, never a deliberately induced provider limit. Live mixed-tool step 2 is
implemented but **unverified** in this session; restore Claude login before its
next authorized run or milestone 8. No product behavior changed in bullet 6.

### Consolidated known limitations

- Codex cannot enforce per-command allow/deny lists, git-push denial, state-file
  read denial or the Orchestrator's one-output-file restriction. These are prompt
  rules. Workspace-write permits worktree edits and network access by default,
  including external hosts. Explicit full has no OS filesystem/network containment.
- The Codex Reviewer uses workspace-write/network-on to reach `crew review` over
  localhost. Its no-edit restriction is advisory. The smoke observes unchanged
  HEAD/status before merge; it does not prove edits are impossible or detect edits
  that were reverted. A network-disabled OS read-only Reviewer cannot use the
  current HTTP transport. Real rate-limit samples are still unavailable/synthetic.
- Pull terminal agents are external and unsandboxed. Crew cannot kill or prevent
  their file writes after stop/cancel/stale; retired run IDs cannot submit task
  mutations. Shared tokens represent one identity, not independent terminal leases.
- Startup and every human resume grant a full configured stale window without
  rewriting persisted heartbeat. Repeated restarts/resumes postpone recovery.
  SQLite heartbeat precision is one second; the production scanner checks every
  five seconds, so very short windows are approximate. Default is ten minutes.
- Stale recovery covers doing work/phase ownership and open Pull review runs.
  Idle agents only project disconnected. Blocked Q&A and designated Reviewers with
  no open run are not stale-requeued; stopped/rate-limited agents remain paused.
  The last stale assignee/reviewer cannot reclaim that task until another agent
  has run it, so a single-agent team can leave it pending. Review is never skipped
  merely because another eligible Reviewer is unavailable.
- Provisioning is serialized in one server, not across servers. The 85-second
  idle poll cap does not bound worktree/setup work ahead of assignment. Connect
  rotates on every request; the last prompt wins, and closing a pending dialog
  may discard a minted prompt (reopen to rotate). No plaintext retrieval exists.
- Existing verdict persistence precedes the asynchronous status transition: an
  interruption can leave a verdict row even when the transition is refused.
  Milestone 7 adds no general transaction redesign. Antigravity detection checks
  PATH presence only, not GUI installation/version or a headless interface.
- The live smoke covers tiny dispatch tasks, not the full grill-to-integrate
  workflow or a real project. Mixed-tool live review remains skipped, no macOS or
  actual Antigravity terminal was exercised, and milestone 8 remains required.

Final session verification (2026-10-22): `rm -r dist && npm test` exited 0,
58 files / 400 tests passed in 600.56s; UI build (typecheck/lint/static export)
and all 22 client checks passed. Final script typecheck passed after the bounded
preflight cleanup; no third paid run. Full command output is in the session report.
