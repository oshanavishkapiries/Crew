# Milestone 5 report

## Summary
Bullet 6 connects dispatch to integrate and completes boards through the real pipeline. Dispatch creates one integrate task atomically with the board move after all work is merged or cancelled, including empty boards; escalation stays actionable. Integrate can inspect and promote role learnings and publishes the approved project/release summary as sourced project memory. Bullets 7–9 and the real smoke remain outside this track.

## Branch and commits
- Branch: `feat/m5-dispatch-integrate` (base: `424b79d2737c5adce3ae8d03a25c2973e1712432`, previously accepted bullets 0–5).
- `ec5c959e960dcc236ad5ef58e11a5fcbce7ba0a6` — supplied bullet 6 task prompt.
- `28fff01102c031b29f773089f3842da6da1f5fda` — `feat(m5): bullet 6 - Dispatch and integrate`.
- `HEAD` — `docs(m5): bullet 6 report` (this report; its final hash is supplied in the delivery message).

## Tracer bullets
| # | Bullet | Status (done/partial/skipped) | Tests added (file: test names) | Notes |
|---|--------|-------------------------------|--------------------------------|-------|
| 0 | Config and init | done — previously done | Existing config/init coverage rerun | No implementation changes |
| 1 | Creating tickets | done — previously done | Existing ticket coverage rerun | No implementation changes |
| 2 | Memory store and human CLI | done — previously done | Existing memory coverage rerun | Integrate-only role-list access completed in bullet 6 |
| 3 | Memory injection | done — previously done | Existing injection coverage rerun | No implementation changes |
| 4 | Phase engine | done — previously done | Existing phases coverage rerun | Existing phase recovery reused |
| 5 | Grill, spec, tickets | done — previously done | Existing early-workflow coverage rerun | Empty-board expectation updated for bullet 6 |
| 6 | Dispatch and integrate | done | `test/harness/dispatch-integrate.test.ts`: 12 cases covering full journey, zero/cancelled boards, retry/cancel escalation recovery, merge/cancel race, two server reconstructions, edited/concurrent final approval, rejected/ungated integrate, crash/hang/stop-all recovery and missing-staff repair | Real Dispatcher/Runner/fake adapter and CLI; real Git merges and Reviewer approvals |
| 7 | Interruptions | skipped — not this track | Requested bullet 6 windows covered below | Exhaustive interruption work remains after tracks merge |
| 8 | Human CLI polish | skipped — not this track | No owned CLI/adapters files edited | Other track owns status rendering and polish |
| 9 | Smoke run (script only) | skipped — not this track | None | Neither written nor run |

## Done criteria (milestone-5.md §1)
- [x] Init/config/default team: previously accepted coverage rerun by the full suite.
- [x] Orchestrator ticket creation/assignment/quota: previously accepted coverage rerun; headline creates three tickets through the live Orchestrator CLI.
- [x] Memory writes, sources and explicit promotion: existing suite plus headline live integrate list/promotion and project-summary source assertion.
- [x] Shared prompt budget: existing injection suite rerun; resumed worker log contains the real human answer.
- [x] Grill → spec → tickets → dispatch → integrate → done: headline test, all gates via real human CLI, three reviewed tickets on local default branch, approved spec and project summary in memory.
- [x] Failed/hung phase recovery without losing the board: integrate crash/hang `crew retry`, stop-all/resume and durable final draft tested here; existing phase tests cover earlier phases.
- [ ] Final `crew status` phase/problem presentation: existing phase/gate output remains; this track verifies `Workflow.snapshot().problem` and status API propagation. Rendering belongs to the other track.
- [ ] Manual real-Claude smoke: not this track and not run.
- [ ] All milestone docs and handoff reflect the merged milestone: architecture lines updated here; shared status/plan/handoff updates reserved for the reviewer by the task prompt.

## Test results
- Command: `rm -r dist && npm test`
- Typecheck: ok (src and tests); fresh build ok
- Tests: 269 passed, 0 failed, 0 skipped across 44 files

```text
 Test Files  44 passed (44)
      Tests  269 passed (269)
   Start at  02:04:12
   Duration  550.20s (tests 94%, import 5%)
```

