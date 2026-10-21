# Milestone 5, parallel track B: hardening, CLI polish (bullet 8) and early-phase interruptions (bullet 7, part 1)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

Two agents work in parallel on separate branches, so file ownership matters (see "Parallel work rules"). The shared background (lessons, gotchas, rules, the final report format) is in `plan/phase1/agent-prompts/m5-bullet-5.md`. Read it fully, **except** its "Session instructions" and "How to deliver" sections, which this file replaces.

## Session instructions

You are on branch `feat/m5-cli-hardening`, cut from `feat/milestone-5-workflow` at commit `424b79d` (bullets 0 to 5 done, reviewed and accepted: `rm -r dist && npm test` passes 257 tests across 43 files). Run `git pull` first. Do not rework earlier bullets unless a test proves a bug.

**This session is three commits, in this order. Stop after the third.** Bullet 6 (dispatch and integrate) is built by another agent at the same time; bullet 9 (the smoke script) comes after both tracks are merged.

### Commit 1: `fix(m5): deny agent reads of Crew home`

The human secret lives in `~/.crew/server.json` (the CLI reads it from `getCrewHome()`), and agents have the `Read` tool. A live Orchestrator already managed to approve a gate by using the human CLI once; the CLI now refuses human auth when `CREW_AGENT_TOKEN` is set, but an agent could still read the file. Deny `Read` of the Crew home directory (and `server.json`) in **every** Claude Code permission profile (worker, Reviewer, Orchestrator), with the correct absolute-path rule syntax (`Read(//abs/path/**)`; `//` means absolute, read https://code.claude.com/docs/en/permissions). The Crew home path must be resolved at spawn time (honour a custom `CREW_HOME`). Add adapter contract tests. If you can, record a real probe on the installed Claude Code (2.1.300) under `dontAsk`: a denied read of a file in a fake Crew home and an allowed read of a normal file (cap $0.50, two-minute deadline), and store the fixture; if you cannot, say so in the report. This is defence in depth, not an OS sandbox; say so.

### Commit 2: `feat(m5): bullet 8 - Human CLI polish`

From milestone-5.md §5 bullet 8 and PRD stories 33 to 40:
- `crew status` shows, per board: the current phase, a pending gate (draft id, which phase, the exact `crew approve` command to run), the phase task and its state, and any recovery hint. The status API already returns `phases[]` with `boardId`, `phase`, `draftId`, `taskId`, `status` and `problem`; extend it only as needed. `phases[].problem` is a string produced by the workflow engine (another agent adds dispatch/integrate problems such as "last ticket escalated, run crew retry <id> or crew cancel <id>"); render it prominently and unchanged. In dispatch show progress (tickets by status). Keep the output short and readable.
- `crew tasks` filters: by status, role, board and assignee (check the PRD and `docs/commands.md` for what already exists; add only what is missing). Invalid filter values give an actionable error.
- Help text for every command from bullets 0 to 5 is clear, and `docs/commands.md` is regenerated from the declarations (D3), never hand-edited.
- Test through the real CLI in the harness. Include: status with a pending gate, status with an escalated phase task (recovery hint names `crew retry`), status with nothing pending, filters.

### Commit 3: `test(m5): early-phase interruptions` (bullet 7, part 1)

Bullet 7 is "Interruptions" (milestone-5.md §5). You do the part that does not need dispatch/integrate, for the **grill, spec and tickets phases and their gates only**:
- restart the server at each phase while the Orchestrator run is live, and at each gate while a draft is pending: no duplicate phase task, the draft survives, the human can still approve;
- stop-all during a phase run, then resume; cancel of a phase task, then retry creates exactly one replacement (child processes are gone, prove it with the PIDs as the bullet 4 tests do);
- an escalated phase task recovered by `crew retry`;
- unauthorised callers: a worker token and no token against every phase endpoint (`/api/tasks/:id/phase`, `/phase-done`, `/api/boards/:id/phase`, `/phase/approve`).
Most of these may already pass because of bullet 4/5 work; add the tests that are missing and say which ones already existed. If a test exposes a bug in the workflow engine, fix it **minimally** in `src/server/workflow/*` and call it out clearly in the report (the other agent owns that folder, the reviewer will merge). The dispatch and integrate parts of bullet 7 are done after both tracks merge.

## Parallel work rules (important, avoids merge conflicts)

- **You own:** `src/adapters/*`, `src/cli/*`, `src/server/api/app.ts` status routes only, `docs/commands.md` (generated), and new tests (`test/adapters/*`, `test/harness/cli-status.test.ts`, `test/harness/interruptions.test.ts` or similar names).
- **The other track owns:** `src/server/workflow/*`, `src/server/scheduler/*`, and the dispatch/integrate tests. Avoid editing them (see commit 3 for the one exception).
- **Do not edit** `plan/phase1/handoff.md`, `plan/phase1/START_HERE.md` or `plan/phase1/milestone-5.md`. The reviewer merges the two tracks and updates them. Put your proposed decisions (what would have gone into §9) in your report under "Deviations and proposed decisions".
- You may update `docs/architecture/project-structure.md` and `docs/architecture/project-techstack.md` only on the lines about the files or behaviour you change.
- No new migration unless a test proves one is needed (say so at the top of the report). No new dependencies.

## How to deliver (the reviewer cannot see your chat)

1. Make the three commits above; `rm -r dist && npm test` must pass before each.
2. Write the report, in the "Final report" format at the end of `m5-bullet-5.md`, to **`plan/phase1/reports/m5-bullet-8.md`**. Cover bullets 0 to 9: 0 to 5 as "previously done", 7 as "part 1 only: early phases", 8 as yours, 6 and 9 as "not this track". Paste the real `npm test` summary and the real `git diff --stat feat/milestone-5-workflow...HEAD` output. Make the commit list and the diff stat accurate for the final HEAD, and do not describe a commit as "follow-up" or "unpushed" unless it is. State every claim you did not verify.
3. Commit the report as its own commit `docs(m5): bullet 8 report`, then `git push origin feat/m5-cli-hardening` (a normal push, never force, never `main`, never print credentials or remote URLs).
4. If the push fails, say so at the top of the report, still commit it, and stop.
5. In chat, only say the report is pushed and give the final commit hash.
