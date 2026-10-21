# Milestone 5 report

## Summary
No new dependency or migration was needed in this final session. Bullets 0–8 implement and test the workflow, sourced memory, human CLI and interruption paths; bullet 9 is a written, typechecked smoke script, **not run**. The built-server SIGKILL experiment exposes an old agent surviving and a duplicate Orchestrator starting after restart; no durable orphan infrastructure was added, as requested. Milestone 5 and the private preview remain incomplete pending the real smoke, review of §9 proposals and the hard-crash policy.

## Branch and commits
- Branch: feat/milestone-5-workflow (base: 4a3737ebbfd52649df0ab083dbfc09c4556fcc16).
- 6405147 feat(m5): bullet 0 - Config and init
- e6d9279 fix(m5): init config visibility and allowCommands patterns
- 2d56498 feat(m5): bullet 1 - Creating tickets
- efe0a4d feat(m5): bullet 2 - Memory store and human CLI
- b2c9883 feat(m5): bullet 3 - Memory injection
- 97a9a17 fix(m5): protect Reviewer diff and Q&A from prompt trimming
- b821b4d feat(m5): bullet 4 - Phase engine
- af5ac4d docs: add agent prompt and report location for milestone 5 bullet 5
- fb22548 docs(m5): bullet 5 report
- 424b79d feat(m5): bullet 5 - Grill, spec, tickets
- ec5c959 docs: add agent prompt for milestone 5 bullet 6 (parallel track A)
- 8b1d733 docs: add agent prompt for milestone 5 hardening, bullet 8 and early interruptions (parallel track B)
- 7d63cc5 fix(m5): deny agent reads of Crew home
- 28fff01 feat(m5): bullet 6 - Dispatch and integrate
- 2c848ad docs(m5): bullet 6 report
- f0959e0 feat(m5): bullet 8 - Human CLI polish
- 774dab8 test(m5): early-phase interruptions
- a2ae701 docs(m5): bullet 8 report
- a3378fb Merge track A: bullet 6 dispatch and integrate
- 90e4414 Merge track B: crew-home read deny, bullet 8, early interruptions
- 6bf8975 test(m5): align interruption expectations with zero-ticket dispatch
- b8ec370 docs: add agent prompt for milestone 5 final session
- 7f08023 fix(m5): narrow the Crew-home Read denial
- 3e4d680 test(m5): dispatch and integrate interruptions
- 5334092 feat(m5): bullet 9 - Smoke script
- 074c06d docs(m5): milestone 5 status and merged proposals
- HEAD docs(m5): final report (this containing commit; final hash in delivery message).

## Tracer bullets
| # | Bullet | Status (done/partial/skipped) | Tests added (file: test names) | Notes |
|---|--------|-------------------------------|--------------------------------|-------|
| 0 | Config and init | done | `config-init.test.ts`: initializes twice from a subdirectory; loads real TypeScript config on each CLI start; stops start for a config error and recovers; initialized default team authenticates after each restart; per-workspace permissions/limits | Previously accepted, full suite rerun |
| 1 | Creating tickets | done | `tickets.test.ts`: creates/assigns through real human CLI; rejects worker/missing credentials; counts quota per creation phase; blocker/cycle atomicity; live/cancelled/stale Orchestrator auth; assignment during setup. `db.test.ts`: milestone-4 upgrade | Previously accepted |
| 2 | Memory store and human CLI | done | `memory.test.ts`: curates three layers; role/workspace isolation; atomic explicit promotion/provenance; malformed-scope recovery; live integrate-only promotion | Previously accepted |
| 3 | Memory injection | done | `memory-injection.test.ts`: relevance/age trimming; protected overflow; role/task/workspace privacy; Reviewer context; fallback Q&A; capped diff; retained/omitted failure history | Previously accepted |
| 4 | Phase engine | done | `phases.test.ts`: edited/concurrent approval; rejection feedback; durable gate; failed phase human retry; timeout/process death; cancellation/late completion; one starting/live phase run; missing-team/init recovery; spawn/setup/preparation failures. `phase-transport.test.ts`, adapter phase-permission fixture | Previously accepted |
| 5 | Grill, spec, tickets | done | `early-workflow.test.ts`: grill Q&A (resume/fallback); edited/rejected spec publication; holds 0/1/20 tickets through rejection; bad-blocker/corrected-creation recovery; live-agent human-command boundaries | Previously accepted |
| 6 | Dispatch and integrate | done | `dispatch-integrate.test.ts`: full three-ticket gated journey with worker Q&A, real Git merges and fake Reviewer; empty/cancelled boards; last-escalated ticket retry/cancel; merge/cancel race; restart/draft; edited/concurrent final approval; rejected/ungated integrate; crash/hang/stop; staff repair | Previously accepted; final-session additions below |
| 7 | Interruptions | done (coverage; hard-crash gap documented) | `interruptions.test.ts`: integrate cancellation/replacement and full integrate auth matrix including foreign-workspace token. `dispatch-integrate.test.ts`: ended/different-board promotions; late tickets after dispatch; two-worker stop/resume. `server-sigkill.test.ts`: real OS server kill, duplicate observation and explicit cleanup/recovery | No production orphan fix; known unsafe hard-crash behavior is intentionally exposed |
| 8 | Human CLI polish | done | `cli-status.test.ts`: pending gate/exact approval, working retry hint, missing team, dispatch counts, combined filters, invalid filters/help and ambiguous names. `crew-home-permissions.test.ts`: narrowed sensitive-state denials and recorded real worktree Read | Merged track/reviewer work, rerun |
| 9 | Smoke run (script only) | done (script); real run pending | `scripts/smoke-milestone-5.ts`: `npm run typecheck` only; included in every clean suite's typecheck | Written and **not run** |

