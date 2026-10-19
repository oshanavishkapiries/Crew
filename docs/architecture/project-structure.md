# Project Structure

The folder layout of the Crew repository. Milestones 1 (core) and 2 (runner, worktrees, dispatcher, safety, Claude Code adapter, human CLI) are implemented. It is based on `docs/Crew Design Doc.md` and updated with the decisions in `plan/phase1/prd.md` (Decision Log D1–D37).

**Keep this file current.** When a folder is added, removed, renamed or changes purpose, update this document in the same change.

## Tree

```text
crew/
├─ AGENTS.md              # Rules for AI agents working on this repo (CLAUDE.md points here)
├─ CLAUDE.md              # Claude Code entry point; imports AGENTS.md
├─ README.md            # Banner, short intro and doc index
├─ package.json           # "bin": { "crew": "dist/cli.js" }, run with `npx crew`
├─ tsconfig.json          # Compiler settings for src/
├─ tsup.config.ts         # Bundles src/ into dist/ (cli.js, index.js)
├─ vitest.config.ts       # Test config; global setup builds dist/ before tests
├─ drizzle.config.ts      # drizzle-kit config for generating migrations
├─ drizzle/               # Generated SQL migrations and snapshots (drizzle-kit)
├─ scripts/               # Dev scripts: generate-docs.ts (docs/commands.md), smoke-milestone-2.ts (`npm run smoke`, real Claude Code, manual)
├─ docs/
│  ├─ Crew Design Doc.md  # Original product design (the PRD overrides it where they differ)
│  ├─ commands.md         # Commands reference, generated from CLI declarations (D3)
│  └─ architecture/
│     ├─ project-structure.md   # This file
│     └─ project-techstack.md   # Runtime, libraries and tooling
├─ plan/
│  └─ phase1/
│     ├─ START_HERE.md    # Onboarding for AI agents: context and how to start implementing
│     ├─ prd.md           # Phase 1 PRD: the whole first release
│     ├─ milestone-2.md   # Milestone 2 plan: runner and core safety (implemented)
│     ├─ milestone-3.md   # Milestone 3 plan: verification gates, retries, Reviewer, Stop hook (approved)
│     └─ handoff.md       # Latest session handoff
├─ src/
│  ├─ cli/                # Agent commands (thin HTTP clients, shared in client.ts): join, next, update, ask, remember, done, phase, ticket, assign
│  │                      # Human commands: start, init, status, stop-all, resume (D23), worktree gc,
│  │                      #   approve, answer, memory, cancel (D2), tasks, logs, diff (D16)
│  │                      # Command declarations here are the single source for --help and docs/commands.md (D3)
│  ├─ server/
│  │  ├─ api/             # REST + SSE endpoints, Host-header and token checks (D13)
│  │  ├─ db/              # Drizzle schema and migrations (SQLite in ~/.crew, D12)
│  │  ├─ scheduler/       # Task state machine and dependencies (index.ts), dispatcher with the parallel-agent limit (dispatcher.ts)
│  │  ├─ runner/          # Child-process spawn with structured events, timeouts, kill, resume (D4, D5)
│  │  ├─ worktree/        # Create, clean up and gc task worktrees
│  │  ├─ verify/          # Gate pipeline: diff → commands → review (D8, D10)
│  │  ├─ merge/           # Merge queue, integration worktree, rebase, conflict tasks (D11)
│  │  ├─ memory/          # Layers, injection budget, promotion (D15)
│  │  └─ events/          # In-process event bus behind SSE
│  ├─ adapters/           # claude-code, codex, fake (antigravity later, D17)
│  ├─ workflows/          # Orchestrator phases: grill, spec, tickets, dispatch, integrate
│  └─ roles/              # Built-in roles: orchestrator, architect, backend, frontend, qa, reviewer
├─ ui/                    # Board UI (Vite + React), built and served by the server
└─ test/
   ├─ tsconfig.json       # Typecheck config for everything (npm run typecheck)
   ├─ global-setup.ts     # Builds dist/ so tests drive the current crew binary
   ├─ harness/            # In-process pipeline harness (index.ts) plus the pipeline tests: runner, worktree, timeouts, dispatcher, ask/resume, stop-all, rate limits, cancel, human CLI
   ├─ adapters/           # Adapter contract tests
   └─ fixtures/           # Recorded stream-json / --json output, incl. rate-limit samples (D5, D7)
```

## Runtime folders (outside the repo)

Crew writes its state to the user's machine, not to the repo it manages (D12):

```text
~/.crew/
├─ crew.db                # One SQLite database for all workspaces
├─ server.json            # URL, per-start secret and pid of the running server, mode 0600; deleted on shutdown (D25)
├─ stopped                # Marker file: dispatch stays stopped until `crew resume` (D23)
├─ rate-limits.json       # Persisted rate-limit pauses and backoff step (D7)
├─ bin/                   # `crew` shim put on the agent's PATH
├─ logs/                  # Run logs (agent event streams, <run-id>.jsonl)
└─ worktrees/
   └─ <workspace>/<task-id>/   # One git worktree per task, branch crew/<task-id>-<slug>
```

Each repo that *uses* Crew gets a `crew.config.ts` at its root, created by `crew init`.

## Notes

- `src/server/events/` and `test/` were added beyond the design doc's tree, to make the event bus and the test seams from the PRD explicit.
- `node-pty` and PTY code are not part of spawn mode (D5).
