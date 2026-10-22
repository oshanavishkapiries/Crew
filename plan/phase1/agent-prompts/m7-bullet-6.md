# Milestone 7, session 4: bullet 6 (smoke script and final docs)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

## Session instructions

Work on branch `feat/milestone-7-breadth` (`git pull origin feat/milestone-7-breadth` first; if the local rebase setting trips on the unrelated whitespace edit in `src/server/scheduler/tickets.ts`, use `git pull --no-rebase --ff-only`, and leave that edit out of every commit). Bullets 0 to 5 are done, reviewed and accepted (`rm -r dist && npm test`: 58 files, 400 tests; `npm run build:ui`; UI checks 22). **This session is bullet 6 only.** Do not change product behavior; if the smoke exposes a real bug, report it with evidence and, only if the fix is small and clearly inside milestone 7 code, fix it with a regression test in a separate commit.

Read first: `AGENTS.md`, `plan/phase1/START_HERE.md`, `plan/phase1/milestone-7.md` (all of it, including §9 notes from sessions 1 to 3), `plan/phase1/reports/m7-bullet-0-1.md`, `m7-bullet-2-3.md`, `m7-bullet-4-5.md`, `scripts/smoke-milestone-5.ts` (the pattern: manual only, typechecked, never in `npm test`, bounded runs/deadline/budget), `scripts/smoke-milestone-3.ts` and `-4.ts`.

### The smoke: `scripts/smoke-milestone-7.ts` (`npm run smoke:m7`)
Manual, paid, **never run by `npm test`**; typechecked by `npm test`'s typecheck like the others. In a throwaway git repo and throwaway `CREW_HOME`, with real adapters, prove the milestone 7 claims:

1. **Codex worker:** a `cliType: codex` agent (config `team` entry) takes a tiny task (create one file, run `crew done`). Assert: dispatch via the real Codex adapter, the sandbox flags used, `crew done` succeeded through the localhost API (network default, D88), verification passes, the task reaches merge-queue and merged.
2. **Codex Reviewer with a Claude author** (or the reverse if only one tool is available): a task authored by one tool is reviewed by the other (D8); the Reviewer calls `crew review approve`; assert it edited no files (check `git status` of the worktree before the merge).
3. **Pull agent:** a `mode: pull` Antigravity-typed agent (no real Antigravity needed: the script itself plays the terminal agent by running the real `crew join`, `crew next --wait`, edit, `crew done` as child processes with the token from `crew connect`), takes a task through verification, review and merge. Assert: no process was spawned for it, `crew done` told it to rejoin, the run has no pid.
4. **Stale:** with a short `staleAfterMs` (document the one-second precision), a second Pull task is taken by a Pull agent that then goes silent; assert the task is requeued with zero retries charged, the branch is kept, another Pull agent (or the same after `join`) completes it, and the old run ID is refused.
5. **Rate-limit or stop-all on a Codex run** only if it can be done without provoking a real provider limit: use stop-all/resume (no retry charge). Never try to trigger a real rate limit.

Bounds like milestone 5: a hard run cap, a deadline, a Claude budget flag, Codex runs kept tiny, no retry loops, everything cleaned up (processes, temp dirs), tokens never printed. Detect missing/unauthenticated tools and say which steps were skipped instead of failing silently. The script must be safe to read before running: put the expected maximum number of runs and rough cost drivers at the top.

You **may run it once** if both tools are installed and logged in on this machine (they are on the user's machine; the user has authorized small paid runs for fixtures and probes). If it fails, record the real output, fix only the script, and run at most once more. If you cannot run it, say so plainly. Never claim a step passed that did not run.

### Final docs
- `plan/phase1/milestone-7.md`: status "done" (or exactly what is not), §9 final notes, smoke instructions, known limitations consolidated (Codex per-command rules, workspace-write network, Reviewer edit risk, grace rule, Pull terminal agents are not sandboxed, one-second heartbeat precision).
- `plan/phase1/START_HERE.md`, `plan/phase1/handoff.md` (rewrite the top as the state after milestone 7; next is milestone 8, the manual end-to-end run with a mixed team), `README.md` (quick start mention of Codex/Pull agents and `crew connect`, if it fits), `docs/architecture/project-structure.md` and `project-techstack.md` (scripts list, smoke command), `docs/commands.md` regenerated if needed, PRD only where a statement is now wrong.
- Remove the milestone 7 agent prompts (`plan/phase1/agent-prompts/m7-*.md`) from the tree in the final commit and fix references (git history keeps them); keep the `m5-bullet-5.md` template.

## Rules
- Keep it simple. One fresh re-read of your own diff before the report.
- Verification to paste in the report: `rm -r dist && npm test` (clean), `npm run build:ui`, `npm --prefix ui run check`, and the smoke output if run.

## How to deliver
1. Commit on `feat/milestone-7-breadth` (script commit, then docs commit). Never touch `main`.
2. Write the final report to **`plan/phase1/reports/m7-bullet-6.md`**: what changed, files, real command output, per-step smoke results (ran / skipped / failed and why), estimated cost/tokens, limitations, anything unverified. Commit it, then `git push origin feat/milestone-7-breadth`.
3. If the push fails, say so at the top of the report, commit it, and stop. Never force-push, never print or store credentials or agent tokens.
4. In chat, only say the report is pushed and give the commit hash.
