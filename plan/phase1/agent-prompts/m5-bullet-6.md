# Milestone 5, parallel track A: bullet 6 (dispatch and integrate)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

Two agents work in parallel on separate branches, so file ownership matters (see "Parallel work rules"). The shared background (lessons, gotchas, rules, the final report format) is in `plan/phase1/agent-prompts/m5-bullet-5.md`. Read it fully, **except** its "Session instructions" and "How to deliver" sections, which this file replaces.

## Session instructions

You are on branch `feat/m5-dispatch-integrate`, cut from `feat/milestone-5-workflow` at commit `424b79d` (bullets 0 to 5 done, reviewed and accepted: `rm -r dist && npm test` passes 257 tests across 43 files). Run `git pull` first. Do not rework earlier bullets unless a test proves a bug.

**This session is bullet 6 only (dispatch and integrate).** Bullets 7, 8 and 9 are not yours. The final milestone merge, the interruptions bullet for dispatch/integrate and the smoke script happen after both tracks are merged.

## What to build (milestone-5.md §4 and §5, bullet 6)

- **Dispatch ends by itself (D65).** There is no Orchestrator process in dispatch. When every work ticket of the board is terminal in a good way (`merged`; `cancelled` tickets are ignored), or the board has zero tickets, the board moves to `integrate` and creates the integrate phase task in the same transaction as the move. Nothing may create it twice.
- **A last ticket that escalates is not a silent dead end.** The board must stay in `dispatch`, the workflow snapshot must set a `problem` string that names the ticket and the recovery command (`crew retry <ticket>` or `crew cancel <ticket>`), and recovery must move the board on. Another track renders `problem` in `crew status`; you only have to produce it (`Workflow.snapshot().problem`, already returned in `phases[].problem` by the status API). Do not edit `src/cli/commands/status.ts`.
- **Assignment by role** already exists in the Dispatcher. Prove with a three-ticket, two-role board that tickets go to staffed roles.
- **Worker questions during dispatch go to the human (D65).** Test it through the real `crew ask` / `crew answer`.
- **Integrate (D63, D60):** the Orchestrator phase task reviews role learnings, may promote them with `crew memory promote` (allowed only in integrate), rewrites the project summary and writes a release summary through `crew phase done --output`. The project-summary rewrite is a stored **project memory entry with a visible source** (for example `phase:integrate:<draft-id>`), never a file edit in the user's checkout. Approving the integrate gate moves the board to `done` (an ungated integrate does the same). Write the integrate phase instructions in `src/server/workflow/phases.ts` so they name these steps and the commands.
- **Headline test (milestone-5.md §5, bullet 6):** a three-ticket board with one dependency goes from grill to `done` through the real pipeline harness, the default branch holds all three tickets' changes, the summary memory entry exists, and the gate approvals went through the real human CLI.
- **Race and failure tests to write now (not later):**
  - the last ticket merging while a human cancels another ticket: the board moves to integrate exactly once;
  - the integrate gate approved twice concurrently: acts once, board `done` once;
  - stop-all during integrate, then resume;
  - server restart while in dispatch after the last ticket merged but before the integrate task existed: the engine picks up and creates exactly one integrate task; restart in integrate with a draft: gate survives;
  - integrate phase run that crashes or hangs: recovered with `crew retry` (reuse the bullet 4 mechanism; prove it for integrate);
  - a zero-ticket board, and a board whose only tickets were cancelled.
- Every failure path needs a human command that moves it on, with a test.

## Parallel work rules (important, avoids merge conflicts)

- **You own:** `src/server/workflow/*`, `src/server/scheduler/*`, the engine-related parts of `src/server/api/app.ts`, and new tests such as `test/harness/dispatch-integrate.test.ts`.
- **The other track owns:** `src/cli/commands/status.ts`, `src/cli/declarations.ts`, `docs/commands.md`, `src/adapters/*` and tests for status/tasks filters/the Read-deny rule. Do not edit those. If you believe you need a CLI change, describe it in your report instead.
- **Do not edit** `plan/phase1/handoff.md`, `plan/phase1/START_HERE.md` or `plan/phase1/milestone-5.md`. The reviewer merges the two tracks and updates them. Put your proposed decisions (what would have gone into §9) in your report file under "Deviations and proposed decisions".
- You may update `docs/architecture/project-structure.md` only on the lines about the files you add or change.
- No new migration unless a test proves one is needed. If you add one, say so at the top of your report.
- No new dependencies.

## How to deliver (the reviewer cannot see your chat)

1. Commit the implementation with `feat(m5): bullet 6 - Dispatch and integrate` (tests and architecture-doc lines in the same commit). `rm -r dist && npm test` must pass first.
2. Write the report, in the "Final report" format at the end of `m5-bullet-5.md`, to **`plan/phase1/reports/m5-bullet-6.md`**. Cover bullets 0 to 9: 0 to 5 as "previously done", 6 as yours, 7 to 9 as "not this track". Paste the real `npm test` summary and the real `git diff --stat feat/milestone-5-workflow...HEAD` output. Make the commit list and the diff stat accurate for the final HEAD, and do not describe a commit as "follow-up" or "unpushed" unless it is. State every claim you did not verify.
3. Commit the report as its own commit `docs(m5): bullet 6 report`, then `git push origin feat/m5-dispatch-integrate` (a normal push, never force, never `main`, never print credentials or remote URLs).
4. If the push fails, say so at the top of the report, still commit it, and stop.
5. In chat, only say the report is pushed and give the final commit hash.
