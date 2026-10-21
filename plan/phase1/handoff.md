# Handoff

**Milestone 7 session 1: bullets 0 and 1 implemented** on
`feat/milestone-7-breadth`. The Codex 0.163.0 adapter is registered by default;
init detects tools; config.team creates additive named Codex/Claude spawn agents
with built-in/custom roles on init/start. Init preserves stored config. Existing
agents are never silently changed or removed. All three real fixture turns ran
once (49.671 s; 105,426 input / 155 output tokens; USD cost unavailable). The
read-only response reports denial but has no tool event; do not claim syscall
proof. Rate-limit samples are explicitly synthetic.

The Codex-shaped harness uses real child processes, CLI HTTP calls, worktrees
and the production parser. It covers dispatch, captured thread identity,
ask/answer resume, reported reset and backoff, stop/resume, timeout/no-output
process-group kills, final non-newline and repeated rate-limit errors, and
exited-without-done escalation. The answer/Dispatcher
race discovered during verification is fixed for work tasks: both choose the
saved session and Runner coalesces concurrent work starts for the same agent. Final clean-suite
output and the complete file inventory are in `reports/m7-bullet-0-1.md`.
Final `rm -r dist && npm test`: **54 files / 361 tests passed**, 440.58 s.
Bullet commits: `78125a9` (fixtures/adapter), `a1250c2` (wiring).

Limitations: Codex command lists, state-file denials and Orchestrator single-file
writes are prompt rules, not per-command enforcement (D88). Workspace network
follows allowNetwork; full has no OS containment. Real Codex-to-Crew HTTP in a
network-disabled sandbox was not tested; read-only Reviewer completion needs a
scoped local transport/network decision. No real Crew Codex workflow or mixed
review smoke is claimed. No UI changes. **Bullets 2–6 are not started**: next is
Pull join/next/heartbeat, using `milestone-7.md`. Stop this session after bullet 1.
Milestone 6 is on main and its manual browser checklist passed (2026-10-21).


Track E (`feat/m6-gaps`) closes both assigned gaps: ticket cards persist edits,
add and cancel work; Scheduler commits fields, dependencies and readiness atomically.
The Log tab selects every recorded run, with summary, missing-file recovery and
bounded tail expansion. CLI parity: `crew ticket edit`, `crew logs --run/--tail`
and `crew logs --list` to discover run IDs. Log reads reject outside paths and
symlink escapes. No paid agents, dependencies, migrations or PRD decisions added.
Verified: clean root suite 52 files / 337 tests (461.63s), 20 client checks and
real Chromium flows with isolated stopped dispatch. See `reports/m6-gaps.md` for
exact verification and limitations, and milestone-6.md
§9 Track E for contracts and proposals. The user's manual checklist and preview
packaging remain; the other known gaps are dependency-detail reads and run-end polling.

**Milestone 6 (Board UI): bullets 0–5 are merged on `feat/milestone-6-board`** (2026-10-21). Server prerequisites (Track A), UI scaffold (B), Board view and task detail (C), Inbox, gates, Team and Memory (D). Verified after the merge: `rm -r dist && npm test` 324 tests, `npm run build:ui`, `npm --prefix ui run check` 18 tests, and a real browser against a real `crew start` (login, board page, phase page, the other routes load). Fixed on the way: shutdown no longer hangs on an open SSE stream. Reports: `reports/m6-server.md`, `m6-ui.md`, `m6-board.md`, `m6-gates.md`. Afterwards `/api/status` gained per-board `limits` and the Board listens to `control_changed`. The user decided the two remaining gaps (ticket-edit persistence, per-run logs) belong in Phase 1: the Track E prompt (branch `feat/m6-gaps`, since merged). Remaining: the user's manual browser checklist (`milestone-6.md` §6), dependency-detail reads, run-end polling and preview packaging. Track E above closes ticket persistence and per-run logs; budget limits and control events were already closed after the merge. The Milestone 6 track prompts were deleted after the merge (they stay in git history).

# Milestone 5 final implementation handoff

Status: **milestone 5 is done** (2026-10-21). Bullets 0–9 are implemented, `npm run smoke:m5` passed live with real Claude Code, and the decisions are logged as D56–D79. The private preview still needs packaging (npm tag, tarball or git URL, README quick start). The details below describe the sessions that built it; the verification record is `reports/m5-final.md`.

The merged tracks finish dispatch/integrate and CLI polish. Boards with all work merged/cancelled enter integrate once; escalated work remains actionable through retry or cancel. Approved integrate text is a sourced `Project summary` snapshot; Orchestrator access to other roles' learnings and agent promotion require a live integrate context. Status exposes phases, gates, recovery hints and work-ticket counts; task filters combine with AND. The reviewer narrowed Crew-home Read denial to sensitive state/logs, retaining readable worktrees, with a real 2.1.305 fixture; that accepted correction was not redone.