## Done criteria (milestone-5.md §1)
- [x] Init/config/default team: real-CLI `config-init.test.ts` cases.
- [x] Orchestrator tickets/assignment/quota: `tickets.test.ts` and gated 0/1/20-ticket cases.
- [x] Three memory layers, sources and explicit promotion: memory suite and full board journey.
- [x] Shared budgeted work/review/phase/fallback prompts: memory-injection suite asserts actual fake-adapter prompt text.
- [x] Grill → spec → tickets → dispatch → integrate → done, human gates, merged tasks and sourced outputs: headline dispatch-integrate test.
- [x] Ordinary phase failure/hang/cancel recovery without losing the board: phases/interruptions/dispatch-integrate suites, human retry/resume/approve and dead parent/child PIDs.
- [ ] Safe automatic recovery after abrupt server death: SIGKILL preserves an old agent and permits a duplicate; explicit process cleanup is tested, automatic safety is not implemented.
- [x] Status shows phase/pending gate/actionable recovery: cli-status tests.
- [ ] Real Claude grill-to-merge smoke: script written and **not run**; user runs it.
- [x] Architecture, onboarding and handoff updated to merged code; unapproved proposals live in §9. PRD Decision Log intentionally unchanged pending approval.

## Test results
- Command: rm -r dist && npm test
- Typecheck: ok (src, tests and scripts); clean build ok
- Tests: 309 passed, 0 failed, 0 skipped across 48 files

```text
 Test Files  48 passed (48)
      Tests  309 passed (309)
   Start at  10:28:38
   Duration  451.89s (tests 96%, import 4%)
```

Verification history, including failures:
- First focused run of dispatch-integrate, interruptions and server-SIGKILL: 35 passed, 1 failed across 3 files (90.23s). The new ended-promotion assertion expected 403, while the existing live-context validator returns 409 for an ended task. It now accepts either rejection status and still asserts no memory mutation and human recovery; no production code changed.
- A subsequent focused dispatch run: 13 passed, 2 failed (85.98s), in existing `recovers dispatch completion on restart and preserves an integrate draft over another restart` (CLI approval exit 1) and `does not publish a rejected integrate summary and publishes ungated integration once` (task did not reach merged). This run overlapped the clean full suite's removal/rebuild of dist, so it is not treated as valid verification. Serial clean full-suite results below supersede it; no accepted implementation was changed to accommodate it.
- Initial smoke typecheck found TS7022 on inferred `current`/`merge` locals; explicit schema-row annotations corrected it. No real smoke/Claude run occurred.
- Four clean full suites each passed typecheck/build and 309 tests across 48 files (0 failed, 0 skipped):
  - Suite 1: 505.70s (tests 96%, import 4%).
  - Suite 2: 448.86s (tests 96%, import 4%).
  - Suite 3: 427.75s (tests 96%, import 4%).
  - Suite 4: 451.89s (tests 96%, import 4%).
