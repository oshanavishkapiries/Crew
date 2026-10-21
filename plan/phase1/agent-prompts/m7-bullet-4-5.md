# Milestone 7, session 3: bullets 4 and 5 (stale detection; Antigravity and connect prompt; Team/Board status)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

## Session instructions

Work on branch `feat/milestone-7-breadth` (`git pull origin feat/milestone-7-breadth` first). Bullets 0 to 3 are done, reviewed and accepted (`rm -r dist && npm test`: 55 files, 378 tests). **This session is bullets 4 and 5 of `plan/phase1/milestone-7.md` only. Stop after bullet 5.** Bullet 6 (smoke script, final docs) stays "not started". Do not touch the unrelated whitespace edit in `src/server/scheduler/tickets.ts` if it is still in your tree; leave it out of your commits.

Read first, in order: `AGENTS.md`, `plan/phase1/START_HERE.md`, `plan/phase1/milestone-7.md` (§4.3 to §4.5, §5, §6, §7, and §9 notes from sessions 1 and 2), the PRD Decision Log (D17, D22, D90 to D93, D81, D84), PRD stories 69, 71, 111, 132, `plan/phase1/reports/m7-bullet-2-3.md`, `docs/architecture/*`, `plan/phase1/handoff.md`, and the code: `src/server/scheduler/dispatcher.ts`, `src/server/runner/index.ts`, `src/server/api/app.ts` (Pull endpoints), `src/server/project-config.ts` (`team` entries), `src/cli/commands/init.ts`, `src/cli/commands/status.ts`, and the Team and Board UI under `ui/`.

### Bullet 4: stale detection
- A scanner (in the server, on an injectable clock and interval) finds Pull agents that have a `doing` task (or an open Pull Reviewer/phase run) and whose `lastHeartbeatAt` is older than `staleAfterMs` (default 10 minutes, configurable in project config with validation; D90).
- On stale: end the pid-less run with exit reason `stale`, return the task to `ready` **without charging a retry**, keep its worktree/branch for the next assignee, mark the agent `stale`, and emit a board event. A Pull Reviewer or Orchestrator run going stale follows the same idea (re-queue the review/phase task through the existing paths); describe any case you cannot cover safely in `milestone-7.md` §9 instead of inventing infrastructure.
- Reconnect: a stale agent that calls `crew join`/`next` again becomes connected; its old task (and old run ID) is refused with a clear message and it is told to `crew join` for new work (reuse the retired-run-ID mechanism from session 2). A task already re-dispatched to someone else must not be touched.
- Restart recovery: after a server restart, stale evaluation uses persisted `lastHeartbeatAt` (do not mark everyone stale just because the server was down: decide, test and document the grace rule). Stop-all/resume interplay: a stopped board must not mark agents stale.
- Idle Pull agents (no task) are never "stale-requeued" (nothing to requeue); they simply show disconnected after the window. Spawn agents are unchanged.
- Tests through the harness with the injected clock: stale → requeue without retry charge, branch kept, second agent picks it up, reconnect refusal, restart grace, stop-all, idle agent, scanner overlap with a concurrent `done` (no double transition).

### Bullet 5: Antigravity, connect prompt, Team/Board status
- Pull agents need a way to exist: allow `team: [{ name, role, cliType, mode }]` in project config with `mode: 'pull'` (and `cliType: 'antigravity'` accepted, Pull-only, D17; reject `antigravity` with `mode: 'spawn'` clearly). `crew init`/`start` create them idempotently as session 1 did for Codex entries. Antigravity's adapter is `detect` only: report `headless: false`, never spawn.
- Connect prompt: a human way to get it. Add a human-only server endpoint and a CLI command (suggest `crew connect <agent-name>`; keep it the only new command and regenerate `docs/commands.md`) that prints the one-paste prompt: what Crew is, the agent token (shown once, only to the human, never logged), `crew join` and the `crew next --wait` loop, "after each `crew done` clear your context and run `crew join` again", and the instruction to add `crew *` to the tool's allowlist (story 71). If the token can only be shown at creation, say how it is rotated (the human command must mint a fresh token and invalidate the old one; test it).
- Status: `crew status` shows Pull agents with mode and connected / running / stale / rate-limited / disconnected. `/api/agents` (human) exposes `mode`, `status` including stale, `lastHeartbeatAt`; never `tokenHash`.
- UI (shadcn components only, D81; `ui/` package rules and pins unchanged): Team page shows mode badge and the full status including stale, last heartbeat as relative time, and a "Connect prompt" action for Pull agents that calls the human endpoint and copies the prompt (show it in a dialog with a copy button; never store it). Board agent badges show stale. Update `ui/lib` types and client checks (`npm --prefix ui run check`), and keep `npm run build:ui` green.
- Check the result in a real browser against a real `crew start` on a throwaway repo (as milestone 6 did): a Pull agent shown as disconnected/connected/stale (use a short `staleAfterMs`), connect prompt dialog works. Say exactly what you did and did not look at.

## Rules
- Test external behaviour through the pipeline harness; no DB mocking. Keep it simple; describe narrow windows in `milestone-7.md` §9.
- Docs in the same commits: `docs/commands.md` (generated), `docs/architecture/project-structure.md`, `docs/architecture/project-techstack.md` if you add anything, PRD (config section, API section, Decision Log only if a real product decision appears: say so in the report instead of silently adding one), `milestone-7.md` §9, `plan/phase1/handoff.md`, `plan/phase1/START_HERE.md` status line.
- One fresh re-read of your own diff before the report.

## How to deliver
1. Commit on `feat/milestone-7-breadth` (bullet commits, then docs). Never touch `main`.
2. Write the final report to **`plan/phase1/reports/m7-bullet-4-5.md`**: what changed, files, real output of `rm -r dist && npm test` (clean build), `npm run build:ui` and `npm --prefix ui run check`, browser evidence, failures hit and fixes, limitations, anything unverified, decisions for the reviewer. Commit it, then `git push origin feat/milestone-7-breadth`.
3. If the push fails, say so at the top of the report, commit it, and stop. Never force-push, never print or store credentials or agent tokens in the report.
4. In chat, only say the report is pushed and give the commit hash.