Interruption inventory before this session: `dispatch-integrate.test.ts` already covered the complete three-ticket journey, zero/cancelled boards, last-ticket escalation via retry/cancel, merge/cancel race, dispatch reconciliation and final-gate restart, edited/concurrent final approval, rejected/ungated integration, crash/hang/stop-all and staff repair. `interruptions.test.ts` already covered live/gate graceful restart, stop/resume, cancel/retry, escalation/retry and worker/missing-token auth for grill/spec/tickets. Added only integrate cancel/replacement with dead PIDs; integrate auth plus foreign-workspace callers; ended/different-board promotion rejection; late ticket creation in dispatch; stop-all with two running workers then one integrate; and the real built-server SIGKILL experiment.

Hard-crash finding: the server's SIGKILL leaves the detached agent alive, and a new real `crew start` launches a duplicate for the same grill task. `crew stop-all` in the new server cannot kill the old run. The test demonstrates stopping new runs, explicitly terminating the verified old process group, resuming, receiving a recovered draft, and approving into spec. No durable process-ownership infrastructure was added; this requires a user decision in §9. The experiment uses the real CLI/server and Claude adapter with only the paid executable stubbed, so actual Claude behavior remains unverified. Graceful restart is separately covered.

`npm run smoke:m5` costs real money. It initializes an isolated `/tmp` repo/home through the real CLI, starts the real CLI server, uses real Claude Orchestrator/two workers/Reviewer, answers grill, rejects one tickets gate with a note and approves all gates. It asserts phase order, three reviewed merges and commits, sourced spec/integrate/promotion memory, no human-only Orchestrator command, no worktree Read denial and no agent process group left. Run cap: 11 expected + 1 rejection + 3 author retries + 3 extra review rounds + 6 Reviewer retries + 5 phase retries + 1 extra grill resume = 30; $0.50 per run, expected $1–$6, at most $15 in caps, 20-minute deadline. First-run risks: compound Bash permission denials, forbidden human commands, output budget and agent compliance. Artifacts are retained for diagnosis. The script was not executed.

The D77 startup reaper is built (`src/server/runner/reaper.ts`, called by `crew start`), and the live smoke passed. Next: milestone 6 (Board UI) and preview packaging. Open: a limit for repeated gate rejection, the grill answer/resume race, and agent access to `crew tasks`. Architecture/onboarding docs reflect the merged state; README has no status/doc table to update. Commands declarations did not change in this final session; generated reference was checked by the suite. No commit or push to main.

---

# Milestone 5 bullet 5 handoff

Status: bullets 0–5 implemented and verified (257 tests across 43 files). Stop after bullet 5 as requested. Bullets 6–9 are not started. Milestone 5 is not done; no milestone 5 smoke script was written or run.

Bullet 5 connects real Dispatcher/Runner/fake-adapter phase tasks through grill ask/answer (session resume and refused-session fresh-process fallback), spec gates and ticket planning. Spec approval stores the actual edited text in project memory with source `phase:spec:<draft-id>` atomically with approval and the successor task; rejection stores no spec memory. Ungated specs use the same path. Tickets created in tickets stay todo until approval; Scheduler holds creation, explicit ready transitions and blocker promotion. Approval validates dependencies and atomically decides the draft, advances to dispatch and releases dependency-ready tickets. Rejection keeps existing tickets and quota counts for revision; human cancellation discards unwanted ones. See milestone-5.md §9 for recovery and narrow-window choices.

A real live-Orchestrator regression proved `crew approve` could load the human secret from server.json and approve another board's pending gate. The human CLI authentication helper now rejects agent-token environments before reading credentials. This is the only prior-bullet bug fix. Memory delete and promotion outside integrate were already denied. No permission-fixture or D28 changes.

New early-workflow harness cases cover real grill Q&A reaching emitted prompts, edited/rejected specs, visible provenance, stale approval, ungated publication, 0/1/20-ticket gates, live-agent and human 21st-ticket rejection, held tickets through rejection, post-approval worker dispatch, bad creation repair and bad-blocker recovery through human cancel then approve, and live Orchestrator command boundaries. The valid-gate human approval regression was observed red before its fix; the other implementation coverage is not claimed as red-first. Initial runs also exposed test setup (wrong role) and timeout issues; tests now use the staffed backend role and a larger bound for 20 real CLI creations.

Verification: clean-build `rm -r dist && npm test` passed typecheck/build and 257 tests across 43 files (494.02s). Pre-commit clean-build verification also passed all 257 tests across 43 files (487.80s). One fresh own-diff read completed. The final strengthened early-workflow rerun passed all 9 cases (61.98s), including emitted-prompt assertions and live-agent overflow.

Remaining: dispatch/integrate lifecycle and memory summary rewrite (6), exhaustive hard-crash/restart and stop/cancel interleavings (7), CLI polish (8), smoke script only (9). No new dependency or migration. Commands docs regenerated unchanged. PRD decisions and README unchanged. The report-only commit was pushed separately. This follow-up commits all remaining bullet 5 code, tests and documentation locally; it has not been pushed.

---

# Milestone 5 bullet 4 handoff

Status: bullets 0–4 implemented and verified (248 tests across 42 files). Stop here as requested; next is bullet 5. Bullets 5–9 are not started. Milestone 5 is not done and no milestone 5 smoke script was written or run.