- Fresh own-diff and task-requirement reread completed. No mutation check was performed, and added tests are coverage of accepted behavior/observed crash risk rather than a claimed red-green production fix.

## No dead ends
- Config syntax/validation: start fails with a repair hint; fix crew.config.ts and rerun real `crew start` (`config-init` error/recovery cases).
- Invalid ticket/blocker/cycle/quota requests: draft/tickets remain; correct the create request, cancel invalid dependents or retry an escalated blocker, then approve retained tickets (`tickets`, `early-workflow`). Rejection retains rows/quota rather than deleting partial batches; the next planning run reuses them.
- Grill blocked for an answer: real human `crew answer` resumes or falls back to a fresh process with protected Q&A (`early-workflow`, `ask-resume`).
- Failed/hung/setup/spawn/preparation phase: board stays put with escalation/retry hint; repair underlying failure, `crew retry <phase-task>`, then approve (`phases`, integrate crash/hang recovery). Timeout and stop tests prove parent/child death.
- Cancelled integrate: task remains cancelled; concurrent real `crew retry` calls yield exactly one replacement linked to the old task. Replacement completes and human approval advances (`interruptions`: cancels a live integrate process tree).
- Stop-all in dispatch: both worker groups terminate; tasks retain retries=0. Human `crew resume` then normal pipeline/merge reaches exactly one integrate; final approval reaches done (new two-worker test).
- Last escalated work: status names retry/cancel; both real human commands are covered, and only merged/cancelled work completes dispatch (`dispatch-integrate`).
- Missing integrate staff: init then resume repairs it; completed dispatch remains durable (`dispatch-integrate` staff repair).
- Lost completion event/durable final gate: startup reconciliation creates one integrate; exact preserved draft can be approved with restarted server credentials (`dispatch-integrate`).
- Rejected integrate: no summary publication; revised run/approval (or configured ungated revision) publishes once. Explicit earlier promotions are not rolled back.
- Unauthorized phase/ticket/promotion attempt: no draft/task/memory mutation; authorized human stop/resume/approve, ticket cancellation or memory promotion moves the board forward (new and existing auth tests).
- SIGKILL orphan: new start leaves two runs; new server's stop-all kills only its own run. Explicitly terminate the verified old process group (`kill -TERM -- -<old-run-pid>`), then human resume receives a recovered draft; human stop-all and approve advance into spec. The test executes equivalent process-group signalling and real CLI commands. This is a manual workaround, not automatic orphan reconciliation.

## Races and failure windows tested
- Existing before this session: full-board dispatch/integrate flow, empty/cancelled completion, escalation retry/cancel, last merge versus cancellation, lost-event startup reconciliation, durable final draft restart, edited/concurrent approval, rejected/ungated publication, integrate crash/hang/stop, and staff repair (`dispatch-integrate`).
- Existing before this session: grill/spec/tickets live graceful restart, pending gates over database reconnection, stop/resume, cancel/replacement, escalation/retry and worker/missing-token auth (`interruptions`).
- Added: cancelled integrate parent/child PIDs gone; concurrent retry creates one replacement (`interruptions`).
- Added: all four phase endpoints with no token, worker token and other-workspace Orchestrator token during integrate; repeat approval denial against a real pending draft, then human approval. Foreign-workspace token coverage also applies to the three early phases (`interruptions`).
- Added: promotion after the integrate run ended, and reuse of that ended board context while the same Orchestrator has a different board's live run; both rejected and no promotion row until human command (`dispatch-integrate`).
- Added: ended tickets run cannot create tickets after approval moved the board to dispatch; retained ticket cancellation and final approval recover (`dispatch-integrate`).
- Added: stop-all with two running dispatch workers and grandchildren, then resume/merge; one integrate despite repeated concurrent reconciliation (`dispatch-integrate`).
- Added: real SIGKILL of a child process running built `crew start`, then a new real CLI start; orphan and duplicate observed, explicit cleanup and phase continuation tested (`server-sigkill`).
- Existing phase-engine tests cover stale approval while successor lives, concurrent starting-run uniqueness, cancelled-run late output, and stop-all preserving a submitted draft. Exact interruption inside the synchronous submission transaction, arbitrary crash at each instruction and actual Claude behavior after server SIGKILL are not tested. No exhaustiveness claim is made.

