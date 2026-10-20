# Project Structure

The folder layout of the Crew repository. Milestones 1 (core), 2 (runner, worktrees, dispatcher, safety, Claude Code adapter, human CLI) and 3 (verification pipeline, diff gate, command gates, reviewer gate, stop hook, human CLI) are implemented. Milestone 4 is in progress: bullets 0–4 (through merge re-verification feedback) are implemented; conflicts, recovery, human CLI and the manual smoke remain. It is based on `docs/Crew Design Doc.md` and updated with the decisions in `plan/phase1/prd.md` (Decision Log D1–D46).

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
├─ scripts/               # Dev scripts: generate-docs.ts, smoke-milestone-2.ts, smoke-milestone-3.ts (`npm run smoke:m3`, manual)
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
│     ├─ milestone-3.md   # Milestone 3 plan: verification gates, retries, Reviewer, Stop hook (implemented)
│     ├─ milestone-4.md   # Milestone 4 plan: merge queue, rebase, conflict sub-tasks (bullets 0–4 implemented)
│     └─ handoff.md       # Latest session handoff
├─ src/
│  ├─ cli/                # Agent commands (thin HTTP clients, shared in client.ts): join, next, update, ask, remember, done, review, hook (hidden), phase, ticket, assign
│  │                      # Human commands: start, init, status, stop-all, resume (D23), worktree gc,
│  │                      #   approve, answer, memory, cancel (D2), tasks, logs, diff (D16), results
│  │                      # Command declarations here are the single source for --help and docs/commands.md (D3)
│  ├─ server/
│  │  ├─ api/             # REST + SSE endpoints, Host-header and token checks (D13)
│  │  ├─ db/              # Drizzle schema and migrations (SQLite in ~/.crew, D12)
│  │  ├─ scheduler/       # Task state machine and dependencies (index.ts), dispatcher with the parallel-agent limit (dispatcher.ts)
│  │  ├─ runner/          # Child-process spawn with structured events, timeouts, kill, resume (D4, D5)
│  │  ├─ worktree/        # Create, set up, clean up and gc task worktrees; interrupt setup on stop/cancel
│  │  ├─ verify/          # Gate pipeline: diff → commands → review (D8, D10); command-runner.ts is shared with worktree setup (D45)
│  │  ├─ merge/           # Serial merge queue, detached integration worktree, rebase, re-verification, squash/rebase strategies, safe checkout/ref updates cleanup and re-verification feedback (D38–D42); conflict tasks pending
│  │  ├─ memory/          # Layers, injection budget, promotion (D15)
│  │  └─ events/          # In-process event bus behind SSE
│  ├─ adapters/           # claude-code, codex, fake (antigravity later, D17)
│  ├─ workflows/          # Orchestrator phases: grill, spec, tickets, dispatch, integrate
│  └─ roles/              # Built-in roles: orchestrator, architect, backend, frontend, qa, reviewer
├─ ui/                    # Board UI (Vite + React), built and served by the server
└─ test/
   ├─ tsconfig.json       # Typecheck config for everything (npm run typecheck)
   ├─ global-setup.ts     # Builds dist/ so tests drive the current crew binary
   ├─ harness/            # In-process pipeline harness (index.ts) plus the pipeline tests: runner, worktree, timeouts, dispatcher, ask/resume, stop-all, rate limits, cancel, human CLI, verification gates, stop hook, worktree setup, merge queue
   ├─ adapters/           # Adapter contract tests
   └─ fixtures/           # Recorded stream-json / --json output, incl. rate-limit and hook-blocked samples (D5, D7, D26)
```

## Runtime folders (outside the repo)

Crew writes its state to the user's machine, not to the repo it manages (D12):

```text
~/.crew/
├─ crew.db                # One SQLite database for all workspaces
├─ server.json            # URL, per-start secret and pid of the running server, mode 0600; deleted on shutdown (D25)
├─ stopped                # Marker file: dispatch stays stopped until `crew resume` (D23)
├─ rate-limits.json       # Persisted rate-limit pauses and backoff step (D7)
├─ claude-settings.json   # Stop hook settings passed to Claude Code via --settings (D26, D36)
├─ hook-stops/            # Per-run block counters for crew hook stop (D36)
├─ integration/           # <workspace-id>/ detached git worktree for serial merge processing (D38)
├─ snapshots/             # Main-checkout `git status` at run start, one file per run, until the diff gate decides (D31)
├─ bin/                   # `crew` shim put on the agent's PATH
├─ logs/                  # Run logs (agent event streams, <run-id>.jsonl)
└─ worktrees/
   └─ <workspace>/<task-id>/   # One git worktree per task, branch crew/<task-id>-<slug>
```

Each repo that *uses* Crew gets a `crew.config.ts` at its root, created by `crew init`.

## Notes

- `src/server/events/` and `test/` were added beyond the design doc's tree, to make the event bus and the test seams from the PRD explicit.
- `node-pty` and PTY code are not part of spawn mode (D5).
- Successful worktree setup is recorded as `crew-setup-complete` inside that worktree's private Git directory. It survives server restarts, is removed with the worktree, and adds no tracked files. Interrupted setup is run again on resume.