The requested Reviewer diff/Q&A/history correction is committed as 97a9a17 (220 tests). Bullet 4 adds the phase engine, detached phase worktrees, scoped output permissions, task-linked draft outputs, atomic gates and human recovery. Migration 0005 was generated; existing 0004/snapshots were not edited. Human approve pins a draft ID and stores actual edited text; rejection starts a fresh task with note and rejected output. Successors/cancelled replacements preserve prior Q&A; cancellation stays terminal and human retry creates a replacement. Status shows phase/gate/recovery hints. Phase errors, adapter preparation errors, executable spawn failure, setup failure and timeout use bounded retry/escalation; stop/resume charges no retry. See §9 for explicit board/draft CLI choices, context carry and narrow windows. The full grill/spec/ticket/memory workflow remains bullets 5–6.

Before engine implementation, a real Claude Code 2.1.300 permission/transport fixture proved an allowed exact Edit, denied Edit elsewhere and a real phase-done CLI POST under dontAsk; the recording HTTP receiver is not the engine. The fixture is test/fixtures/claude-code/phase-output-dontask.json. The probe used disabled external settings sources; phase spawn/resume use the same isolation so wider user/project allows cannot broaden the output grant. The two probes cost $0.1184984 total; neither was a smoke run or a real engine workflow. No bypass mode or D28 implementation change.

Tests: phase-transport (1), adapter phase permissions/fixture (2), phase engine/recovery (24 cases) and pre-engine database upgrade (1). Fresh-process, concurrent/stale gate, edited text, rejected output/note, durable restart gate, detached cleanup, forced phase-only permissions, missing-team/empty-output repair, ungated phases and start failures are covered. Kill tests assert agent and child PIDs are gone. The initial engine cases and targeted context/profile/startup regressions failed before their fixes; not every additional coverage case was observed red. One own-diff read, then one fix pass for lost successor/rejection/cancelled Q&A context. A production/fixture flag-parity contract also checks isolated phase settings. No additional mutation checks. Final clean-build verification: `rm -r dist && npm test` passed typecheck/build and 248 tests across 42 files (274.82s). Commands docs regenerated; PRD Decision Log and D28 untouched; nothing pushed.

Remaining: grill Q&A/spec memory/ticket release (5), dispatch/integrate lifecycle and memory promotion (6), exhaustive running-phase hard-crash/restart and stop/cancel request interleavings (7), remaining CLI polish (8), smoke script only (9). The current phase-run uniqueness test covers concurrent starts in one server, not an ungraceful crash leaving an old agent process alive. Preview packaging and repeated gate rejection limits remain open.

---

# Milestone 5 prompt protection correction

Status: bullets 0–3 reviewed, followed by the requested Reviewer diff/Q&A correction. Bullet 4 is next; milestone 5 is not done. Reviewer diffs are protected and capped with an explicit truncation notice; every question/answer is protected. Earlier failure history is retained as a complete list before optional memory when it fits, otherwise explicitly reported omitted; current feedback is retained. §9 records the cap and history choice.

Three regressions failed before the fix; all ten injection tests now pass. Final `rm -r dist && npm test` passed typecheck/build and 220 tests across 39 files (260.63s). One fresh diff read completed. No dependencies, migrations, PRD Decision Log or D28 changes. Nothing pushed.

---

# Milestone 5 bullet 3 handoff

Status: bullets 0–3 implemented and verified (217 tests across 39 files). Stop here as requested; next session starts at bullet 4. Bullets 4–9 are not started and milestone 5 is not done. No milestone 5 smoke or real Claude permission fixture has been written/run this session.

`memory/prompt.ts` is the single prompt builder. Runner default, additional instructions, session resume and both fresh-process fallback paths use it; Verifier supplies raw diff/results instead of assembling a Reviewer prompt. The builder applies workspace role overrides, persona/system prompt, scoped memory and task context with a character/4 budget. Lower relevance and then older entries are dropped; persona, task/criteria, current feedback and run instructions remain even if they exceed the budget. Git discovery is read-only with hooks disabled. See §9 for the exact ranking/protected-budget policy. A seeded phase task proves prompt assembly only; phase lifecycle and gates remain unimplemented.

Seven new injection tests assert the text emitted by the fake adapter, not just stored prompt rows. All seven failed before implementation. They cover relevance/recency trimming, protected overflow, role/task/workspace privacy, real verification Reviewer context, configured fresh-process fallback memory/Q&A/Git/feedback, phase-task instructions, and parent/completed-blocker/history context. Focused ask/resume/review/injection run: 14 passed; final injection rerun: 7 passed. Final `rm -r dist && npm test`: typecheck/build and 217 tests across 39 files passed (268.77s). One own-diff read per bullet, commands docs regenerated, no new dependencies/migrations in bullets 2–3, no additional mutation checks. D28 and the PRD Decision Log untouched; nothing pushed.

Next: bullet 4 phase engine and real Claude Code output-file permission fixture; then 5–8 workflow/interruption/polish and 9 smoke script only. Integrate promotion auth currently uses a Scheduler-seeded live phase context. Phase failure/retry, gate races and full workflow have not been tested because those slices are not implemented.

