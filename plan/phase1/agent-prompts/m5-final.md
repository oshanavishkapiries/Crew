# Milestone 5, final session: Read-deny fix, bullet 7 (rest), bullet 9 (smoke script), docs

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

The shared background (lessons, gotchas, smoke script rules, rules, the final report format) is in `plan/phase1/agent-prompts/m5-bullet-5.md`. Read it fully, **except** its "Session instructions" and "How to deliver" sections, which this file replaces. Also read the two track reports: `plan/phase1/reports/m5-bullet-6.md` and `plan/phase1/reports/m5-bullet-8.md`.

## Session instructions

You are on branch `feat/milestone-5-workflow`, which now contains bullets 0 to 6 and 8, and bullet 7 part 1 (the two parallel tracks were merged and reviewed; `rm -r dist && npm test` passes 303 tests across 47 files). Run `git pull` first. Do not rework accepted code unless a test proves a bug.

Four commits, in this order. Stop after the fourth.

### Commit 1: `fix(m5): narrow the Crew-home Read denial`

Track B denies `Read(//<crewHome>/**)` for every Claude Code profile. But Crew's worktrees live in `<crewHome>/worktrees` (`src/server/config.ts`), so that rule also denies agents reading **their own working tree**. A real agent cannot edit files it cannot read, so this would break every real run (the unit tests use the fake adapter and the probe read a file outside the fake home, so nothing caught it).

Fix it: deny only the secret and state files inside the Crew home (`server.json`, the SQLite database and its `-wal`/`-shm` files, `claude-settings.json`, and the logs directory if reading logs is not needed by agents), never the `worktrees` subtree. Keep `CREW_HOME` resolved at spawn time. Update the adapter contract tests so they fail for the old whole-home rule. **Re-record the real probe** on the installed Claude Code (2.1.300, `dontAsk`, cap $0.50): a denied read of a fake `server.json`, an allowed read of a file under a fake `<crewHome>/worktrees/<id>/` directory, and an allowed read of a file outside the home. Store it as a fixture and replace the old fixture. Assert on tool results and `permission_denials`, not only the exit code. Say plainly in the report that this is defence in depth, not a sandbox.

### Commit 2: `test(m5): dispatch and integrate interruptions` (bullet 7, part 2)

Bullet 7 is "Interruptions" (milestone-5.md §5). Part 1 (grill, spec, tickets) and many integrate cases already exist; list what exists in `dispatch-integrate.test.ts` and `interruptions.test.ts` first, then add only what is missing. Required coverage for dispatch and integrate:
- cancel of the integrate phase task, then `crew retry` creates exactly one replacement, with PIDs gone;
- the whole phase-endpoint auth matrix (worker token, no token, another workspace's agent token) against an integrate task and a pending integrate gate, and ticket creation after the board moved on to dispatch;
- promotion by the Orchestrator after its integrate run ended, and from a different board's run: rejected;
- stop-all while the board is in dispatch with workers running, then resume: the board still reaches integrate once;
- one real **SIGKILL of a server process** (a real child process running the built server, not the in-process harness) during an Orchestrator run: record what happens to the agent process and to the board after a new `crew start`. If the old agent survives or a duplicate Orchestrator can run, do **not** build infrastructure: add the smallest fix only if it is a few lines, otherwise describe it in the report and in milestone-5.md §9 and let the user decide.
Every failure path needs a human command that moves it on, with a test.

### Commit 3: `feat(m5): bullet 9 - Smoke script`

Write `scripts/smoke-milestone-5.ts` and the `npm run smoke:m5` entry. **Do not run it** (it costs real money; the user runs it). Follow the "Smoke script rules (bullet 9)" in `m5-bullet-5.md` and the structure and honesty of `scripts/smoke-milestone-4.ts`:
- throwaway repo in `/tmp`, clean `main`, separate `CREW_HOME`, tiny project with a trivial verify command, `crew init`, `crew start` and every human action through the real CLI;
- real Claude Code Orchestrator for grill, spec, tickets and integrate; two real workers; a real Reviewer; scripted human answers and approvals; at least one gate rejection with a note;
- it must assert and fail if missing: every phase reached in order, tickets merged, memory rows with their sources (`phase:spec:*`, `phase:integrate:*`, a promotion), the Orchestrator never using a human-only command, the final `git log` holding all tickets, board `done`, and no agent processes left;
- the run cap is computed as expected runs plus every legitimate retry (per-ticket Reviewer retry, gate rejection run, Orchestrator retry), with the arithmetic in a comment, plus a wall-clock deadline and a per-run cost cap; print the expected cost range;
- since the Read-deny rule applies to real agents, the script must also check from the run logs that no agent was denied reading its own worktree.
Check the script with a dry run mode or `tsc` only (no real agent). Note the real risks you expect to see on the first real run (permission denials of compound commands, the Orchestrator trying a human-only command) in the report so the reviewer knows what to look for.

### Commit 4: `docs(m5): milestone 5 status and merged proposals`

You are now the only agent, so update the shared docs: `plan/phase1/milestone-5.md` (status; move both track reports' "Deviations and proposed decisions" into §9, deduplicated, each clearly marked as proposed and not yet approved), `plan/phase1/handoff.md`, `plan/phase1/START_HERE.md`, and `docs/architecture/*` where the code changed. Do **not** edit the PRD Decision Log: the user approves the §9 proposals and they are logged as D66 onwards afterwards. List the open questions that remain (preview packaging, repeated gate rejection, D28).

## Parallel work rules

Nobody else is working in this repo during this session. Do not touch `main`. No new dependencies; no migration unless a test proves one is needed (say so at the top of the report).

## How to deliver (the reviewer cannot see your chat)

1. Make the four commits above; `rm -r dist && npm test` must pass before each.
2. Write the report, in the "Final report" format at the end of `m5-bullet-5.md`, to **`plan/phase1/reports/m5-final.md`**. Cover bullets 0 to 9. Paste the real `npm test` summary and the real `git diff --stat main...HEAD` output. Make the commit list and the diff stat accurate for the final HEAD. State every claim you did not verify. State clearly that the smoke script was written and **not run**.
3. Commit the report as its own commit `docs(m5): final report`, then `git push origin feat/milestone-5-workflow` (a normal push, never force, never `main`, never print credentials or remote URLs).
4. If the push fails, say so at the top of the report, still commit it, and stop.
5. In chat, only say the report is pushed and give the final commit hash.