## Deviations and proposed decisions
- Both track reports' design proposals are merged/deduplicated in milestone-5.md §9 and marked **proposed, not approved**. The PRD Decision Log is unchanged.
- Integrate publishes combined project/release summary as an append-only sourced snapshot; live integrate lists workspace role memories; promotion is immediate and survives gate rejection.
- Ticket release and empty-dispatch completion use separate transactions, with atomic dispatch/integrate creation and init/resume recovery. Cancelled blockers retain existing semantics.
- CLI task filters run client-side over existing data, with AND, ID precedence and unique exact names; status includes registered roles and dispatch counts.
- Reviewer correction supersedes the track's whole-home denial: protect sensitive files/logs, leave worktrees readable; preserve the accepted 2.1.305 probe.
- Hard-killed agent survival/duplicate start is documented without infrastructure. Safe durable ownership/PID-reuse/startup reconciliation is larger than a few-line fix; user decides the follow-up/preview policy.
- Smoke launcher supplies the existing Claude budget flag because real CLI start builds its normal adapter; no new product config/adapter setting or D28 decision. See limits below. No prior production implementation was reworked in this session.

## Open questions answered
- Loader (§8): pinned jiti 2.7.0 already implemented; real config-reload/error/recovery coverage rerun.
- Orchestrator answering questions (§8): D65 routes worker questions to the human; headline board test uses real `crew answer` and checks the resumed prompt. No daemon Orchestrator.
- Orchestrator output file and permission flags (§8): accepted exact absolute Edit rule, dontAsk and isolated phase settings; recorded 2.1.300 phase-output fixture proves allowed output edit, denial elsewhere and real phase-done transport. The recording receiver is not the engine. Reviewer-provided 2.1.305 Crew-home fixture proves secret Read denial and worktree Read. Both contract suites rerun; no new real permission probe was run.
- Agent tokens after restart (§8): accepted lazy minting rotates the hash in a fresh Runner; old token rejected in existing default-team test. Hard-crash experiment exposes process ownership risk separately.
- Preview packaging (§8): still open (npm tag, tarball or git URL/quick start).
- Rejecting a gate repeatedly (§8): still open; no product rejection limit. Smoke exercises one deliberate rejection.
- D28: still open and unchanged; smoke-only cap does not decide product budget configuration.

## Schema, API and CLI changes
- Migrations across milestone 5: generated `0004_clever_red_hulk.sql` adds task kind/creation phase; `0005_concerned_bloodstrike.sql` links outputs to tasks and constrains duplicate outputs/active phase tasks. Existing data upgrade coverage rerun. None added/edited in final session.
- Endpoints across milestone: human/live-Orchestrator POST /api/tasks and /api/tasks/:id/assign; scoped human/agent GET/POST /api/memory, PATCH /api/memory/:id (human edits or human/live-integrate promotion), human DELETE /api/memory/:id; live-assigned-Orchestrator POST /api/tasks/:id/phase and /phase-done; human GET /api/boards/:id/phase and POST /api/boards/:id/phase/approve. Human status adds phase/gate/problem/ticket counts and roles. No new endpoint in final session.
- CLI across milestone: init; ticket create; assign; remember; memory list/add/edit/delete/promote; phase and phase done; approve with board/draft/edit/reject/note; phase-aware status; combined tasks status/role/board/assignee filters. Final session adds only npm smoke:m5. Generated command reference remains declaration-derived and unchanged by final session.
- State machine: doing → merged only for phase tasks; cancelled phase retry creates a replacement, preserving cancellation. Board dispatch → integrate reconciles once; integrate approval → done. No new transition in final session.