Exploratory results, retained rather than hidden:
- Initial focused dispatch/integrate run: 9 passed, 1 failed. Restart reused a WorktreeManager paused by shutdown, leaving a ready integrate task undispatched. The test now reconstructs WorktreeManager, Scheduler, Runner, Dispatcher and server before dispatching, matching a new server runtime.
- Next focused run: 11 passed (52.97s).
- Combined early-workflow/dispatch-integrate run: 20 passed, 1 failed (117.27s). The prior empty-ticket assertion expected dispatch; the required new behavior is integrate. Only the stale expectation was changed.
- A subsequent clean full run found the second stale zero-ticket fixture: `phases.test.ts` reported 24 tests with 1 failure in its ungated tickets case (53.735s). That fixture now has one held ticket, preserving its dispatch assertion. The run was stopped after this failure to apply the fixture correction; no complete-suite totals are claimed for that attempt.
- An earlier clean full run was deliberately terminated during fresh diff review to strengthen the memory-list assertion and explicit hung-PID assertions. It produced no final test summary; the clean run reported above supersedes it.
- No mutation checks or real Claude runs were performed. A fresh reread of all owned code, tests and documentation completed before this report.

## No dead ends
- Previously accepted paths rerun: `config-init.test.ts` — `stops start for a %s config error and recovers after the file is fixed` proves fixing crew.config.ts then rerunning `crew start`; `early-workflow.test.ts` proves rejected specs/ticket plans recover through revised output and `crew approve`, and invalid blockers through human `crew cancel` then approval. These paths were not reimplemented in this track.
- Last work ticket escalated: board stays in dispatch, snapshot/status API names the ticket and `crew retry <ticket>` / `crew cancel <ticket>`. `keeps the last escalated ticket actionable and recovers through human %s` proves both routes; retry goes through verification and a real Git merge before integrate.
- Integrate crashes or times out: task escalates in integrate; `crew retry <phase-task>` restarts it and real human approval reaches done. `recovers integrate %s with the human command and kills hung children` covers crash and hang, including parent/child PID death for a hang.
- Stop-all during integrate: task remains doing, retries remain zero, processes die; `crew resume` restarts it and approval finishes the board. Same parameterized recovery test.
- Rejected integrate summary: `crew approve --reject --note ...` creates a replacement integrate task; the rejected text is absent from project memory. `does not publish a rejected integrate summary and publishes ungated integration once` completes the revision through ungated approval.
- Missing staffed Orchestrator after ticket approval: board stays dispatch, no partial integrate task exists, and snapshot says `crew init`, then `crew resume`. `keeps completed dispatch intact without staff and recovers with human init then resume` executes both commands and creates one integrate task. Ticket approval itself is durable, so reapproving that stale draft is unnecessary.
- Engine misses last merge while stopped: restart/startup reconciliation creates one integrate task. Existing `crew resume` also invokes ensureBoard. `recovers dispatch completion on restart and preserves an integrate draft over another restart` then approves the preserved final draft with the new server's human credentials.

## Races and failure windows tested
- Last merge/cancel overlap: `creates integrate once when a last merge races human cancellation` pauses real merge before ref publication while the human cancels another ticket; one integrate task results.
- Repeated completion checks: zero/cancelled-board cases call ensureBoard concurrently and retain one integrate task.
- Concurrent integrate approvals: headline issues two real CLI approvals with edited text; one succeeds, one final phase event fires, and one sourced summary entry exists.
- Stop-all during live integrate: recovery test proves parent and child termination, no retry charge, then real human resume/approval.
- Last ticket already merged before integrate creation: restart test stops Workflow events before the actual worker merge, then reconstructs runtime objects and reconciles dispatch once.
- Restart with an integrate draft: same test reconstructs runtime again and approves the same durable draft.
- Integrate crash/hang: recovery tests execute real fake-adapter exit/hang runs and human retry.
- Missing staff during dispatch completion: recovery test proves no integrate task is partially created and init/resume repairs the team.
- Approve while successor starts, cancel after phase submission, late cancelled-run writes, hard-killed OS server with a surviving agent, and exhaustive cross-request orderings: not newly tested here; bullet 7 owns the remaining interruptions. Earlier phase tests are rerun without claiming exhaustive coverage.