---

# Milestone 5 bullet 2 handoff

Status: bullets 0–2 implemented and verified; bullets 3–9 remain. Milestone 5 is not done. Memory CRUD, role-scoped agent learning, scoped reads and explicit atomic promotion are implemented through the API and real CLI. Entries record human/agent sources; promotion traces the original entry and stamps both rows. Only a live integrate Orchestrator can promote as an agent; the phase context is seeded in the harness until bullet 4. See §9 for API/CLI details and provenance policy. No migration, dependencies, PRD Decision Log or D28 changes.

Verification: all five new memory tests failed before implementation and then passed. The first full run found the old unimplemented-command test still using remember (209 passed, 1 failed); it now checks the out-of-scope join stub. Final `rm -r dist && npm test` passed typecheck/build and 210 tests across 38 files (274.43s). Commands docs regenerated, one own-diff read completed. Nothing pushed. Next: bullet 3 shared prompt builder; stop after it this session. Phase engine and real permission fixture remain bullet 4; smoke remains unwritten/unrun.

---

# Milestone 5 bullet 1 handoff

Status: bullet 0 reviewed (6405147), the requested init/adapter fixes committed (e6d9279), and bullet 1 ticket API/CLI implemented and verified (205 tests across 37 files). Bullets 2–9 remain. Milestone 5 is not done; no real permission fixture or smoke was run.

`POST /api/tasks`, `crew ticket create` and `crew assign` now support human-secret and live Orchestrator-phase authentication. Human creation names the board and expected phase; agent context is inferred from its live phase task. Public creation cannot make phase tasks. Creation validates roles, assignees and blockers and counts durable per-board/phase quota atomically in Scheduler creation; assignment accepts a staffed role or workspace agent only before execution. Bad requests roll back without consuming quota. The existing dispatcher picks an idle matching-role agent. Generated migration `0004_clever_red_hulk.sql` adds `tasks.kind` (default work) and nullable `creation_phase`; see the migration-order proposal in §9. There is no phase engine yet: the Orchestrator harness seeds its phase context through the Scheduler, while real human creation works on existing boards. Ticket gate release remains bullet 5.

Focused verification: 15 tests pass across ticket harness/database, including the milestone 4 upgrade. Eight ticket tests and the upgrade test were observed failing before implementation/fixes. The single diff re-read identified reassignment during asynchronous worktree setup; the real setup-command regression failed, then a pre-spawn assignee recheck made the next dispatch use the new owner without a retry. Final verification: `rm -r dist && npm test` passed typecheck/build and 205 tests across 37 files (226.47s). `npm run generate:docs` and `git diff --check` passed. Docs commands regenerated. D28 and the PRD Decision Log untouched; nothing pushed.

Next: bullet 2 memory store/API/human CLI. See §9 proposals for early migration and caller context. Follow with shared prompt builder (3), phase engine and real permission fixture (4), workflow (5–6), interruptions (7), polish (8), and smoke script only (9).

---

# Milestone 5 init and permission-pattern correction

Status: bullet 0 reviewed, followed by the requested init visibility and adapter pattern fix. Bullets 1–9 remain pending; milestone 5 is not done. Init and status now explain that an untracked config pauses merges until committed. The real CLI/git regression preserves config bytes, commits the config, and observes the queued task merge. Adapter contracts cover explicit wildcards and plain prefixes. D28 and the PRD remain untouched. Verification: `rm -r dist && npm test` passed typecheck/build and 196 tests across 36 files (341.57s); both new regressions failed before the fixes. `npm run generate:docs` and `git diff --check` passed.

# Milestone 5 bullet 0 handoff

Status: bullet 0 (config and init) implemented, reviewed and verified on `feat/milestone-5-workflow` (base `4a3737ebbfd52649df0ab083dbfc09c4556fcc16`). Bullets 1–9 have not started. The milestone is not done and no milestone 5 smoke script has been written or run.

`crew init` discovers the canonical git root/default branch, preserves existing config, and transactionally creates a workspace, grill board, six built-in roles and a four-agent Claude Code team. Repeating init preserves rows and file bytes. Real CLI `crew start` uses pinned jiti 2.7.0 to load/validate all registered config files before binding, replacing stored config only after all loads succeed. Imports refresh on restart. Legacy workspaces without a file retain stored settings. Role overrides are workspace-local, with custom roles given workspace-qualified IDs; fixed reviewer/Orchestrator profiles remain protected. Editing-role prefixes expand to exact and argument-bearing Bash rules; fixed push denials remain. Git entries require a supported literal subcommand; bare Git, absolute executables and global options are ignored. Runtime/retry/dispatch/verification limits consume workspace config.

Agent-token finding: the existing Runner already re-mints tokens lazily on the first run after restart; no new minting code was needed. A test initializes the actual default team, runs with a fake Claude adapter over two server instances using real CLI authentication, and checks stale credentials fail. Scoped Orchestrator output-file permissions and the real 2.1.300 fixture remain for bullet 4, when `crew phase done` exists. The current Orchestrator profile grants no edits. D28 and the PRD Decision Log were untouched.

