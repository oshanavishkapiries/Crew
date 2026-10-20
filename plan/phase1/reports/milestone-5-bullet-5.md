# Milestone 5 report

## Summary

Bullet 5 implements grill Q&A through real Orchestrator execution, approved spec publication with provenance, and ticket release only after gate approval. The clean-build suite passed 257 tests across 43 files, and the final strengthened early-workflow rerun passed nine cases. Bullets 6 to 9 are not started; milestone 5 is incomplete. Implementation, tests and existing documentation edits remain uncommitted; this separate report commit and push publish the report only.

## Branch and commits

- Branch: feat/milestone-5-workflow (base: 4a3737ebbfd52649df0ab083dbfc09c4556fcc16)
- 6405147 bullet 0 - Config and init
- e6d9279 init config visibility and command-pattern correction
- 2d56498 bullet 1 - Creating tickets
- efe0a4d bullet 2 - Memory store and human CLI
- b2c9883 bullet 3 - Memory injection
- 97a9a17 Reviewer diff and Q&A protection correction
- b821b4d bullet 4 - Phase engine
- af5ac4d session prompt and report-directory instructions
- Bullet 5 implementation: uncommitted working-tree changes.
- This report: its own commit, message `docs(m5): bullet 5 report`.

The initial push was rejected because the remote branch had advanced. Fetched the remote documentation commit, rebased the report with automatic preservation/restoration of tracked working-tree changes, and retried a normal push. No force-push or main-branch modification.

## Tracer bullets

| # | Bullet | Status (done/partial/skipped) | Tests added (file: test names) | Notes |
|---|--------|-------------------------------|--------------------------------|-------|
| 0 | Config and init | done | Previously: config-init.test.ts: initializes twice; loads real TypeScript config on each CLI start; initialized default team authenticates after restart | Previously reviewed; unchanged this session. |
| 1 | Creating tickets | done | Previously: tickets.test.ts: rejects worker and missing credentials; quota per board and phase; blocker and cycle checks atomic | Existing creation and assignment retained. |
| 2 | Memory store and human CLI | done | Previously: memory.test.ts: curates all three layers; promotes explicitly and atomically; live integrate Orchestrator promotion | Existing authorization retained. |
| 3 | Memory injection | done | Previously: memory-injection.test.ts: relevance/age trimming; protected overflow; role isolation; low-overlap Q&A fallback protection | Shared prompt builder retained. |
| 4 | Phase engine | done | Previously: phases.test.ts: concurrent edited approval; rejection feedback; durable restart gate; recovery through retry | One test-proven human-authentication bug fixed this session. Scoped Edit fixture unchanged. |
| 5 | Grill, spec, tickets | done | early-workflow.test.ts: nine cases listed below | Implemented and verified in working tree; not committed with this report. |
| 6 | Dispatch and integrate | skipped | None this session | Not started. |
| 7 | Interruptions | skipped | None this session | Not started. |
| 8 | Human CLI polish | skipped | None this session | Not started. |
| 9 | Smoke run (script only) | skipped | None | Not started; no script written or run. |

### Grill

Real Orchestrator phase tasks run through the Dispatcher, Runner, fake adapter and real CLI. The fake Orchestrator asks the human through `crew ask`; the human responds through `crew answer`. Tests cover session resume and refused-session fresh-process fallback. Assertions inspect the prompts emitted by the fake adapter to prove the answer reaches both the next grill run and the following spec phase. Tests do not seed live Orchestrator execution contexts.

### Spec

Spec approval stores the actual approved text, including human edits, in project memory. The visible source is `phase:spec:<draft-id>`. Publication, draft approval and successor creation share a transaction. Rejection stores no spec memory. Repeated stale approval does not create a duplicate memory entry. Ungated spec completion uses the same publication path. The next tickets run receives the edited spec.

### Tickets

Tickets created in the tickets phase stay `todo` until approval, including tickets without blockers. Scheduler creation, explicit ready transitions and dependent promotion respect the hold.

Approval validates active work-ticket dependencies, approves the draft, advances the board to dispatch and releases dependency-ready tickets atomically. Events are published after commit. A zero-ticket plan is valid; automatic completion of an empty dispatch phase remains bullet 6.

Rejection starts a fresh planning task while retaining existing tickets and their quota usage. No worker is dispatched before approval. Ticket instructions require ticket IDs in the summary so a rejected plan can reuse existing tickets. The Orchestrator asks the human to inspect or cancel tickets through the existing CLI.

