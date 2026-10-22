# Milestone 8: End-to-end run (mixed Claude Code + Codex)

The plan for milestone 8 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** planned, not started. The user chose a small throwaway project (below), so a failure risks nothing real.

## 1. Goal

Prove the whole pipeline on a real (if tiny) project with real agents: grill → phase plan → tickets → parallel work by a mixed Claude Code + Codex team → verification → review → merge → phase gate. This is the release criterion in the PRD ("Release criterion"). It is a manual run, not an automated test.

### Done when

- A throwaway project goes from an empty git repo to a working tool through Crew only, with at least one merged task authored by Claude Code and one by Codex.
- At least one **Claude-author / Codex-Reviewer** review and one reverse review ran for real. This closes the step 2 gap left open in milestone 7.
- At least one Pull-mode (terminal) agent completed a task, if the user has a tool to use (Antigravity, or a second terminal playing the part).
- At least one failure path is seen live and recovered through Crew: a verification failure with retry, a merge conflict task, or a stop-all/resume. A real provider rate limit is welcome but is never provoked.
- Findings are recorded in `reports/m8-run.md`: what worked, every bug or papercut with severity, cost, and a go/no-go for public preview.
- Bugs found are fixed on branches with tests (normal bullet workflow); minor papercuts go to a list.

## 2. Preconditions (user)

- **Claude Code login restored.** `claude auth status` currently reports `loggedIn: false`. This blocks the whole milestone.
- Codex stays logged in (it was at the milestone 7 smoke).
- Node and git as for the earlier milestones; `npm run build` done on `main`.

## 3. The throwaway project

A small tool with 6–10 tickets across 2 phases and real parallelism. Recommended: **`mdlint`, a tiny Node CLI** that checks Markdown files (broken relative links, heading order, trailing spaces) and prints a report with an exit code. Phase 1: core parser, link check, heading check. Phase 2: CLI flags, JSON output, README. It has pure functions (easy verification), independent modules (parallel tasks) and an integration point (conflicts happen naturally). The project lives outside this repo, e.g. `~/Projects/crew-m8-mdlint`, with its own git repo and its own `CREW_HOME`-style data via the normal `crew init`.

## 4. Run script (manual, in order)

1. **Setup.** Create the repo, add a minimal `package.json` and a test command (`node --test`). `npx crew init` with a `config.team` of: 1 Claude Code Orchestrator, 2 Claude Code workers, 1 Codex worker, 1 Codex Reviewer (so cross-tool review occurs). Optionally one Pull member.
2. **Grill.** Start `crew start`; open the Board. Run the grill with the Orchestrator until the PRD for `mdlint` exists. Note quality of questions and the amount of babysitting.
3. **Phase plan and tickets.** `crew phase` then tickets; approve at the human gates in the Board. Check dependencies and sizing are sensible.
4. **Execute.** Let dispatch run. Watch the Board: live logs, Team status, Inbox questions. Answer agent questions from the Inbox.
5. **Exercise failures** on purpose, in this order, each only once: (a) edit a task so verification fails and watch the retry; (b) two tickets touching one file to get a conflict task; (c) `crew stop-all` mid-run and `crew resume`.
6. **Pull member** (optional): connect via `crew connect`, paste the prompt into a terminal agent, let it take a task.
7. **Gate and close.** Approve the phase gate, run phase 2, finish. Check `git log`, run `mdlint` against a sample, check memory layers hold real learnings.
8. **Report.** Write `reports/m8-run.md`.

## 5. How the run is observed

The planner/reviewer (Claude here) watches via the Board in the browser pane, `crew status`, logs and the DB through the API, and records findings as they occur. The user drives approvals and answers questions. No prompt is needed for agents: the agents are the Crew team itself.

## 6. Bounds and cost

- Hard cap on elapsed time: one working session (about 3 hours). If the run stalls, stop and record why.
- Claude workers carry the existing `maxBudgetUsd` limit per run; set it explicitly in the config (suggest 1.00). Codex has no dollar cap, so limit the team to one Codex worker and one Codex Reviewer.
- Expect a few dollars of Claude cost and unmetered Codex usage. The report records actual numbers.

## 7. Risks and known gaps going in

- Codex Reviewer can technically edit the worktree (prompt rule only, D88).
- Pull terminals are not sandboxed or killable by Crew.
- Stale grace after a restart can postpone recovery.
- Real rate-limit parsing is only fixture-tested.
- Board has had no real-agent or mobile pass.

## 8. Open questions

- Which tool plays the Orchestrator for the grill: Claude Code (recommended; its grill skill is the most tested) or Codex?
- Is a real Antigravity session available for the Pull member, or do we use a plain terminal Claude/Codex session instead?
