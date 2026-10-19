# Project Structure

The folder layout of the Crew repository. Milestone 1 (Core: CLI, server, database, scheduler, events, fake adapter, test harness) is implemented. It is based on `docs/Crew Design Doc.md` and updated with the decisions in `plan/phase1/prd.md` (Decision Log D1–D20).

**Keep this file current.** When a folder is added, removed, renamed or changes purpose, update this document in the same change.

## Tree

```text
crew/
├─ AGENTS.md              # Rules for AI agents working on this repo (CLAUDE.md points here)
├─ CLAUDE.md              # Claude Code entry point; imports AGENTS.md
├─ README.md            # Banner, short intro and doc index
├─ package.json           # "bin": { "crew": "dist/cli.js" }, run with `npx crew`
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
│     └─ handoff.md       # Latest session handoff
├─ src/
│  ├─ cli/                # Agent commands: join, next, update, ask, remember, done, phase, ticket, assign
│  │                      # Human commands: start, init, status, stop-all, worktree gc,
│  │                      #   approve, answer, memory, cancel (D2), tasks, logs, diff (D16)
│  │                      # Command declarations here are the single source for --help and docs/commands.md (D3)
│  ├─ server/
│  │  ├─ api/             # REST + SSE endpoints, Host-header and token checks (D13)
│  │  ├─ db/              # Drizzle schema and migrations (SQLite in ~/.crew, D12)
│  │  ├─ scheduler/       # Task state machine, dependencies, dispatch, budget and loop limits
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
   ├─ harness/            # In-process pipeline harness: real server, temp git repo, fake adapter
   ├─ adapters/           # Adapter contract tests
   └─ fixtures/           # Recorded stream-json / --json output, incl. rate-limit samples (D5, D7)
```

## Runtime folders (outside the repo)

Crew writes its state to the user's machine, not to the repo it manages (D12):

```text
~/.crew/
├─ crew.db                # One SQLite database for all workspaces
├─ logs/                  # Run logs (agent event streams)
└─ worktrees/
   └─ <workspace>/<task-id>/   # One git worktree per task, branch crew/<task-id>-<slug>
```

Each repo that *uses* Crew gets a `crew.config.ts` at its root, created by `crew init`.

## Notes

- `src/server/events/` and `test/` were added beyond the design doc's tree, to make the event bus and the test seams from the PRD explicit.
- `node-pty` and PTY code are not part of spawn mode (D5).
