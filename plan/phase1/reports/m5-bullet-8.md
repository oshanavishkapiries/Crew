# Milestone 5 report

## Summary

No migration or dependency added. This track adds Claude Code Crew-home Read denials, human CLI status/filter/help polish, and early-phase interruption coverage. Dispatch/integrate and the smoke script belong to the other track and the post-merge work. The requested whole-home Read denial also covers Crew-managed worktrees; a complete real-agent workflow under that rule was not run.

## Branch and commits

- Branch: `feat/m5-cli-hardening` (workflow base: `424b79d2737c5adce3ae8d03a25c2973e1712432`).
- The supplied branch already contained `8b1d733`, the task-prompt commit; it appears in the requested base diff.
- `7d63cc5` fix(m5): deny agent reads of Crew home
- `f0959e0` feat(m5): bullet 8 - Human CLI polish
- `774dab8` test(m5): early-phase interruptions
- Report commit: `docs(m5): bullet 8 report` (the commit containing this report).

## Tracer bullets

| # | Bullet | Status (done/partial/skipped) | Tests added (file: test names) | Notes |
|---|--------|-------------------------------|--------------------------------|-------|
| 0 | Config and init | done | Previously done | Included in full suite |
| 1 | Creating tickets | done | Previously done | Included in full suite |
| 2 | Memory store and human CLI | done | Previously done | Included in full suite |
| 3 | Memory injection | done | Previously done | Included in full suite |
| 4 | Phase engine | done | Previously done | Included in full suite |
| 5 | Grill, spec, tickets | done | Previously done | Included in full suite |
| 6 | Dispatch and integrate | skipped | None | Not this track |
| 7 | Interruptions | partial | test/harness/interruptions.test.ts: restarts during a live %s run; preserves a pending %s gate; stops a live %s process tree; cancels a live %s process tree; recovers an escalated %s task; rejects workers and absent tokens (full names below) | Part 1 only: early phases |
| 8 | Human CLI polish | done | test/harness/cli-status.test.ts: shows the pending gate phase, exact approval command and completed phase task; combines status, role, board and assignee filters and accepts exact names or IDs. test/adapters/crew-home-permissions.test.ts: denies Crew home reads in %s spawn and resume, resolved each time; records a real dontAsk Read denial | This track |
| 9 | Smoke run (script only) | skipped | None | Not this track |

## Done criteria (milestone-5.md §1)

- [x] Init/config/default team: previously done; existing config-init harness cases included in the clean suite.
- [x] Orchestrator-only tickets/assignment/quota: previously done; existing tickets and early-workflow harness cases included.
- [x] Three sourced memory layers and promotion: previously done; memory tests included. Full integrate lifecycle remains the other track.
- [x] Shared budgeted run prompts: previously done; memory-injection tests included.
- [ ] Full board through dispatch/integrate and merged tickets: not this track. Existing early-workflow tests stop at ticket release.
- [ ] Recovery for every workflow phase: early-phase failure/hang/cancel recovery is verified by new parameterized interruptions tests plus existing phases timeout/setup-failure cases; dispatch/integrate interruptions remain outside this track.
- [x] Status shows phase and pending gate: new real CLI tests also assert phase-task state, exact approve command, retry hint, unchanged missing-team problem and per-board dispatch work-ticket counts.
- [ ] Manual real Claude Code grill-to-merge smoke: not written or run here; only the bounded Read permission probe was run.
- [ ] Milestone-wide final documentation: reviewer updates the protected onboarding/handoff/milestone files after merging both tracks, as instructed. Matching adapter/CLI architecture lines and generated commands are updated here.

## Test results

- Command before each implementation commit: `rm -r dist && npm test`.
- Typecheck: ok in every clean suite. Global-setup build: ok.
- Final tests: 291 passed, 0 failed, 0 skipped.

Clean suite 1:

```text
 Test Files  44 passed (44)
      Tests  262 passed (262)
   Start at  07:24:59
   Duration  598.10s (tests 94%, import 5%)
```

Clean suite 2:

```text
 Test Files  45 passed (45)
      Tests  273 passed (273)
   Start at  07:36:43
   Duration  618.16s (tests 95%, import 5%)
```

Clean suite 3:

```text
 Test Files  46 passed (46)
      Tests  291 passed (291)
   Start at  07:48:42
   Duration  698.94s (tests 95%, import 5%)
```