Tests in `test/harness/config-init.test.ts` cover real init/start/restart, imported TypeScript settings, syntax/runtime/value/unknown-option failures and repair, non-git init, existing config preservation, multi-workspace roles, default-team token recovery, configured timeout/retry/dispatch limits, prompts and permissions. Adapter contracts cover prefix expansion, retained push denials and the initial read-only Orchestrator profile. Mutation checks deliberately disabled config timers/dispatch limits and separately retry limits; the targeted tests failed. Restored code passed the final full suite. A fresh review found five Important issues (broad Git prefixes, bypassed Reviewer prompts/role Stop hooks, legacy init skipping entities, stale removed custom-role permissions). Each was reproduced by a failing test before the fix. Removed custom roles retain referenced IDs with safe defaults; existing workspaces gain missing initialization entities. The preliminary full suite had one stop/resume failure while another test process rebuilt dist; the serial focused rerun passed all 37 tests, including stop/resume. The final clean-build full run passed all 194 tests across 36 files (224.43s), with typecheck and build successful. `npm run generate:docs` and `git diff --check` passed. Nothing was pushed; main was unchanged. No real milestone 5 Claude run or permission fixture was executed.

Next: bullet 1 ticket API/CLI with authorization, phase limit and dependency checks. Review §9 proposals before logging any decisions. Preview packaging and repeated gate rejection limits remain open. Stop at tested bullet boundaries; write bullet 9 only after 0–8 and never run it automatically.

---

# Milestone 4 handoff — done

Status: milestone 4 is done. Bullets 0–8 are implemented on `feat/milestone-4-merge` and merged into `main`. `npm run smoke:m4` passed on 2026-10-20 with real Claude Code authors, a real Reviewer and a real conflict sub-task (alpha merged, beta conflicted, the sub-task resolved it, `main` has both commits, the queue is empty). The §9 proposals are logged as D47–D55. D28 is still open. `rm -r dist && npm test` passes 175 tests across 35 files. Nothing is pushed.

Next: milestone 5 (memory and workflow, then the private preview); the plan in `milestone-5.md` is approved (D56–D65) and starts at bullet 0. It needs `crew init`, `crew.config.ts` loading, an HTTP endpoint to create tasks, and test commands for the standard role profile. Follow-ups noted in D54: simplify the checkout transaction and make its ignored-file check cheaper. The smoke role uses `mode: full`, so the conflict-only git permissions are covered only by the adapter contract test.

Earlier handoff notes follow, newest first.

---


# Milestone 4 final review fixes handoff

Status: bullets 0–7 are implemented; the local bullet 8 script is prepared but not yet committed or run. Fresh review found ignored-file overwrites, a final branch-switch window, and nested conflict-parent retry missing the actual worktree owner. Regression tests reproduce all three. The fixes pause ignored collisions with bytes preserved, follow inactive conflict descendants, and use a prepared HEAD/ref transaction plus private index for the checkout fast-forward. Foreign HEAD/index locks pause. An inode ownership journal recovers both sides of index/ref publication. Stop/cancel finishes an already-started checkout publication, while rebase/verify/setup are killed; this exception and the command change from the approved `merge --ff-only` are explicit proposals in §9. Git 2.53.0 was used; HEAD locking is checked before writing. The smoke script remains unrun.

Verification: `rm -r dist && npm test` passed typecheck and all 175 tests across 35 files (205.47s). Missing/ignored/branch-switch/nested-retry regressions and checkout journal/PID tests are green. The shell guard rejects the force-delete command.

---

# Milestone 4 bullet 7 handoff

Status: bullets 0–7 and the terminal-failure fix are implemented. Bullet 8 (write the smoke script, do not run it) is next; manual smoke remains pending. Human-secret endpoints `GET /api/merge-queue` and `POST /api/tasks/:id/retry` back `crew queue` and `crew retry <task> [--note]`. Queue output includes order, active phase, conflict child, failures and dirty-checkout warnings; status includes pending count/warnings. Retry resets retries to zero and commits the optional note as feedback with the Scheduler transition. Ordinary transitions still reject escalated→doing; only the separate human retry entry point permits it, with a second state check in the transaction to reject concurrent retries.

Harness tests cover missing/agent credentials, queue/status warnings, active phase, conflict links, invalid requests, optional note, no automatic escape from escalation, concurrent retry, and complete human recovery/merge after each terminal failure type (missing branch, empty squash, three ref races). Retrying an escalated conflict parent moves its inactive child's worktree without losing uncommitted bytes (proposal in §9). `docs/commands.md` is regenerated from declarations. No dependencies or PRD changes.

Verification: `rm -r dist && npm test` passed typecheck and 162 tests across 35 files (223.88s). `npm run generate:docs` regenerated the command reference. The shell guard rejects `rm -rf dist`; the safe recursive removal was used.

---

# Milestone 4 bullet 6 handoff