## Done criteria (milestone-5.md §1)

- [x] Init, config and default team: previously reviewed config-init harness coverage; existing tests included in the passing full suite.
- [x] Authorized ticket creation and limits: prior tickets suite plus live-agent and human overflow in early-workflow.test.ts.
- [x] Scoped memory writes and explicit promotion with provenance: prior memory suite; approved-spec publication added now.
- [x] Shared budgeted prompts: prior memory-injection suite plus actual emitted Q&A/spec prompts in this session.
- [ ] One board through grill to integrate with merged tickets: early phases covered; complete lifecycle remains bullet 6.
- [x] Basic failed, hung and cancelled phase recovery: existing phases suite, including human retry. Exhaustive interruption windows remain bullet 7.
- [x] Status displays phase and gate: existing phases suite; CLI polish remains bullet 8.
- [ ] Manual real-Claude grill-to-merge smoke: not written or run.
- [x] Documentation matches the implemented slice: onboarding, architecture status, milestone plan §9 and handoff updated in the working tree.

## Test results

- Command: `rm -r dist && npm test`
- Typecheck: OK.
- Tests: 257 passed, 0 failed, 0 skipped.
- Exact final summary:

```text
 Test Files  43 passed (43)
      Tests  257 passed (257)
   Start at  21:02:24
   Duration  494.02s (tests 94%, import 6%)
```

Final strengthened-file rerun: `npx vitest run test/harness/early-workflow.test.ts`.

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  21:10:46
   Duration  61.98s (tests 99%, import 1%)
