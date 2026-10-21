# Milestone 7, session 2: bullets 2 and 3 (Pull mode: join/next/heartbeat and completion path)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

## Session instructions

Work on branch `feat/milestone-7-breadth` (`git pull` first). Bullets 0 and 1 (Codex) are done, reviewed and accepted (`rm -r dist && npm test`: 54 files, 362 tests). **This session is bullets 2 and 3 of `plan/phase1/milestone-7.md` only. Stop after bullet 3.** Bullets 4 to 6 (stale detection, UI, smoke) stay "not started"; heartbeat *recording* (D91) belongs here, the stale *scanner* does not.

Read first, in order: `AGENTS.md`, `plan/phase1/START_HERE.md`, `plan/phase1/milestone-7.md` (§4.2, §5, §6, §7), the PRD Decision Log (D13, D17, D19, D22, D89 to D93), PRD stories 41 and 66 to 71, the PRD API contract (`/api/agents/join`, `next-task?wait=90`, `heartbeat`), `docs/architecture/*`, `plan/phase1/handoff.md`, and the code you will touch: `src/server/scheduler/dispatcher.ts`, `src/server/runner/index.ts`, `src/server/api/app.ts`, `src/server/api/security.ts`, `src/cli/declarations.ts` (`join` and `next` are declared but have no handlers or endpoints), `agents.mode`/`lastHeartbeatAt` in the schema.

### Bullet 2: join, next, heartbeat
- `POST /api/agents/join`: agent token in, role, persona, rules, workDir and project memory out (same context a spawned agent gets); marks the agent connected and sets `lastHeartbeatAt`. Only `mode = 'pull'` agents may join; a spawn agent token gets a clear 403.
- `GET /api/agents/:id/next-task?wait=N` (N capped below 90 s): long-poll. When a task is dispatchable for this Pull agent, provision it exactly as the Dispatcher does for spawn agents (worktree, setup, branch, `ready → doing`, run record, prompt from the same prompt builder; D89) and return it with the full prompt. The only difference: nothing is spawned. No task before the wait ends: return `{ retryIn }` and make the CLI tell the agent to call again. The Dispatcher must never spawn for a Pull agent, and two concurrent `next` calls must not double-assign.
- `POST /api/agents/:id/heartbeat`, and every authenticated `crew` call from a Pull agent refreshes `lastHeartbeatAt` (D91). No background heartbeat process.
- CLI handlers for `crew join --token` and `crew next --wait`, with the output an AI agent can act on (clear instructions, token never echoed). `docs/commands.md` is regenerated from declarations, never hand-edited.
- Auth: an agent token only reaches its own agent's endpoints; humans (secret/cookie) cannot use agent endpoints; test the isolation (see how milestone 2 to 5 tests prove it).

### Bullet 3: completion path
- A Pull agent's `update`, `ask`, `remember`, `done` work through the existing endpoints with its run/task; `crew done` goes through verification, review, retries and merge exactly as for spawn agents (story 70). Prove it end to end in the harness: Pull task → `done` → verifying → review → merge-queue → merged, including a failed gate returning feedback to the Pull agent on its next `crew next` or via the `done` response.
- After `crew done`, the response tells the agent to clear its context and run `crew join` again (story 68).
- `crew ask` for a Pull agent: no child to resume, so the answer is delivered on the agent's next `crew` call or `crew next`; test it.
- Pull runs have no pid (D92): `crew logs`/`status` must cope; Stop-all and `crew cancel` mark the task and the agent learns on its next call (clear message); no process kill attempted; the startup reaper must ignore pid-less runs.
- Test with the fake adapter driven through the real CLI as a "pull agent" process (spawn `crew join`/`crew next`/`crew done` as child processes with the agent token), and the injected clock where timing matters. No real paid agents.

## Rules
- Test external behaviour through the pipeline harness; no mocking of the DB. Keep it simple; describe narrow windows in `milestone-7.md` §9 instead of building infrastructure for them.
- Docs in the same commits: `docs/commands.md` (generated), `docs/architecture/project-structure.md`, PRD API section if it changes, `milestone-7.md` §9 notes/limitations, `plan/phase1/handoff.md`.
- One fresh re-read of your own diff before the report.

## How to deliver
1. Commit on `feat/milestone-7-breadth` (bullet commits, then docs). Never touch `main`.
2. Write the final report to **`plan/phase1/reports/m7-bullet-2-3.md`**: what changed, files, real output of `rm -r dist && npm test` (clean build), failures you hit and how you fixed them, limitations, anything unverified, decisions for the reviewer. Commit it, then `git push origin feat/milestone-7-breadth`.
3. If the push fails, say so at the top of the report, commit it, and stop. Never force-push, never print or store credentials.
4. In chat, only say the report is pushed and give the commit hash.