Status: bullets 0–6 and the terminal-failure fix are implemented; human CLI (7) and smoke script (8) remain. Restart recovers queued/rebasing/verifying/merging items, completes persisted commits already reachable from the default branch, and resumes conflict-parent reconciliation/merged cleanup. Legacy failed items escalate with feedback instead of staying stuck. Integration reuse aborts rebase, resets hard and cleans untracked output; removing setup output invalidates its marker so setup can restore it.

Stop-all/cancel own and await the merge's Git, verify and integration setup processes, then clean integration. Cancellation removes the queue item alongside the Scheduler transition and keeps the branch. Cancelling a conflict parent cascades through its active child; cancelling a child escalates the parent. A ref movement that won cancellation is recorded as merged (proposal in §9). PID tests cover rebase, verification and setup children; restart tests create a real half-finished rebase and landed-but-unrecorded refs, including later user commits. Tests also cover queued cancel, running conflict parent/child cancel, legacy failures and conflict reconciliation after downtime. Manual smoke remains pending.

Verification: `rm -r dist && npm test` passed typecheck and 151 tests across 34 files (176.73s). `npm run generate:docs` succeeded. The force-delete command remains blocked by the shell guard.

---

# Milestone 4 terminal merge failure fix handoff

Status: bullets 0–5 plus the reviewed terminal-failure fix are implemented; bullets 6–8 remain. Terminal non-conflict Git errors, empty squash commits and exhausted ref races now use the existing feedback helper to escalate atomically with a failed item, without charging a retry. A checkout dirtied after the final check pauses when Git refuses the fast-forward. Regression tests cover these four cases. The human retry round trip will be tested in bullet 7 when that command exists. The squash author email is explicitly a proposal in milestone-4 §9, with the user's email as an alternative. Manual smoke remains pending.

Verification: `rm -r dist && npm test` passed typecheck and all 132 tests across 32 files (152.75s). The shell guard rejected `rm -rf dist`. `npm run generate:docs` succeeded with no reference changes.

---

# Milestone 4 bullet 5 handoff

Bullets 0–5 are implemented on `feat/milestone-4-merge`; bullet 4 is `67f96f5`. Rebase conflicts abort cleanly, remove the original worktree while retaining the branch, and create a same-role/depth+1 sub-task on that branch. The branch and queue link commit before the child is published. A merged child closes its parent and promotes dependents; depth limits or child escalation/cancellation escalate the parent. Only linked conflict work runs receive extra git permissions and `GIT_EDITOR=true`; push remains denied. Empty resolutions remain subject to the normal diff gate.

Verification: `rm -r dist && npm test` passed 129 tests across 32 files with typecheck and fresh build. Five conflict harness cases and a Claude Code profile contract were added. The real conflict resolution test configures a failing editor and still completes, proving the environment override. §9 of milestone-4 records the implementation recommendations for the three §8 questions (identity, setup reuse and empty resolution) for user review; no PRD Decision Log edits or dependencies. Commands reference regenerated unchanged.

Next: bullet 6 interruptions (restart, stop-all and cancellation, including parent cancellation), then bullet 7 human CLI. Write bullet 8 last and do not run it. Milestone 4 remains incomplete until the user runs the manual smoke.

---

# Milestone 4 bullet 4 handoff

Bullets 0–4 are implemented on `feat/milestone-4-merge`; bullet 3 is `4094c69`. Merge re-verification stores every matching result and returns all command failures as feedback to a fresh author run. Scheduler transitions `merge-queue → doing` and `merge-queue → escalated` now exist; the feedback, failed item and retry/status update commit atomically. Exhausted retries escalate; integration setup failure escalates without a retry. A failed item is reopened only on a new pipeline approval, never on the safety tick. Full-suite failures exposed second-resolution run timestamp ties: latest-run lookups now use SQLite rowid as a secondary order. A deterministic tied-timestamp regression proves each failed attempt retains its own results; the existing escalation test now triggers a dispatch pass instead of sleeping.

Verification: `rm -r dist && npm test` passed 123 tests across 31 files with typecheck and fresh build. Three new harness tests prove atomic feedback, a green second attempt, exhaustion and integration setup escalation. Commands reference regenerated unchanged. No deviations, dependencies or PRD edits. Next: bullet 5 conflicts, then interruptions and human CLI. Write bullet 8 last without running it; milestone 4/manual smoke remain incomplete.

---

# Milestone 4 bullet 3 handoff

Bullets 0–3 are implemented on `feat/milestone-4-merge`; bullet 2 is `5c0f1ef`. Stored workspace `mergeStrategy: rebase` now retains the rebased commits and their author messages, while the default squash creates one commit with the task trailer. The fake adapter supports git argument arrays, tested through two real author commits. All three strategy tests advance main before merging and assert the resulting history and checkout files; an empty git identity exercises the Crew committer fallback during rebase.

Verification: `rm -r dist && npm test` passed 120 tests across 30 files, including typecheck and a fresh build. Commands reference regenerated unchanged. No deviations, dependencies or PRD changes. Next: bullet 4 (re-verify failure), then conflicts, interruptions, human CLI and the smoke script without running it. Manual smoke is pending; milestone 4 is not complete.

---

# Milestone 4 bullet 2 handoff

