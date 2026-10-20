# Milestone 5, session 3: bullet 5 (grill, spec, tickets)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

## Session instructions (these override anything below)

You are continuing on branch `feat/milestone-5-workflow`. Run `git pull` first. Bullets 0 to 4 are done, reviewed and accepted (`rm -r dist && npm test` passes 248 tests across 42 files). Do not rework them unless a test proves a bug.

**This session is bullet 5 only (grill, spec, tickets). Stop after bullet 5.** Bullets 6 to 9 stay "not started".

Bullet 5 reminders:
- Test the real path: Orchestrator tasks run by the fake adapter through the real Dispatcher, Runner and CLI, not seeded contexts. The grill asks the human through `crew ask`, and the answer must reach the next run (fresh-process fallback included; Q&A is protected from trimming since commit 97a9a17).
- Spec approval publishes the spec to project memory with a visible source. Test that an edited spec is what gets stored, and that a rejected spec is not stored.
- Ticket creation happens in the tickets phase. Tickets must not be dispatched to workers before the tickets gate is approved. Test the gate with 0, 1 and 20 tickets, the 21st rejected, and a bad blocker or dependency cycle leaving the draft intact. A reject must not leave half-created tickets running.
- Every failure path needs a human command that moves it on. Write the recovery tests now, not later.
- Prove the Orchestrator cannot do human-only things: `crew approve`, `crew memory delete`, promoting memory outside the integrate phase.
- Keep it simple. Describe narrow windows in `plan/phase1/milestone-5.md` §9 instead of building infrastructure for them.
- Take one fresh re-read of your own diff before the report.

## How to deliver (important, the reviewer cannot see your chat)

1. Commit your work on `feat/milestone-5-workflow` (bullet commit, then docs). Do not touch `main`.
2. Write the final report, in the exact "Final report" format at the end of this file, to **`plan/phase1/reports/m5-bullet-5.md`**. Cover bullets 0 to 9 (bullets 6 to 9 as not started). Paste real command output where the format asks for it. Do not summarise away failures.
3. Commit the report file too, then `git push origin feat/milestone-5-workflow`.
4. If the push fails, say so at the top of the report file, still commit it, and stop. Never force-push, never push `main`, never print or store credentials.
5. In your chat reply, only say that the report is pushed and give the commit hash.

The full original implementer prompt follows. Where it says "reply with this format", write it to the report file instead, as above.

---

You are implementing milestone 5 ("Memory and workflow") of Crew, a local CLI (`npx crew`) plus a Hono server on 127.0.0.1 that runs AI coding agents on tasks. Stack: TypeScript (ESM, NodeNext), better-sqlite3 + Drizzle, execa, Vitest, tsup. Milestones 1 to 4 are done and on `main`. When milestone 5 is done, the private preview ships, so this is the first milestone a person other than the author will use.

## Read first, in this order
1. AGENTS.md: repo rules. Follow them.
2. plan/phase1/START_HERE.md
3. plan/phase1/milestone-5.md: the approved plan and your spec. §4 is the design, §5 the tracer bullets in order, §6 the testing notes, §8 the open questions.
4. plan/phase1/prd.md: the Decision Log (especially D2, D9, D13, D15, D21–D27, D44, D56–D65), the Orchestrator workflow user stories (23–40), the memory stories (99–106), the state machine, the data model, the API contract, "Memory budget" and "Human gates and Orchestrator lifecycle".
5. docs/architecture/project-structure.md and docs/architecture/project-techstack.md
6. plan/phase1/handoff.md
7. plan/phase1/milestone-4.md §9 and src/server/merge/index.ts. Read them for how a milestone ends in practice: recovery, interruptions, and what the reviewer found.

## Setup
- Start from `main`. Create the branch `feat/milestone-5-workflow`. Don't push and don't touch `main`.
- Commit once per tracer bullet, with the message `feat(m5): bullet N - <name>`, ending with the Co-Authored-By line your tooling requires. Commit only when that bullet's tests pass and its docs are updated.
- Never commit plan/phase1/milestone-2_sin.md or any other untracked personal file you didn't create.
- D28 (an optional `maxBudgetUsd` on the Claude Code adapter) is still open. Leave it alone and don't log it.

## What to build
Tracer bullets 0–8 from milestone-5.md §5, in order. Each one works end to end and ships with its harness test.
- Bullet 9 (smoke run): write `scripts/smoke-milestone-5.ts` and the `npm run smoke:m5` script, but don't run them. The user will run it. See the smoke rules below.
- Do not build `crew join`, `crew next`, Pull mode or any Board UI. They are out of scope.