```

Final `npm run typecheck` and `git diff --check` passed. Commands documentation regenerated unchanged.

New test names, all in `test/harness/early-workflow.test.ts`:

- `grills through crew ask and protects the answer through next runs (fallback=%s)`: two cases.
- `holds %s tickets through rejection and releases only at approval`: three cases, 0/1/20.
- `keeps a bad-blocker draft intact and recovers with human cancel then approve`.
- `denies human approval, memory deletion and out-of-integrate promotion in a live Orchestrator`.
- `rejects a bad creation without losing the plan and lets the human create a corrected dependency before approval`.
- `publishes an ungated spec once with provenance before starting tickets`.

A live fake Orchestrator successfully ran `crew approve` against another board's real pending gate before the fix. The CLI loaded human authentication from its local server information file despite running in an agent environment. The regression asserted that the gate remained a draft and failed because it had been approved.

Human CLI authentication now rejects an agent environment before loading human authentication. The regression passes with the gate unchanged. Live Orchestrator tests also prove that `crew memory delete` and memory promotion outside integrate are denied and leave the memory entry unchanged.

This is command/protocol isolation. It is not an operating-system sandbox against a same-user process deliberately removing its agent environment and reading local authentication material.

This was the only implementation correction to bullets 0 to 4. No scoped-permission fixture, permission mode or D28 change was made.

Initial failures were not hidden: the valid-gate approval regression failed before the fix; other new coverage is not claimed as red-first. Early test runs used an unstaffed role and too short a wait for 20 real CLI creations; corrected to the staffed backend role and a bounded longer wait. An overlapping clean rebuild invalidated an earlier focused run. Successful clean full-suite and final focused evidence is pasted above. No mutation check was performed.

## No dead ends

| Failure or rejection | Human command that moves it forward | Evidence |
| --- | --- | --- |
| Grill waits for input | `crew answer <phase-task> <answer>` | Both resume and fresh-process fallback complete and retain the answer. |
| Spec rejected | `crew approve --board <board> --draft <draft> --reject --note <feedback>`, then approve the revised draft | Rejected spec is absent from memory; edited revised spec is stored. |
| Tickets rejected | Reject with a note, then approve the revised plan | Existing tickets remain held, with no worker runs before approval. |
| Twenty-first ticket rejected | Review the retained set and approve its gate | Both a live Orchestrator and a human receive quota rejection; exactly 20 tickets remain. |
| Invalid blocker at creation | Correct `--blocked-by` and repeat `crew ticket create` | Failed creation leaves no row; corrected tickets can be approved with a valid dependency. |
| Blocker cancelled before approval | `crew cancel <dependent>`, then `crew approve` | Failed approval preserves the draft and held dependent; human cancellation permits approval. |

Approval validation also rejects dependency cycles. The new gate recovery case exercises a bad blocker; existing Scheduler cycle checks remain covered by the prior ticket suite. An escalated blocker can be recovered with existing human `crew retry`; exhaustive phase interruption coverage remains bullet 7.

Basic phase crash, timeout and cancellation recovery remains covered by the previously reviewed phases.test.ts cases using human retry. Broken config startup recovery remains prior config-init coverage: repair the file and restart. Last-ticket escalation and full-board completion recovery are not implemented or claimed in this slice; they belong to bullet 6.

## Races and failure windows tested

- Concurrent gate approval: existing phases.test.ts, `stores a draft without verification, approves edited text once concurrently and creates one fresh next-phase task`.
- Old approval while successor runs: existing phases.test.ts, `rejects an old gate while the next Orchestrator run is live and leaves exactly one next-phase task`.
- Stop/cancel between phase completion and gate publication: exhaustive in-request interleavings not tested; bullet 7.
- Restart at every running phase and gate: not exhaustively tested; bullet 7. Existing durable-gate restart coverage retained.
- Two live Orchestrator runs for one phase: existing phases.test.ts, `allows only one starting or live Orchestrator run for a phase and uses a detached disposable worktree`.
- Ticket creation after cancellation or phase movement: existing tickets.test.ts live-Orchestrator authorization test retained.
- Tickets before approval and through rejection: new 0/1/20 gate cases prove no worker runs before approval.
- Invalid blocker at approval: new bad-blocker case proves draft and held dependent survive; human cancellation permits approval.
- Stale spec approval: new grill cases prove rejection without duplicate spec publication.
- Post-commit event-delivery crash window: described in §9; exhaustive crash testing deferred to bullet 7.

## Deviations and proposed decisions

Updated the onboarding status, architecture status, milestone plan §9 and session handoff. No dependencies, migrations, PRD Decision Log entries or D28 changes were introduced. README content did not require a change.

The implementation choices are recorded in `plan/phase1/milestone-5.md` §9:

- Rejected tickets retain their rows and durable per-phase quota usage. Humans inspect, reuse, assign or cancel them rather than creating a separate draft-ticket subsystem.
- The plan summary is advisory. Humans may change tickets between summary submission and approval; inspect `crew tasks` before approving.
- Dependency validation and release share one approval transaction.
- A crash after commit but before event publication leaves durable ready tickets for restart dispatch. Exhaustive interruption testing remains bullet 7.
- A cancelled ticket still consumes quota. At the quota, review or cancel and approve the retained set rather than creating replacement tickets.
- The persisted project-summary rewrite and empty-dispatch completion remain bullet 6.

One fresh reread of the implementation diff, test file and documentation changes was completed before the report. No further implementation changes resulted from that reread.

## Open questions answered

- Loader (§8): previously approved pinned jiti 2.7.0; unchanged.
- Orchestrator answering questions (§8): worker questions remain human-directed under D65. Grill uses real ask/answer; no answering daemon added.
- Orchestrator output file and permission flags (§8): existing exact absolute Edit rule; recorded fixture `test/fixtures/claude-code/phase-output-dontask.json` proves allowed output Edit, denied other Edit and real phase completion transport under dontAsk on Claude Code 2.1.300. Existing settings isolation retained. No new real probe this session.
- Agent authentication after restart (§8): prior initialized-team test proves Runner mints replacement in-memory authentication on first run after restart. No new persistence mechanism.
- Preview packaging (§8): still open.
- Rejecting a gate repeatedly (§8): still open. No new rejection limit; retained ticket rows continue consuming durable quota.

## Schema, API and CLI changes

- Migrations: none this session. Existing bullet 1 migration 0004 and bullet 4 migration 0005 unchanged.
- Endpoints: no new endpoints. Existing human approval endpoint now publishes approved spec memory or atomically releases tickets. Existing task creation endpoint creates held todo tickets during tickets.
- CLI commands and flags: no additions. Human authentication helper rejects agent environments; existing memory commands retain agent authorization and deny deletion/out-of-integrate promotion.
- State machine transitions added: none. Existing Scheduler todo-to-ready transition gains a tickets-gate hold; release remains Scheduler-owned.

## Docs updated

- `plan/phase1/milestone-5.md`: status, bullet 5 choices, recovery and narrow windows in §9.
- `plan/phase1/START_HERE.md`: status and next step, bullet 6.
- `docs/architecture/project-structure.md`: status and early-workflow test ownership.
- `plan/phase1/handoff.md`: implemented slice, verification, regression and remaining work.
- `docs/commands.md`: regenerated, unchanged.
- This report: separate report-only commit. Implementation documentation changes listed above remain uncommitted.
- PRD Decision Log, D28, dependency documentation and README: no changes required by this slice.

## Smoke script

Not started. No milestone 5 script, run command, run-cap arithmetic or expected-cost claim is provided. No manual smoke run occurred. Bullet 9 remains for a later session.

## Known issues, TODOs and unverified things

- Bullet 5 implementation, tests and existing documentation edits remain uncommitted. Pushing this report does not publish those changes.
- Bullets 6 to 9 are not started; full dispatch/integrate lifecycle and private-preview readiness are incomplete.
- Zero-ticket dispatch does not yet automatically complete; bullet 6.
- Exhaustive running-phase crash and in-request interruption windows remain bullet 7.
- Same-user operating-system credential access is not sandboxed by CLI authorization.
- No new real permission probe, smoke run or mutation test was performed.
- Ticket summaries are advisory; humans should inspect retained tickets before approval.
- No dependencies, migrations or product Decision Log changes were introduced.

## git diff --stat main...HEAD

Actual command output captured at HEAD `c331f293357c3c626d2c13a8279a34f6452c407a`, after rebasing over the remote documentation commit and before amending this report. It includes the earlier report version, not its final amended line count, and excludes uncommitted implementation work.

```text
 docs/architecture/project-structure.md             |   23 +-
 docs/architecture/project-techstack.md             |    7 +-
 docs/commands.md                                   |   55 +-
 drizzle/0004_clever_red_hulk.sql                   |    2 +
 drizzle/0005_concerned_bloodstrike.sql             |    3 +
 drizzle/meta/0004_snapshot.json                    | 1132 +++++++++++++++++++
 drizzle/meta/0005_snapshot.json                    | 1170 ++++++++++++++++++++
 drizzle/meta/_journal.json                         |   14 +
 package-lock.json                                  |   10 +
 package.json                                       |    1 +
 plan/phase1/START_HERE.md                          |    6 +-
 plan/phase1/agent-prompts/m5-bullet-5.md           |  168 +++
 plan/phase1/handoff.md                             |   72 ++
 plan/phase1/milestone-5.md                         |   33 +-
 plan/phase1/reports/README.md                      |    3 +
 plan/phase1/reports/milestone-5-bullet-5.md        |  191 ++++
 src/adapters/claude-code.ts                        |    8 +-
 src/adapters/fake.ts                               |    5 +-
 src/adapters/types.ts                              |    4 +-
 src/cli/client.ts                                  |   17 +
 src/cli/commands/approve.ts                        |   11 +
 src/cli/commands/init.ts                           |   52 +
 src/cli/commands/memory.ts                         |   36 +
 src/cli/commands/phase.ts                          |    8 +
 src/cli/commands/start.ts                          |    7 +-
 src/cli/commands/status.ts                         |    3 +
 src/cli/commands/ticket.ts                         |   16 +
 src/cli/declarations.ts                            |   69 +-
 src/roles/index.ts                                 |   15 +
 src/server/api/app.ts                              |  126 ++-
 src/server/db/schema.ts                            |    7 +-
 src/server/index.ts                                |   13 +-
 src/server/memory/index.ts                         |   66 ++
 src/server/memory/prompt.ts                        |  124 +++
 src/server/merge/index.ts                          |    6 +-
 src/server/project-config.ts                       |  168 +++
 src/server/runner/index.ts                         |  158 +--
 src/server/scheduler/dispatcher.ts                 |   16 +-
 src/server/scheduler/index.ts                      |   17 +-
 src/server/scheduler/tickets.ts                    |   98 ++
 src/server/verify/index.ts                         |   41 +-
 src/server/workflow/index.ts                       |  109 ++
 src/server/workflow/phases.ts                      |    8 +
 src/server/worktree/index.ts                       |   11 +-
 test/adapters/claude-code.test.ts                  |   31 +
 test/adapters/phase-permissions.test.ts            |   24 +
 test/db.test.ts                                    |   79 +-
 .../fixtures/claude-code/phase-output-dontask.json |  138 +++
 test/harness/agent-commands.test.ts                |    2 +-
 test/harness/config-init.test.ts                   |  266 +++++
 test/harness/memory-injection.test.ts              |  179 +++
 test/harness/memory.test.ts                        |   96 ++
 test/harness/merge-checkout.test.ts                |   27 +
 test/harness/phase-transport.test.ts               |   22 +
 test/harness/phases.test.ts                        |  259 +++++
 test/harness/tickets.test.ts                       |  140 +++
 56 files changed, 5163 insertions(+), 209 deletions(-)
```