## Deviations and proposed decisions
- Store the combined project-summary rewrite and release summary from the approved integrate output as one project memory entry titled `Project summary`, with source `phase:integrate:<draft-id>`. The output has no new structured format or checkout-file edits. Approval/edit, memory insertion and board done commit atomically; rejection does not publish it. This appends a sourced snapshot rather than deleting older project memories.
- A live integrate Orchestrator may list all role learnings in its own workspace with the existing `crew memory list`; ordinary runs and ended integrate runs retain role isolation. This supplies the review step required by D63/story 103 without changing prompt isolation or the CLI. The headline asserts the worker entry appears in the live list and disappears from role-list access after the run ends.
- Promotions remain explicit immediate memory operations. Rejecting the integrate output does not undo promotions already requested by the Orchestrator. No gate-wide rollback infrastructure was added.
- Ticket approval/release and empty-dispatch completion are separate commits to the database. The dispatch → integrate board move and integrate task creation themselves share the Scheduler create transaction. If staffing fails between these steps, the durable dispatch snapshot supplies init/resume recovery; the test executes it.
- A crash after committed terminal work but before its event is handled is recovered by startup reconciliation or human resume. No extra timer, lock service or migration was added. The deterministic restart test covers that lost-event boundary; an OS hard-kill experiment remains unverified.
- Cancelled blockers still do not satisfy dependencies. A dependent ticket may need human cancellation (or completion of a retried escalated blocker) before all work is merged/cancelled. Existing task state-machine semantics are unchanged.
- Prior-bullet implementation was not reworked. Two earlier test fixtures were aligned with the required empty-board behavior after failures demonstrated the mismatch: early-workflow expects immediate integrate for zero tickets, and the ungated phase test now supplies one held ticket to keep testing dispatch without an Orchestrator.

## Open questions answered
- Loader (§8): existing pinned jiti loader unchanged; accepted coverage rerun.
- Orchestrator answering questions (§8): dispatch has no Orchestrator task. Headline real worker `crew ask` is answered by real human `crew answer`, and the resumed run log contains the answer.
- Orchestrator output file and permission flags (§8): existing exact Edit rule and recorded `test/fixtures/claude-code/phase-output-dontask.json` unchanged; adapter fixture tests rerun. No new real permission probe or claim about newly executed Claude behavior.
- Agent tokens after restart (§8): existing lazy minting unchanged. The restart test constructs a fresh Runner and finishes integrate through authenticated CLI calls. No token persistence was added.
- Preview packaging (§8): still open; not this track.
- Rejecting a gate repeatedly (§8): existing unlimited rejection policy unchanged; only one integrate rejection tested here.

## Schema, API and CLI changes
- Migrations: none. Dependencies: none.
- Endpoints: no new endpoints. Existing human status API exposes the produced dispatch problem; existing authenticated memory GET gains workspace-scoped role-learning inspection only for a live integrate Orchestrator. Existing phase approval publishes integrate summary memory atomically with done.
- CLI commands and flags: none. No status/declaration/generated-command/adapter files edited.
- State machine transitions added: none. Workflow board transition dispatch → integrate now reconciles automatically on work-status events, ticket-gate completion and startup; integrate → done reuses the existing gate path.

## Docs updated
- `docs/architecture/project-structure.md`: only workflow ownership and new test/API behavior lines updated.
- `plan/phase1/reports/m5-bullet-6.md`: this full report.
- Shared `handoff.md`, `START_HERE.md`, `milestone-5.md`, PRD Decision Log and README deliberately unchanged per parallel-track instructions. The reviewer owns their merged status update. No command declarations changed, so generated command reference remains unchanged and its staleness check runs in the suite. No new dependency/platform/adapter changes require tech-stack edits.

## Smoke script
Not this track. No milestone 5 script or npm entry was added or run; run-cap arithmetic and real-agent cost remain for bullet 9 after both tracks merge.

## Known issues, TODOs and unverified things
- Bullets 7–9 are not completed by this track; the milestone/private preview is not marked done.
- The headline uses two staffed worker roles with dispatch capacity one for deterministic script selection. It proves assignment, not new parallel-execution behavior; existing Dispatcher tests cover concurrency.
- Restart coverage reconstructs all server runtime objects against the existing SQLite connection in the harness. It is not an OS process kill or database reconnection test.
- Integrate output quality is reviewed by the human; no parser checks that a free-text output contains separate summary/release sections.
- Summary entries append; prior memories are not automatically compacted or deleted.
- Remaining narrow windows and immediate promotion behavior are listed above rather than adding infrastructure.

## git diff --stat feat/milestone-5-workflow...HEAD
The following is the real command output at final HEAD, including this report. `HEAD` in the commit list denotes this self-referencing report commit.

```text
 docs/architecture/project-structure.md   |   4 +-
 plan/phase1/agent-prompts/m5-bullet-6.md |  45 ++++++
 plan/phase1/reports/m5-bullet-6.md       | 130 +++++++++++++++++
 src/server/api/app.ts                    |  10 +-
 src/server/workflow/index.ts             |  30 +++-
 src/server/workflow/phases.ts            |   2 +-
 test/harness/dispatch-integrate.test.ts  | 239 +++++++++++++++++++++++++++++++
 test/harness/early-workflow.test.ts      |   2 +-
 test/harness/phases.test.ts              |   2 +
 9 files changed, 453 insertions(+), 11 deletions(-)
```