- Focused interruption suite: `npx vitest run test/harness/interruptions.test.ts`: 18 passed (66.86s). The final clean suite also covers the subsequently strengthened before-kill PID and stop/resume task-count assertions.
- Initial red checks were expected failures: 4 adapter cases failed because Crew-home denials were absent; 10 CLI cases failed on missing gate/task/problem/progress output, unrecognized filter flags and missing full help. After implementation, the focused CLI/reference run passed 12 tests across 2 files (27.92s); the final clean suites include an additional registered-empty/ambiguous-role case. No unexpected full-suite failures occurred.
- `npm run generate:docs` regenerated the reference; the reference-staleness test passed. `git diff --check` passed. A fresh own-diff reread completed before the report.

## No dead ends

- Failed early phase: status names the escalated phase task and `crew retry <id>`; `interruptions.test.ts: recovers an escalated %s task through the printed human retry command` covers grill/spec/tickets through successful output and approval. Existing `phases.test.ts` also covers timeout and worktree-setup failure.
- Cancelled early phase: status prints `crew retry <id>`; concurrent human retries create one replacement; `interruptions.test.ts: cancels a live %s process tree and creates exactly one replacement on retry` proves the old task stays cancelled and the replacement completes.
- Stopped run: `crew resume` allows the same task to complete without a charged retry; `interruptions.test.ts: stops a live %s process tree and resumes without another task or charged retry`.
- Pending/rejected gate: status prints draft, phase and exact approval command; new gate-restart cases approve once after restart. Existing `phases.test.ts: rejects with feedback in the next fresh run without charging a retry` covers rejection.
- Missing phase team: status preserves the engine's complete problem text. New CLI coverage checks it; existing `phases.test.ts: shows an actionable missing-team state and recovers with init then resume` proves `crew init`, then `crew resume`.
- Bad ticket/blocker: existing `early-workflow.test.ts: rejects a bad creation without losing the plan and lets the human create a corrected dependency before approval` and `keeps a bad-blocker draft intact and recovers with human cancel then approve` remain green.
- Broken config: existing config-init invalid-config/startup cases require fixing crew.config.ts and rerunning `crew start`; no new config behavior here.
- Invalid task filter: CLI exits nonzero, names the invalid flag, lists valid choices/IDs and points to `crew tasks --help`. A valid empty result is successful. Ambiguous role/agent names require an ID.
- Dispatch last-ticket escalation: engine recovery is owned by the other track and not verified here. The CLI prints any supplied `phases[].problem` prominently and unchanged, independently of task/gate fields.

## Races and failure windows tested

- Live restart for grill/spec/tickets: `interruptions.test.ts: restarts during a live %s run, kills its process tree and completes the same task once`; fresh runtime and new DB connection, same task, two runs, one draft, successful approval; both old PIDs gone.
- Pending-gate restart for all three early phases: `preserves a pending %s gate over restart and accepts human approval exactly once`; identical durable draft, no duplicate task, second approval rejected.
- Stop/resume and cancel/retry for all three: new parameterized PID checks; concurrent retries yield exactly one replacement.
- Worker/no-token requests for all four phase endpoints in every early phase: new auth matrix, including another approval attempt against an actual pending draft; no mutation and valid human approval afterwards.
- Existing coverage retained: concurrent approval once; stale approval while the next run is live; one starting/live Orchestrator; late completion after cancellation; draft retained through stop-all; phase timeout and setup failure; tickets rejected after cancellation or phase movement. These were already in phases.test.ts/tickets.test.ts.
- Exact simultaneous stop/cancel versus a phase-done HTTP request is not newly exercised; the existing ordered late-completion and durable-gate cases do not prove every interleaving.
- Ungraceful server SIGKILL with surviving old agent processes, power loss, dispatch and integrate interruptions are not tested here. Restart cases use graceful server close, reconstruct runtime components and open a new SQLite connection, rather than killing the test process.

## Deviations and proposed decisions

- No workflow/scheduler changes, migration or new dependency were needed.
- Task filters run in the human CLI over the existing `/api/tasks` response. To validate registered but empty roles/boards/agents without changing the other track's routes, `/api/status` additionally supplies registered role IDs/names; boards and agents are already present. Role and assignee names must be unique exact matches, IDs take precedence, and filters combine with AND. This is a proposed interface choice, not a PRD Decision Log edit.
- The requested whole-Crew-home Read denial also covers task worktrees stored beneath Crew home. This is an intentional consequence of the requested scope, not verified usable by a complete real-agent workflow. Consider moving worktrees outside the protected home or narrowing protection in a later approved decision; this track does neither.
- Three implementation commits are followed by the separately requested report commit. No protected handoff/START_HERE/milestone file or PRD Decision Log was edited; this report carries proposed decisions for the reviewer.