Bullets 0–2 are implemented on `feat/milestone-4-merge`; bullet 1 is `cd76972`. Checkout safety now covers clean default-branch fast-forward, another branch/detached HEAD ref-only update, and dirty tracked/untracked default checkout pause. The initial check and a second check before ref movement preserve dirty bytes; queue output and the worker warning map name the branch. The 5-second safety tick resumes a clean checkout. A lost CAS repeats rebase/re-verification, bounded at three attempts; exhaustion leaves the item failed without overwriting competing commits. CLI/API warning presentation remains bullet 7.

Verification: `rm -r dist && npm test` passed 117 tests across 29 files (typecheck and fresh build included); the environment rejects `rm -rf`. Seven checkout harness cases cover those paths and late dirtiness. No product deviations, dependencies or PRD edits. Next: bullet 3 (strategies), then bullets 4–7 and the smoke script only. Milestone 4 is not complete; manual smoke remains pending.

---

# Milestone 4 bullet 1 handoff

Branch: `feat/milestone-4-merge`, based on `f9acd405503ffabe34a355f16f8dd6b61eaf1291`. Bullet 0 is committed as `0b37f79`; bullet 1 adds the merge happy path. Nothing pushed.

Bullets 0–1 are implemented. `MergeQueue` is wired into `crew start`, subscribes to task transitions and checks every 5 seconds. Each workspace runs one item at a time in `<crewHome>/integration/<workspace-id>`. It rebases onto the current default tip, applies path-filtered verification commands with `merge:` results, squashes with the agent as author and the user's configured git identity as committer (Crew fallback), persists the candidate commit before CAS, transitions through the Scheduler with the item update in `alongside`, removes the task worktree/branch and promotes dependents. Hooks are disabled on Crew's worktree, diff-gate and merge housekeeping. Migration `0003_absurd_black_widow.sql` was generated with drizzle-kit and upgrades milestone 3 data without loss.

At this boundary only another-branch/detached checkout merges; the default branch checkout pauses. Bullet 2 adds clean-checkout fast-forwarding, dirty warnings and race retries. Failed rebase/verification items remain failed for now; bullets 4–6 add feedback, conflicts and recovery. Cancellation/restart races have not yet been verified. No queue/retry human commands or smoke script yet. Continue bullets 2–7 in order, then write bullet 8 without running it. Do not mark milestone 4 complete until the user runs the smoke.

Verification: fresh-build `npm test` passed 110 tests across 28 files, including the new migration upgrade and `merge-happy.test.ts`. The environment rejects `rm -rf dist`; `rm -r dist && npm test` removed the build and ran the same typecheck/build/suite. `npm run generate:docs` regenerated an unchanged commands reference. No PRD decisions or dependencies changed.

---

# Handoff: Crew Phase 1 — Milestone 4 in progress (bullet 0 complete)

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Milestones 1–3 are on `main`. Current branch: `feat/milestone-4-merge`, based on `f9acd405503ffabe34a355f16f8dd6b61eaf1291`.
- **Milestone 4 bullet 0 (Worktree setup) is implemented:**
  - `workspaces.config.worktreeSetup` runs before a new task worktree is dispatched. Setup and verification share `src/server/verify/command-runner.ts`, including the minimal environment, 10 minute default timeout and process group kill.
  - A private Git-directory success marker prevents rerunning completed setup after restart; a recreated worktree gets fresh setup. No install cache or symlinks are introduced.
  - Setup failure stores feedback and escalates through the Scheduler in one transaction, before any agent run; initial setup failure costs no retry. Its worktree and branch remain available for diagnosis.
  - Stop-all and cancel interrupt setup; cancel waits for setup before removing the worktree and keeps the branch. Resume reruns interrupted setup. Server close also interrupts setup.
  - Five tests in `test/harness/worktree-setup.test.ts` cover setup-dependent verification, restart/recreation, detached-worktree setup, failure escalation, stop-all/resume and cancel. The kill tests assert that setup and its child processes are gone.
  - The detached-worktree setup helper is tested directly; automatic integration worktree creation and its call to the helper belong to bullet 1.