## Docs updated
- milestone-5.md: merged status, deduplicated unapproved proposals, SIGKILL evidence/workaround and smoke limits.
- handoff.md and START_HERE.md: current state, next steps, manual smoke pending and hard-crash limitation.
- project-structure.md: current scope, smoke script, real child-server test ownership.
- project-techstack.md: remove stale scoped-permission deferral; smoke tooling/caps and hard-crash boundary.
- reports/m5-final.md: this final review artifact.
- All AGENTS.md doc rows checked against final diff. No CLI declaration change requiring new generated content; docs/commands.md staleness tested. No new dependency/tool/version/platform/adapter implementation or folder. README contains no status or doc table to update. PRD intentionally unchanged for user-approved D66+ logging later.

## Smoke script
`scripts/smoke-milestone-5.ts`, `npm run smoke:m5`: **written and not run**, checked only with tsc via npm run typecheck/npm test. It builds, creates clean main in a throwaway /tmp repo, separate Crew home, trivial content verifier, real CLI init/start and real Claude default team; all human mutations use the real CLI. A launcher derives Claude's $0.50/run flags through the existing ClaudeCodeAdapter maxBudgetUsd option and forwards them and atomically reserves slots across concurrent workers. It answers grill, rejects one tickets gate with a note, then approves revised/existing tickets and all other gates.

Assertions: every phase reached in order; exactly three work tickets and one dependency; both workers ran; real lowercase Reviewer verdict for each with no skipped review; all tickets merged and their persisted commits/trailers are in main; final file bytes and three post-fixture commits; sourced spec and integrate summary plus promoted role-source linkage; each phase has a completed real Orchestrator run; structured tool input rejects human-only Orchestrator commands; permission_denials and linked Read tool errors reject own-worktree denial; board done, clean main, and no live recorded agent PID/process group after human stop-all. It prints final git log, crew status and crew memory list and retains artifacts. These assertions were read/typechecked, not validated against a live smoke run.

Cap: 4 phases + 1 grill resume + 3 workers + 3 reviews = 11 expected. Add 1 gate rejection, 3 author retries, their 3 additional review rounds, 6 Reviewer retries, 5 phase retries (including rejected tickets replacement) and 1 extra grill resume = **30 runs**. maxRetries=1 bounds automatic author/phase retries. Escalation fails instead of resetting limits via human retry. Expected $1–$6 for 11–12 small runs; per-run caps total at most $15, deadline 20 minutes plus bounded cleanup. Actual billed cost/runtime are unverified.

## Known issues, TODOs and unverified things
- Real milestone 5 smoke **not run**. Actual agent plan compliance, sufficient $0.50 phase budget, first-run permissions and final smoke assertion behavior remain unverified. Expected risks: compound Bash commands denied; Orchestrator tries a human-only command; ticket duplication on rejection; phase output budget. Failures retain repo/home/logs for diagnosis.
- Server SIGKILL leaves a detached old agent alive; new start permits duplicate execution and stale unfinished run rows. Manual explicit cleanup is tested, durable fix deliberately deferred for user decision. Old real-Claude behavior is not inferred from the local executable stub.
- Read-deny fixtures demonstrate bounded probes, not an OS sandbox or a complete real-agent workflow. Bash/other access paths and deliberate environment-clearing remain outside the command/Read defence.
- Smoke log checks cover observable structured Bash calls, permission_denials and linked Read tool errors; they cannot prove absence of arbitrary obfuscated shell behavior or actions omitted by a tool's logs. Missing tool evidence fails the script. Transient rate-limit loops are bounded by deadline/run cap rather than asserted away.
- Integrate summary is unstructured and human reviewed; snapshots append. Immediate promotions are not gate transactions. Cancelled blockers do not unblock dependents.
- Preview packaging, repeated rejection policy, hard-crash policy and D28 remain open. §9 implementation proposals are not approved decisions.
- No mutation check, paid agent call, macOS/WSL run, preview packaging installation or arbitrary in-request crash injection was performed in this session.

## git diff --stat main...HEAD
Final HEAD includes this report. Its containing commit is denoted HEAD above to avoid a self-referential hash. Output verified against the committed tree:

```text
 docs/architecture/project-structure.md             |   39 +-
 docs/architecture/project-techstack.md             |   11 +-
 docs/commands.md                                   |   72 +-
 drizzle/0004_clever_red_hulk.sql                   |    2 +
 drizzle/0005_concerned_bloodstrike.sql             |    3 +
 drizzle/meta/0004_snapshot.json                    | 1132 +++++++++++++++++++
 drizzle/meta/0005_snapshot.json                    | 1170 ++++++++++++++++++++
 drizzle/meta/_journal.json                         |   14 +
 package-lock.json                                  |   10 +
 package.json                                       |    4 +-
 plan/phase1/START_HERE.md                          |    8 +-
 plan/phase1/agent-prompts/m5-bullet-5.md           |  168 +++
 plan/phase1/agent-prompts/m5-bullet-6.md           |   45 +
 plan/phase1/agent-prompts/m5-bullet-8.md           |   48 +
 plan/phase1/agent-prompts/m5-final.md              |   51 +
 plan/phase1/handoff.md                             |  104 ++
 plan/phase1/milestone-5.md                         |   64 +-
 plan/phase1/reports/README.md                      |    3 +
 plan/phase1/reports/m5-bullet-6.md                 |  130 +++
 plan/phase1/reports/m5-bullet-8.md                 |  164 +++
 plan/phase1/reports/m5-final.md                    |  235 ++++
 plan/phase1/reports/milestone-5-bullet-5.md        |  265 +++++
 scripts/smoke-milestone-5.ts                       |  275 +++++
 src/adapters/claude-code.ts                        |   18 +-
 src/adapters/fake.ts                               |    5 +-
 src/adapters/types.ts                              |    4 +-
 src/cli/client.ts                                  |   18 +
 src/cli/commands/approve.ts                        |   11 +
 src/cli/commands/init.ts                           |   52 +
 src/cli/commands/memory.ts                         |   36 +
 src/cli/commands/phase.ts                          |    8 +
 src/cli/commands/start.ts                          |    7 +-
 src/cli/commands/status.ts                         |   19 +
 src/cli/commands/tasks.ts                          |   47 +-
 src/cli/commands/ticket.ts                         |   16 +
 src/cli/declarations.ts                            |   82 +-
 src/cli/index.ts                                   |    4 +
 src/roles/index.ts                                 |   15 +
 src/server/api/app.ts                              |  144 ++-
 src/server/db/schema.ts                            |    7 +-
 src/server/index.ts                                |   13 +-
 src/server/memory/index.ts                         |   66 ++
 src/server/memory/prompt.ts                        |  124 +++
 src/server/merge/index.ts                          |    6 +-
 src/server/project-config.ts                       |  168 +++
 src/server/runner/index.ts                         |  158 +--
 src/server/scheduler/dispatcher.ts                 |   16 +-
 src/server/scheduler/index.ts                      |   41 +-
 src/server/scheduler/tickets.ts                    |   98 ++
 src/server/verify/index.ts                         |   41 +-
 src/server/workflow/index.ts                       |  153 +++
 src/server/workflow/phases.ts                      |    8 +
 src/server/worktree/index.ts                       |   11 +-
 test/adapters/claude-code.test.ts                  |   31 +
 test/adapters/crew-home-permissions.test.ts        |   45 +
 test/adapters/phase-permissions.test.ts            |   24 +
 test/db.test.ts                                    |   79 +-
 .../claude-code/crew-home-read-dontask.json        |   86 ++
 .../fixtures/claude-code/phase-output-dontask.json |  138 +++
 test/harness/agent-commands.test.ts                |    2 +-
 test/harness/cli-status.test.ts                    |  100 ++
 test/harness/config-init.test.ts                   |  266 +++++
 test/harness/dispatch-integrate.test.ts            |  308 ++++++
 test/harness/early-workflow.test.ts                |  176 +++
 test/harness/interruptions.test.ts                 |  157 +++
 test/harness/memory-injection.test.ts              |  179 +++
 test/harness/memory.test.ts                        |   96 ++
 test/harness/merge-checkout.test.ts                |   27 +
 test/harness/phase-transport.test.ts               |   22 +
 test/harness/phases.test.ts                        |  261 +++++
 test/harness/server-sigkill.test.ts                |   96 ++
 test/harness/tickets.test.ts                       |  140 +++
 72 files changed, 7408 insertions(+), 238 deletions(-)
```