## Open questions answered

- Loader (§8): previously implemented pinned jiti 2.7.0; unchanged, config tests rerun.
- Orchestrator answering questions (§8): D65 sends worker questions to the human; no change.
- Orchestrator output file and permission flags (§8): previous phase-output fixture remains; existing contract tests rerun. New Crew-home rules use `Read(//absolute/home/**)` and exact `Read(//absolute/home/server.json)` per [official permissions documentation](https://code.claude.com/docs/en/permissions). New fixture `test/fixtures/claude-code/crew-home-read-dontask.json` records installed Claude Code 2.1.300 under dontAsk: fake secret Read denied, normal Read allowed, exit 0, one permission_denial, cost $0.1684215, cap $0.50, timeout 120000ms not reached. A denied tool call still exits 0; assertions inspect tool results and denials. No bypassPermissions used.
- Agent tokens after restart (§8): existing Runner minting behavior retained. Fresh-runtime interruption cases require the new Orchestrator token to authenticate through real CLI completion; existing default-team token-rotation tests are rerun.
- Preview packaging (§8): still open, not this track.
- Rejecting a gate repeatedly (§8): still open, unchanged.

## Schema, API and CLI changes

- Migrations: none; no schema or state-machine transition added.
- Endpoints: only human-secret `GET /api/status` gains `roles: [{ id, name }]` and per-board `phases[].ticketCounts` (work tasks only, grouped by status in dispatch). Existing phase/task/problem fields and auth remain.
- CLI: `crew tasks --status <status> --role <id-or-unique-name> --board <id> --assignee <id-or-unique-name>`, combined with AND; status lists gate/task/recovery independently, preserves problem text, adds dispatch progress; command help includes declared full descriptions and examples, including bullets 0–5.
- Permissions: all four Claude profiles, spawn and resume, deny Crew-home subtree and server.json Reads, resolving CREW_HOME at build time (including default, absolute custom and relative custom paths).

## Docs updated

- docs/commands.md: regenerated by `npm run generate:docs`; declarations remain the source of truth.
- docs/architecture/project-structure.md: matching adapter/fixture and CLI/interruption coverage lines only.
- docs/architecture/project-techstack.md: adapter Read denials, real probe evidence and defence-in-depth boundary.
- plan/phase1/reports/m5-bullet-8.md: this report.

## Smoke script

Not this track; not written or run. No full workflow smoke is claimed. The existing milestone 2–4 smoke scripts were not run.

## Known issues, TODOs and unverified things

- Read denials are defence in depth, not an OS sandbox. They do not establish that Bash/Grep, allowed commands, symlink aliases or other tools cannot expose Crew files. The real probe tests only Read against one fake home and one normal file, with external settings disabled. It does not prove every profile or a real spawned full workflow secure.
- Crew home commonly contains the working tree: its Read restriction may interfere with normal agent inspection. No full real-agent workflow was run to assess that effect.
- Live-restart tests cover graceful shutdown and reconstruction, not ungraceful crash cleanup.
- Dispatch/integrate problem strings from the parallel track and its lifecycle were unavailable and are not integration-tested here; rendering preserves any supplied problem string.
- No mutation testing was performed. The original four permission cases and ten initial CLI cases were observed failing for missing behavior before implementation; later coverage additions and interruption cases test already-existing behavior and are not claimed red-first.
- Linux was tested here. macOS/WSL were not run.

## git diff --stat feat/milestone-5-workflow...HEAD

```text
 docs/architecture/project-structure.md             |   6 +
 docs/architecture/project-techstack.md             |   2 +
 docs/commands.md                                   |  21 ++-
 plan/phase1/agent-prompts/m5-bullet-8.md           |  48 ++++++
 plan/phase1/reports/m5-bullet-8.md                 | 164 +++++++++++++++++++++
 src/adapters/claude-code.ts                        |  10 +-
 src/cli/commands/status.ts                         |  20 ++-
 src/cli/commands/tasks.ts                          |  47 ++++--
 src/cli/declarations.ts                            |  17 ++-
 src/cli/index.ts                                   |   4 +
 src/server/api/app.ts                              |  12 +-
 test/adapters/crew-home-permissions.test.ts        |  40 +++++
 .../claude-code/crew-home-read-dontask.json        |  72 +++++++++
 test/harness/cli-status.test.ts                    | 100 +++++++++++++
 test/harness/interruptions.test.ts                 | 152 +++++++++++++++++++
 15 files changed, 689 insertions(+), 26 deletions(-)
```
