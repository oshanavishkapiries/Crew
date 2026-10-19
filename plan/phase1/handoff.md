# Handoff: Crew Phase 1 — Milestone 1 (Core) Complete

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Branch: `feat/milestone-1-core` (branched from `main`, uncommitted per AGENTS.md rules).
- **Milestone 1 (Core) is fully implemented and tested:**
  1. **Scaffolding:** `package.json` with `"bin": { "crew": "./dist/cli.js" }`, TypeScript (ESM, NodeNext), Vitest, pinned exact versions. `crew --help` works directly.
  2. **Commands reference generator & staleness test (D3):** `src/cli/declarations.ts` is the single source of truth for Commander CLI and markdown reference. `scripts/generate-docs.ts` generates `docs/commands.md`. `test/commands-reference.test.ts` fails if `docs/commands.md` drifts.
  3. **Crew home and database (D12, D20):** SQLite database initialized at `~/.crew/crew.db` (overrideable with `CREW_HOME` per D20). Complete Drizzle schema for all 12 PRD tables (`workspaces`, `boards`, `roles`, `agents`, `tasks`, `task_dependencies`, `runs`, `verification_results`, `messages`, `memory`, `phase_outputs`, `merge_queue_items`) with foreign keys and WAL mode.
  4. **Server & Security (D13):** Hono HTTP server bound to `127.0.0.1` with DNS-rebinding Host-header check middleware and SSE streams (`/api/board/:id/events` and `/api/runs/:id/stream`).
  5. **State machine & scheduler:** Task state machine with all transitions, retry counting, escalation on retry limit (default 3), and dependency resolution (downstream tasks stay in `todo` until blockers are `merged`, with automatic promotion to `ready`).
  6. **Fake adapter and in-process pipeline harness:** `FakeAdapter` in `src/adapters/fake.ts` running scripted `crew` CLI calls and structured events. Pipeline harness in `test/harness/index.ts` boots in-process server, temporary git repo, and drives real `crew update` and `crew done` calls from `todo` to `verifying`.
- All 15 tests pass across 5 test suites (`commands-reference.test.ts`, `db.test.ts`, `server.test.ts`, `scheduler.test.ts`, `pipeline.test.ts`).

## Decisions added

- **D20 (Claude-decided):** The Crew home directory defaults to `~/.crew` and can be overridden by the `CREW_HOME` environment variable, enabling isolated test environments with temporary databases, worktrees, and logs.

## Suggested next steps

- **Milestone 2: Runner and core safety**
  - Adapter interface & Claude Code adapter (`claude -p --output-format stream-json --session-id <uuid>`)
  - Structured-event runner with session resume (D4, D5, D6)
  - Worktree manager: create `crew/<task-id>-<slug>` branches and worktrees under Crew home
  - Core safety: permission profile mapping, `crew stop-all`, budget and loop limits, and Claude Code rate-limit handling (D19).