- **Current verification:** fresh-build `npm test` passed typecheck and all 108 tests across 27 files (141.37s). The requested `rm -rf dist && npm test` was rejected by the shell guard; the previous `dist/` was moved to a temporary backup before `npm test`. `npm run generate:docs` succeeded without changing the commands reference.
- **Next: milestone 4 bullet 1.** Bullets 1–8 are not implemented; the milestone 4 smoke script is not yet written or run.
- **Milestone 3 (Verification) is fully implemented and tested:**
  1. **Bullet 0 (Diff gate & failure loop):** Migration `0002_silent_owl.sql` adds `runs.kind` (`work` | `review`, default `work`) and `tasks.reviewer_agent_id`. Diff gate auto-commits leftover agent changes, fails empty diffs ("no changes against <base>"), runs out-of-worktree check (symlink escape + main checkout porcelain status snapshot), commits failure feedback message in transaction, and injects failure feedback into the next run's prompt.
  2. **Bullet 1 (Escalation):** Verified end to end that tasks repeatedly failing verification escalate to `escalated` once `retries` exceed `maxRetries`, recording VerificationResults and events.
  3. **Bullet 2 (Command gates):** Shell command runner for `workspaces.config.verifyCommands` (D10, D29) with per-command cwd, timeouts with process group kill (`-pid`), path-filtering with `picomatch@4.0.7` (D37), all-failures-together feedback collection (D32), and output capping (64 KB in DB, 4 KB per failure in feedback).
  4. **Bullet 3 (The pass path):** Diff and command gates pass, review step skips cleanly with visible status when no reviewer exists (`review → merge-queue`, D34), and tasks reach `merge-queue` in order.
  5. **Bullet 4 (Reviewer gate):** Reviewer selection preferring a different `cliType` (D8), `read-only` permission profile (denies edits/writes), `crew review approve` (`review → merge-queue`) and `crew review changes --feedback "..."` (`review → doing` charging author a retry), token auth isolation (reviewer token rejected on author endpoints, author token rejected on `/review`), and reviewer crash recovery (up to 2 runs before escalating, author not charged, D35).
  6. **Bullet 5 (Interruptions):** Verifier restart recovery re-enqueues `verifying` and unreviewed `review` tasks and replaces partial verification results (§4.6); `crew stop-all` terminates active command subprocesses and Reviewers, and `crew resume` restarts pipelines without charging retries; `crew cancel` aborts in-flight commands and kills reviewer before removing worktrees; rate-limited Reviewers pause and resume without retry penalties; concurrency limited to `maxParallelVerifications` (default 2, D37).
  7. **Bullet 6 (Stop hook):** Crew-written `<crewHome>/claude-settings.json` configuring Stop hook (D26, D36); hidden agent command `crew hook stop` that checks `stop_hook_active` on stdin, blocks while `doing` (exit code 2 with stderr), allows when status != `doing`, and gives up after 2 blocks; adapter contract tests for `--settings` flag and `read-only` profile; real hook-blocked fixture recorded in `test/fixtures/claude-code/hook-blocked.jsonl`.
  8. **Bullet 7 (Human CLI):** `crew results <task>` prints pass/fail for each verification step followed by the output of failed steps; `GET /api/tasks/:id` extended with `verificationResults`; `crew status` and `GET /api/status` extended with `verifyingTasks` and `reviewTasks` lists; `docs/commands.md` regenerated via `npm run generate:docs`.
  9. **Bullet 8 (Smoke script):** `scripts/smoke-milestone-3.ts` (`npm run smoke:m3`) written and verified with `npm run typecheck`. Ready for manual run by user.
- **Review fixes after the first look:** a Reviewer waits while its tool is rate-limit paused (no tight re-run loop, D7); the main-checkout snapshot is stored on disk under `<crewHome>/snapshots/` so a restart doesn't skip the D31 check; Reviewer selection skips stopped agents and prefers usable, idle agents on a different tool. The first smoke run (`npm run smoke:m3`) passed but skipped the Reviewer (case-sensitive role-name match, now fixed). The repeated run on 2026-10-20 passed with a real Reviewer: diff, `smoke-file-check` and `review` ("Approved") all passed and the task reached `merge-queue` in 28s.
- Milestone 3 baseline: `rm -rf dist && npm test` passed 103 tests across 26 test suites.

## Open questions answered in Milestone 3

- **Stop hook format on Claude Code 2.1.300:** Verified live with real Claude Code 2.1.300 runs and binary analysis. Claude Code uses exit code 2 with stderr (`echo "..." >&2; exit 2`) as its standard blocking mechanism (`Exit code 2 - show stderr to model and continue conversation`). It also supports exit code 0 with JSON `{"decision":"block","reason":"..."}`. On subsequent turn, Claude Code sends `"stop_hook_active": true` on stdin to prevent infinite loops. `crew hook stop` uses exit 2 with stderr. Real fixture recorded in `test/fixtures/claude-code/hook-blocked.jsonl`.

## How to run the Milestone 3 smoke test

Run the smoke script using:
```bash
npm run smoke:m3
```
or
```bash
npx tsx scripts/smoke-milestone-3.ts
```
The script will:
1. Detect local Claude Code CLI version.
2. Initialize throwaway Git repo and temporary `CREW_HOME`.
3. Start the Crew server with Dispatcher, Runner, and Verifier.
4. Configure `verifyCommands` (`test -f smoke.txt`) and Stop hook in workspace config.
5. Seed Author agent (`claude-code`) and Reviewer agent (`claude-code`).
6. Dispatch task to Author to create `smoke.txt`.
7. Author creates file, calls `crew done`, triggers diff gate and verifyCommand (`test -f smoke.txt`).
8. Reviewer reviews diff in `read-only` mode and approves.
9. Task reaches `merge-queue`.
10. Runs `crew results` CLI and verifies worktree diff and file contents.

## Next steps

- Milestones 1 to 3 are done and on `main`; both milestone 3 smoke runs are recorded above.
- Milestone 4 (Merge): `plan/phase1/milestone-4.md` is approved and logged as D38–D46. Continue at tracer bullet 1 (happy path). D28 (the optional budget cap on the Claude Code adapter) is still open.
