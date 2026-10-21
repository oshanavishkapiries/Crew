# Milestone 7: Breadth (Codex, Pull mode, heartbeat)

The implementation plan for milestone 7 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** plan approved by the user (D88–D93 logged in the PRD). Bullets 0 and 1 implemented; verification is recorded in `reports/m7-bullet-0-1.md`. Bullets 2 and 3 are implemented and verified: 55 files / 378 tests passed; see reports/m7-bullet-2-3.md. Bullets 4 and 5 are implemented; final clean suite/UI build/browser verification are pending. Bullet 6 is not started. Bullet prompts: `agent-prompts/m7-bullet-0-1.md` (done), `agent-prompts/m7-bullet-2-3.md` (done), `agent-prompts/m7-bullet-4-5.md`.

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

## 3. What exists

- `AgentAdapter` interface (`src/adapters/types.ts`): `detect`, `buildSpawn`, `parseOutput`, `isRateLimit`, `buildResume`. Claude Code and fake implement it; the Runner, rate-limit backoff, session resume and the `done` fallback already go through it.
- `agents.mode` (`spawn|pull`) and `lastHeartbeatAt` exist in the schema, unused. `join`/`next` are declared in `src/cli/declarations.ts` but have no handlers or endpoints. Declared endpoints in the PRD: `POST /api/agents/join`, `GET /api/agents/:id/next-task?wait=90`, `POST /api/agents/:id/heartbeat`.
- Codex CLI 0.163.0 is installed here (`codex exec --json`, `-s read-only|workspace-write|danger-full-access`, `codex exec resume`).

## 4. Design

### 4.1 Codex adapter

- `buildSpawn`: `codex exec --json -s <sandbox> -C <workDir>` with the prompt on stdin. Mapping: `read-only` → `read-only`; `standard`/`orchestrator` → `workspace-write`; `full` → `danger-full-access` (only when the human configured `full`). `allowNetwork` maps to Codex's network option for workspace-write.
- **Limitation (stated, not hidden):** Codex has no per-command allow/deny lists like Claude Code. `allowCommands`/`denyCommands` are enforced by the sandbox mode and by the prompt rules, not command by command. The PRD permission section and Team UI say so.
- `parseOutput` turns `--json` lines into `AgentEvent`s and captures the session id; `buildResume` uses `codex exec resume <id>`. `isRateLimit` recognises recorded Codex rate-limit errors (D7).
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
Targeted stale + existing Pull suite: 2 files / 25 tests passed, 47.55s. Bullet 5
in progress; bullet 6 not started. Full verification remains for this session.

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
browser check still pending. No paid agents; bullet 6 remains not started.

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
errors or model processes. Final clean root repeat is pending.
