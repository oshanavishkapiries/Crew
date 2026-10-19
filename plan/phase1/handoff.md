# Handoff: Crew Phase 1 — Milestone 1 (Core) Complete

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Branch: `feat/milestone-1-core`. Milestone 1 is committed (`51a6a96`); the review fixes below are uncommitted, waiting for the user's review.
- **Milestone 1 (Core) is fully implemented and tested:**
  1. **Scaffolding:** `package.json` with `"bin": { "crew": "./dist/cli.js" }`, TypeScript (ESM, NodeNext), Vitest, pinned exact versions. `crew --help` works directly.
  2. **Commands reference generator & staleness test (D3):** `src/cli/declarations.ts` is the single source of truth for Commander CLI and markdown reference. `scripts/generate-docs.ts` generates `docs/commands.md`. `test/commands-reference.test.ts` fails if `docs/commands.md` drifts.
  3. **Crew home and database (D12, D20):** SQLite database initialized at `~/.crew/crew.db` (overrideable with `CREW_HOME` per D20). Complete Drizzle schema for all 12 PRD tables (`workspaces`, `boards`, `roles`, `agents`, `tasks`, `task_dependencies`, `runs`, `verification_results`, `messages`, `memory`, `phase_outputs`, `merge_queue_items`) with foreign keys and WAL mode.
  4. **Server & Security (D13):** Hono HTTP server bound to `127.0.0.1` with DNS-rebinding Host-header check middleware and SSE streams (`/api/board/:id/events` and `/api/runs/:id/stream`). Agent endpoints check the hashed agent token (`X-Crew-Agent-Token`) and the task's assignee; human endpoints and SSE need the per-start secret (`X-Crew-Secret`).
  5. **State machine & scheduler:** Task state machine with all transitions, retry counting, escalation on retry limit (default 3), and dependency resolution (downstream tasks stay in `todo` until blockers are `merged`, with automatic promotion to `ready`).
  6. **Fake adapter and in-process pipeline harness:** `FakeAdapter` in `src/adapters/fake.ts` running scripted `crew` CLI calls and structured events. Pipeline harness in `test/harness/index.ts` boots in-process server, temporary git repo, and drives real `crew update` and `crew done` calls from `todo` to `verifying`.
- `npm test` typechecks, builds `dist/` and runs 27 tests across 6 suites (adds `test/harness/agent-commands.test.ts`).

## Review fixes (uncommitted)

A review of milestone 1 found and fixed:

1. **No auth (D13, user story 125):** tokens and the per-start secret existed but were never checked. Now 401 for missing or unknown credentials, 403 when an agent touches a task not assigned to it.
2. **Tests ran a stale build:** the harness calls `dist/cli.js`, which nothing rebuilt. `test/global-setup.ts` now builds before every run.
3. **Type errors:** `tsc` had 2 errors and nothing ran it. Added `npm run typecheck` (`test/tsconfig.json`, also covers tests and scripts) and made `npm test` run it first.
4. **Stub commands exited 0:** e.g. `crew stop-all` looked like it worked. They now print to stderr and exit 1.
5. **Non-atomic writes:** `createTask`, dependency inserts and transitions run in one SQLite transaction, and events publish only after commit. A transition's extra writes (the agent's message) go through `TransitionContext.alongside`. A missing blocker throws `TaskNotFoundError`.
6. **500s for expected errors:** the API maps not-found to 404 and refused transitions or cycles to 409.
7. **Shell quoting in the fake adapter:** it now runs `crew` with `execFileSync`, no shell.
8. **IPv6 Host header:** `[::1]:4000` is parsed correctly.

## Open items

- `package.json` points `"types"` at `dist/index.d.ts`, but `tsup` runs with `dts: false`, so no declarations are emitted. Decide whether the package needs types before publishing.
- The Board's SSE streams need the per-start secret, but `EventSource` can't send headers (PRD open questions, milestone 6).
- Unimplemented commands are still listed in `--help`. They fail clearly, and each lands with its milestone (D2).

## Decisions added

- **D20 (Claude-decided):** The Crew home directory defaults to `~/.crew` and can be overridden by the `CREW_HOME` environment variable, enabling isolated test environments with temporary databases, worktrees, and logs.

## Suggested next steps

- **Milestone 2: Runner and core safety**
  - Adapter interface & Claude Code adapter (`claude -p --output-format stream-json --session-id <uuid>`)
  - Structured-event runner with session resume (D4, D5, D6)
  - Worktree manager: create `crew/<task-id>-<slug>` branches and worktrees under Crew home
  - Core safety: permission profile mapping, `crew stop-all`, budget and loop limits, and Claude Code rate-limit handling (D19).