## Lessons from milestones 2 to 4 (read these twice)
1. **No dead ends.** In milestone 4 a failed merge left the task in `merge-queue` with a failed queue item, and nothing a human could do would move it. It was found in review, not by a test. For every new failure path (a phase run that crashes, a rejected gate, a broken `crew.config.ts`, a ticket the Orchestrator creates with a bad blocker, a board whose last ticket escalates) answer: what does the board/task look like, what does `crew status` tell the human, and which command gets it moving again? Write a test for each. The milestone's own D64 says a failed phase run is recovered with `crew retry`; prove it for every phase, and prove the board is never left waiting on something nobody can act on.
2. **Races are found in review, not by tests, unless you write them.** Milestone 2 had a dying run re-dispatched as an orphan. Milestone 3 had a Reviewer re-run in a tight loop while its tool was rate-limit paused. Milestone 4 had a cancel racing a merge. For milestone 5, write a test for each window: approving a gate while the next phase run is already starting; approving twice (concurrent `crew approve` must act once); cancel or stop-all while a phase run is between `crew phase done` and the gate; a restart in each phase and at each gate; two Orchestrator runs for one phase (must be impossible); `crew ticket create` arriving after the phase run was cancelled.
3. **Keep it simple.** In milestone 4 the agent replaced a plain `git merge --ff-only` with roughly 100 lines of git plumbing to close a race of a few milliseconds. It was tested, but it is expensive to maintain and depends on one git version. Do not hand-roll infrastructure to close a very narrow window. If the simple version has a window, implement the simple version, describe the window in §9, and let the user decide.
4. **Smoke honesty and a correct run cap.** Your smoke script must assert the things it claims. The milestone 4 script printed "passed" only after asserting merged tasks, a real conflict-resolving run, real Reviewer verdicts and the final git log. Do the same here. The first milestone 4 smoke run also failed on its own safety cap, because a Reviewer is allowed one retry per round and the cap did not allow for that. Compute your cap as expected runs plus every legitimate retry (a Reviewer retry per ticket, a gate rejection if the script uses one), and write the arithmetic in a comment next to it.
5. **Real agents behave differently from the fake.** A real read-only Reviewer tried the compound command `git diff main --stat; xxd features.txt; git status --short`, was denied, and had to be re-run. The real Orchestrator will try things too. Do not guess permission syntax: read the official docs at https://code.claude.com/docs/en/permissions (and /docs/en/permission-modes) if you have web access, otherwise use `claude --help` and recorded fixtures. Facts already checked in those docs:
   - File permissions are checked against `Edit(path)` and `Read(path)` rules only. A `Write(...)` rule is accepted but never consulted. To let the Orchestrator write exactly one file, use an `Edit(//absolute/path/to/output-file)` allow rule (`//` means absolute).
   - A compound Bash command is allowed only if every subcommand matches an allow rule (separators: `&&`, `||`, `;`, `|`, `|&`, `&`, newline).
   - A bug report for v2.1.193 says that in `--permission-mode dontAsk`, scoped Write/Edit allow rules were still denied. Our adapter uses that mode. Before relying on any flag, record a fixture on the installed Claude Code (2.1.300) that shows both an allowed `Edit` of the output file and a denied edit of another file, plus a real `crew phase done` call. If the scoped rule fails under `dontAsk`, do not switch to `bypassPermissions`; propose a fallback in §9 (for example, the Orchestrator prints its output and Crew stores it) and tell the user.
   - A denied action in `claude -p` still exits 0. Check the run's `permission_denials` / tool results, not only the exit code.
6. **Report only what you verified.** In milestones 2 and 3 the reports described methods and behaviour that did not exist. Milestone 4's was accurate. Keep it that way. Before you write the report, re-read your own diff and check every claim in it against the code and the test names. If you did not run something, say so.

## Known gotchas
- **The Scheduler is the only writer of task status.** Use `TransitionContext.alongside` for writes that must commit with a transition. The new transition `doing → merged` is allowed only for tasks with `kind = 'phase'` (D60); a test must show a work task cannot take it, and that an agent token cannot call anything that makes it.
- **Migrations.** `drizzle/0004_*.sql` is generated with `npx drizzle-kit generate`; never hand-edit the snapshots. Test: open a milestone 4 database and upgrade it with its data intact.
- **Agent tokens after restart.** §8 flags that the runner keeps plain agent tokens in memory while the database stores only hashes. In bullet 0, check what happens to the default team created by `crew init` after the server restarts. If tokens are lost, tell the user in §9 how you propose to mint them; do not silently work around it.
- **Config loading.** `jiti` must be pinned to an exact version and added to project-techstack.md. A config error must stop `crew start` with the file name, the line if available, and a one-line fix hint. The file wins on every start (D56). Do not execute config code in the test process by accident: test it with a real config file in a temp repo.
- **No shell for git or agents.** Call git and agents through execa with argument arrays. Only the user's own verify commands, `worktreeSetup` and `permissions.allowCommands` come from config. `allowCommands` can never allow `git push`; test it with a config that tries.
- **Memory.** One prompt builder (D62) serves work, review, phase and fallback prompts. Do not leave the two existing prompt assembly spots in src/server/runner/index.ts (the default prompt and `buildFallbackPrompt`) as separate copies. Tests assert on the prompt text the fake adapter received. Protected parts (persona, task, feedback) must survive when the memory overflows. Memory writes by agents are role-scoped; a test must show role A cannot read role B's role memory in its prompt.
- **Gates.** A draft PhaseOutput survives a restart. `crew approve` on an already-approved or non-existent draft is a clear error, not a second phase run. `--edit` stores the edited text, not the original. A rejection note appears in the next run's prompt.
- **Ticket limit** is per board and phase (D59). Creating tickets after the phase moved on must be rejected.
- **Tests.** Never sleep to wait: wait on events (add a `phase_changed` event if you need it). Use real git repos in temp dirs and the real CLI for human actions. Kill tests must prove child processes are gone.
- **`rm -r dist && npm test`** builds first, typechecks src and tests, then runs the suite. The environment rejects `rm -rf`, so use `rm -r`. It must pass before every commit.
- A mutation check on your key tests (break the code, see the test fail) is encouraged; mention which ones you did.

