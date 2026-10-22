# Start Here

You're an AI agent about to work on Crew. This page gives you the context you need and tells you how to start implementing. Read it fully before you write any code.

## 1. The project in one minute

Crew is a CLI tool (`npx crew`) that turns AI coding agents like Claude Code and Codex into a dev team. It runs a local server and web Task Board. For every task it spawns a fresh agent in its own git worktree, injects memory and context, checks the work itself (diff, lint, typecheck, tests, review agent), and merges verified work into the local main branch through a merge queue. Memory, roles and workflow live in Crew, not in the AI tool, so agents are replaceable workers.

## 2. Read these, in this order

1. [AGENTS.md](../../AGENTS.md): the rules. The most important one: **update the docs in the same change as the code.**
2. [plan/phase1/prd.md](prd.md): what to build. Read the **Decision Log** at the top first. It overrides the design doc wherever they disagree.
3. [docs/architecture/project-structure.md](../../docs/architecture/project-structure.md): where code goes.
4. [docs/architecture/project-techstack.md](../../docs/architecture/project-techstack.md): what to build it with.
   - Working on milestone 4? It is done; [milestone-4.md](milestone-4.md) records the design. Decisions D38–D55.
   - Working on milestone 7 (Codex, Pull mode, heartbeat)? Read [milestone-7.md](milestone-7.md): design, tracer bullets and decisions D88–D93 (approved).
   - Working on milestone 6 (Board UI)? Read [milestone-6.md](milestone-6.md): design, tracer bullets and decisions D82–D87. D80–D87 are decided.
   - Working on milestone 5? Read [milestone-5.md](milestone-5.md): the approved design and tracer bullets. Decisions D56–D65 (approved).
   - Working on milestone 3? Read [milestone-3.md](milestone-3.md): the design, tracer bullets and decisions D29–D37 (approved).
   - Working on milestone 2? Read [milestone-2.md](milestone-2.md) next: the design, the tracer bullets and decisions D21–D26.
5. [plan/phase1/handoff.md](handoff.md): what the last session did and left open.
6. [docs/Crew Design Doc.md](<../../docs/Crew Design Doc.md>): background only. Skim it for the "why".

## 3. Where things stand

**Status:** milestones 1–6 are done. Milestone 7 implementation (bullets 0–6)
is complete on `feat/milestone-7-breadth`: Codex spawn/resume, Pull transport,
heartbeat/stale recovery, Antigravity connect and Team/Board status, plus the
manual smoke. Smoke steps 1/3/4/5 passed with real Codex; mixed-tool step 2 was
**skipped because Claude authentication was unavailable**. Do not count it as a
pass. See [milestone 7](milestone-7.md) §9 and [session 4 report](reports/m7-bullet-6.md)
for exact verification, both attempts, cost bounds and limitations. Final clean
suite: 58 files / 400 tests; UI build and 22 client checks passed. Decisions
D1–D93 are approved. Milestone 7 task prompts are retired in git history.

- The engine, safety, verification, local merge queue, config, memory and full
  grill → spec → tickets → dispatch → integrate workflow are implemented.
  Milestone 5's real Claude smoke passed on 2026-10-21.
- The static Next.js Board, browser auth, Inbox, gates, Team, Memory, persisted
  ticket edits and per-run log history are implemented; milestone 6's manual
  browser checklist passed. Root tests never build the UI; run `npm run build:ui`.
- `npm test` typechecks source/tests/scripts, rebuilds the CLI and uses real git,
  SQLite, fake process adapters and recorded fixtures. It never runs paid smokes.
  `npm run smoke:m7` is manual and paid; read its seven-launch/deadline/budget
  limits before running. Missing tools/auth produce named skips.
- **Next: milestone 8 (plan: milestone-8.md)**, the manual end-to-end run on a real project with a mixed
  Claude Code + Codex team. Restore Claude authentication and close the live mixed
  review validation gap in an authorized run. Do not start milestone 8 without
  the user's instruction. Public release and package publication remain pending.

## 4. Things that are easy to get wrong

- **No PTY.** Spawned agents run as plain child processes with structured JSON output (`stream-json` for Claude Code, `--json` for Codex). Don't add `node-pty` (D5).
- **Crew never pushes.** It merges into the local default branch only, and never touches uncommitted work in the user's checkout (D11).
- **Safety comes early.** Permissions, stop-all, budget and loop limits, and Claude Code rate-limit handling belong to milestone 2, not milestone 7 (D19).
- **One source for commands.** CLI command declarations generate both `--help` and `docs/commands.md`, and a test fails if they drift (D3).
- **Everything humans do on the Board can also be done in the CLI** (D2).
- **Test behaviour, not internals.** Use the in-process pipeline harness (real server, temp git repo, fake adapter) as the main seam, plus adapter contract tests on recorded fixtures.
- **Localhost only.** Bind to 127.0.0.1, check the Host header, and store agent tokens hashed (D13).

## 5. How to start implementing

Work milestone by milestone, in the PRD's build order. Each milestone is built from **tracer bullets**: thin slices that run end to end and are tested through the harness, rather than one layer at a time.

### Before you write code

1. Read the current handoff and the user's assigned milestone/task prompt; follow an already authorized scope without restarting planning.
2. Create a branch off `main`. Don't commit or push unless the user asks (see AGENTS.md).

### Milestone 1: Core

Goal: server, SQLite, the full data model, the task state machine and the fake adapter, all proven by the harness.

Suggested tracer bullets, in order:

1. **Scaffold.** `package.json` with the `crew` bin, TypeScript, Vitest, and a `crew --help` that works. Add the commands reference generator and its staleness test right away (D3). Pin versions, and update `project-techstack.md`.
2. **Crew home and database.** Drizzle schema for the **whole** data model in the PRD, including `sessionId`, `resumedFromRunId` and `tokenHash`, with migrations. The DB lives under the Crew home (`~/.crew`, D12). Tests need a temporary home, so add an override (for example a `CREW_HOME` env var) and log it as a new Decision Log entry.
3. **Server.** `crew start` boots Hono on 127.0.0.1 with the Host-header check (D13) and an SSE events endpoint.
4. **State machine.** All task states and transitions from the PRD in the scheduler, as the only writer of task status. Invalid transitions are rejected.
5. **Tasks and dependencies.** Create workspaces, boards and tasks with dependencies. A task becomes `ready` only when its blockers are `merged`.
6. **Fake adapter and harness.** Build the in-process pipeline harness: real server, temp git repo, fake adapter running scripted real `crew` CLI calls. The first end-to-end test drives a task from `todo` to `verifying` through `crew update` and `crew done`.

Milestone 1 is done when the harness tests pass, every state transition (valid and invalid) is covered, the commands reference is generated and checked, and the architecture docs match the code.

### After each milestone

- Run the full test suite.
- Check every doc in the AGENTS.md table against your diff.
- Update [plan/phase1/handoff.md](handoff.md) with what's done, what's next and anything left open.
- Tell the user, and wait for their go-ahead before starting the next milestone.

## 6. When you're unsure

- The PRD and its Decision Log answer most questions. Search them first.
- If a decision is genuinely missing, ask the user. Keep it to one question at a time with your recommended answer, and record the answer in the Decision Log.
- Never quietly change a decided item. Propose the change, and log it if the user agrees.
