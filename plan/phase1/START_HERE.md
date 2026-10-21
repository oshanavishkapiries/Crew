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

**Status:** milestones 1 to 5 are done: the engine, runner, verification, merge queue, config, memory and the whole grill → spec → tickets → dispatch → integrate workflow work from the CLI, and the manual smoke with real Claude Code passed (milestone 5, 2026-10-21). Milestone 6 (Board UI) bullets 0–5 are implemented and merged on `feat/milestone-6-board`: static hosting, browser sessions, `crew open`, Board view, task detail, Inbox, gates, Team and Memory. Track E closes ticket-edit persistence and per-run log history with CLI parity. The manual browser checklist passed and milestone 6 is on `main`. Next: milestone 7 (planned, D88–D93 approved). Decisions are logged as D1–D93.

- Planning is done: PRD, decisions D1–D93, architecture docs and agent rules.
- **Milestones 1, 2, and 3 are implemented and verified:**
  - Milestone 1: SQLite schema with Drizzle, Hono server on 127.0.0.1 with Host-header DNS rebinding check, D13 auth tokens/secrets, task scheduler state machine, and in-process pipeline harness.
  - Milestone 2: Drizzle migrations baseline with `runs.exitReason`, git worktree manager on dispatch, child process runner with process group kill on timeouts, parallel dispatcher (max 3), `crew ask` / `crew answer` with session resume and git diff fallback, `crew stop-all` / `crew resume`, rate limit pause and backoff schedule, Claude Code adapter with contract tests and recorded fixtures, and human CLI (`status`, `tasks`, `diff`, `logs`, `cancel`, `worktree gc`, `answer`).
  - Milestone 3: Verification pipeline with diff gate (auto-commit, empty diff rejection, out-of-worktree check), command gates with picomatch path matching and process group timeouts, reviewer gate with tool preference and read-only permission profile, `crew review approve|changes` with reviewer auth isolation, feedback prompt builder for retries, restart/stop-all/cancel interruption handling, Claude Code Stop hook with `<crewHome>/claude-settings.json` and hidden `crew hook stop`, `crew results` human CLI and `crew status` enhancements.
- **Milestone 4 is done:** bullets 0–7 implement worktree setup and a serial merge queue per workspace. Tasks rebase in a detached integration worktree, run matching verify commands again, squash onto the local default branch, clean up their branches/worktrees and promote dependents. Migration `0003` adds merge commit/output persistence. A clean default checkout is fast-forwarded under a prepared HEAD/ref transaction and index lock; a dirty default checkout pauses with its files preserved. Another branch or detached checkout uses compare-and-swap. A competing commit triggers rebase and re-verification, up to three attempts. The default squash strategy creates one task commit; `mergeStrategy: rebase` retains the rebased author commits. Re-verification failures return feedback to a fresh author with a retry; exhausted retries and integration setup failures escalate. Failed queue attempts reopen only after a new pipeline approval. Conflicts now create same-role sub-tasks that continue the branch in a fresh worktree; a merged child closes its parent, while depth limits and child cancellation/escalation escalate the parent. Terminal merge failures escalate with feedback and no retry charge; late checkout dirtiness pauses. Restart recovers all in-flight states and completes already-landed commits. Stop-all/cancel interrupt rebase, verification and integration setup and clean integration before reuse; a protected checkout publication finishes its transaction; conflict-parent cancellation cascades to its child. Human `crew queue`, `crew retry <task> [--note]` and status queue warnings are available; only the human retry entry point can leave escalation, resetting retries and recording feedback atomically. Bullet 8 is `scripts/smoke-milestone-4.ts` (`npm run smoke:m4`). The manual smoke (`npm run smoke:m4`) passed with real Claude Code on 2026-10-20: two tasks edited the same line, the second conflicted, a linked sub-task resolved it, a real Reviewer approved all three tasks and `main` got both commits. Next: milestone 5 (memory and workflow, then the private preview). Bullet 0 adds idempotent `crew init`, built-in roles/default team, config loading/validation and editing-role command prefixes. Bullet 1 adds ticket creation/assignment with Orchestrator-or-human authentication, durable phase quotas and blocker checks. Bullets 2–3 add scoped memory CRUD/promotion and one budgeted prompt builder for work, Reviewer, phase-task and fallback/resume runs. Bullet 4 adds phase tasks, durable gates, human approval/rejection, recovery commands and a verified scoped output-file profile. Bullet 5 adds grill Q&A through real dispatch, approved spec publication with provenance, and atomic ticket release at its human gate. Bullet 6 completes dispatch/integrate, including explicit promotions and sourced approved project/release summaries. Bullet 7 adds interruption and auth coverage, including a real built-server SIGKILL experiment that exposes orphan/duplicate agents. Bullet 8 adds phase/gate/recovery status, dispatch counts, task filters and generated help. Bullet 9 is `scripts/smoke-milestone-5.ts` (`npm run smoke:m5`), written and typechecked only. Next: review the unapproved §9 proposals and hard-crash policy, run the paid manual smoke, and decide preview packaging; repeated rejection limits and D28 remain open. The plan is approved: [milestone-5.md](milestone-5.md), decisions D56–D65.
- The final clean-build suite result and complete commit list are recorded in [reports/m5-final.md](reports/m5-final.md). `npm test` typechecks src, tests and scripts, rebuilds `dist/`, and exercises the fake-adapter harness and recorded adapter fixtures. It never runs the paid milestone 5 smoke.

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