## Smoke script rules (bullet 9)
- Throwaway repo in `/tmp`, a clean `main`, a separate `CREW_HOME`, a trivial project (for example a file and a `node verify.cjs` verify command), `crew init` and `crew start` through the real CLI.
- Real Claude Code for the Orchestrator, two developers and a Reviewer whose role is named `reviewer`. The human is scripted: it answers the grill questions with `crew answer`, and approves each gate with `crew approve` (use one `--reject --note` in the tickets or spec gate to exercise rejection, if you can keep the run count down; say which).
- Keep it as small as possible: three tiny tickets with one dependency. Per-run `--max-budget-usd 0.50` through the existing adapter option, a total wall-clock deadline, and a run cap computed as described in Lesson 4.
- Fail unless: the board reaches `done`; all three tickets are `merged`; the approved spec, a project summary and at least one promoted role learning exist as memory rows with a `source`; the Orchestrator ran at least in grill, spec, tickets and integrate (phase tasks with `kind = 'phase'`, exit reason `done`); no review was skipped; and `git log --oneline` on `main` has the expected commits.
- Print the final `git log --oneline`, `crew status` and `crew memory list`.

## Rules
- Docs stay in English and change in the same commit as the code, following the table in AGENTS.md.
- Regenerate docs/commands.md with `npm run generate:docs`. Never hand-edit the generated parts.
- If you need to deviate from milestone-5.md or the PRD, or decide something the plan leaves open:
  - Don't edit the PRD Decision Log.
  - Add the item, with the reason, under a new "§9 Proposed during implementation" section in milestone-5.md.
  - List it in your report. The user approves it and logs it as D66 onwards.
- Add a dependency only with a reason in §9, pinned to an exact version, and add it to project-techstack.md. `jiti` is already approved (D56).
- If you run out of time or context, stop at a bullet boundary with everything passing and report what is left. Never commit a half-finished bullet.
- At the end, update the Status line in milestone-5.md, handoff.md, START_HERE.md and project-structure.md. Don't mark the milestone done: the user still has to run the smoke script.

## Final report
When you finish or stop, reply with exactly this format, filled in, so the user can paste it to the reviewer:

```
# Milestone 5 report

## Summary
<2–4 sentences: what works now, what doesn't>

## Branch and commits
- Branch: feat/milestone-5-workflow (base: <hash>)
- <hash> bullet 0 - <name>
- ...

## Tracer bullets
| # | Bullet | Status (done/partial/skipped) | Tests added (file: test names) | Notes |
|---|--------|-------------------------------|--------------------------------|-------|
| 0 | Config and init | | | |
| 1 | Creating tickets | | | |
| 2 | Memory store and human CLI | | | |
| 3 | Memory injection | | | |
| 4 | Phase engine | | | |
| 5 | Grill, spec, tickets | | | |
| 6 | Dispatch and integrate | | | |
| 7 | Interruptions | | | |
| 8 | Human CLI polish | | | |
| 9 | Smoke run (script only) | | | |

## Done criteria (milestone-5.md §1)
- [x] or [ ] <criterion>: <evidence: test name or command>

## Test results
- Command: rm -r dist && npm test
- Typecheck: <ok / errors>
- Tests: <N passed, M failed, K skipped>
- <paste the final summary lines of the output>

## No dead ends
<for each failure path from Lesson 1: what the human sees, the command that recovers it, and the test name>

## Races and failure windows tested
<one line per window from Lesson 2: the test name, or "not tested" with the reason>

## Deviations and proposed decisions
<for each: what the plan said, what you did, why. "None" if none>

## Open questions answered
- Loader (§8): <what you did>
- Orchestrator answering questions (§8): <what you did>
- Orchestrator output file and permission flags (§8): <the rule you used, the recorded fixture and where it is, and whether `dontAsk` honoured it>
- Agent tokens after restart (§8): <what you found, what you propose>
- Preview packaging (§8): <answer or "still open">
- Rejecting a gate repeatedly (§8): <answer or "still open">

## Schema, API and CLI changes
- Migrations: <file names and what they add>
- Endpoints: <method, path, auth>
- CLI commands and flags: <list>
- State machine transitions added: <list>

## Docs updated
- <file>: <what changed>

## Smoke script
<path, how to run, what it asserts, the run-cap arithmetic, expected cost>

## Known issues, TODOs and unverified things
- <item>

## git diff --stat main...HEAD
<paste>
```
