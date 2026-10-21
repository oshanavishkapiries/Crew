# Project Structure

The folder layout of the Crew repository. Milestones 1 (core), 2 (runner, worktrees, dispatcher, safety, Claude Code adapter, human CLI) and 3 (verification pipeline, diff gate, command gates, reviewer gate, stop hook, human CLI) are implemented. Milestone 4 (merge queue, worktree setup, conflict sub-tasks, human queue/retry CLI) is implemented and its manual smoke passed. It is based on `docs/Crew Design Doc.md` and updated with the decisions in `plan/phase1/prd.md` (Decision Log D1–D65).

**Status:** milestones 1 to 5 are done (smoke passed with real Claude Code, 2026-10-21). Milestone 6 bullets 0–5 (server prerequisites and the whole Board UI in `ui/`) are implemented; packaging and the manual browser checklist remain (`milestone-6.md`).

**Keep this file current.** When a folder is added, removed, renamed or changes purpose, update this document in the same change.

Memory storage and scoped CRUD/promotion live in `src/server/memory/index.ts`; `memory/prompt.ts` is the shared budgeted builder for work, review, phase-task and fallback/resume prompts; `src/cli/commands/memory.ts` implements human curation and agent learning. `test/harness/memory.test.ts` exercises the API through the real CLI and role boundaries; `memory-injection.test.ts` asserts actual fake-adapter prompt text, budget trimming and privacy.

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
├─ scripts/               # Dev scripts: generate-docs.ts, smoke-milestone-2.ts, smoke-milestone-3.ts, smoke-milestone-4.ts and smoke-milestone-5.ts (`npm run smoke:m3` / `smoke:m4` / `smoke:m5`, manual)
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
│     ├─ milestone-4.md   # Milestone 4 plan: merge queue, rebase, conflict sub-tasks (done; manual smoke passed)
│     ├─ milestone-5.md   # Milestone 5 plan: config, memory, workflow phases, human gates (done; smoke passed)
│     ├─ milestone-6.md   # Milestone 6 plan: Board UI (Next.js static export + shadcn/ui)
│     ├─ agent-prompts/   # The implementer prompt template and its lessons
│     ├─ reports/         # Session reports and recorded verification for review
│     └─ handoff.md       # Latest session handoff
├─ src/
│  ├─ cli/                # Agent commands (thin HTTP clients, shared in client.ts): join, next, update, ask, remember, done, review, hook (hidden), phase, ticket, assign
│  │                      # Human commands: start, open, init, status, stop-all, resume (D23), worktree gc,
│  │                      #   approve, answer, memory, cancel (D2), tasks, logs, diff (D16), results, queue, retry (D44)
│  │                      # Command declarations here are the single source for --help and docs/commands.md (D3)
│  ├─ server/
│  │  ├─ project-config.ts # jiti loader, config validation/template and command prefix filtering (CLI startup only)
│  │  ├─ api/             # REST + SSE endpoints, Host/token/cookie checks; sessions.ts keeps browser credentials in memory, static.ts serves package-relative dist/ui safely
│  │  ├─ db/              # Drizzle schema and migrations (SQLite in ~/.crew, D12)
│  │  ├─ scheduler/       # Task state machine/dependencies (index.ts), authorized ticket creation/quota/assignment (tickets.ts), dispatcher with the parallel-agent limit (dispatcher.ts)
│  │  ├─ runner/          # Child-process spawn with structured events, timeouts, kill, resume (D4, D5)
│  │  ├─ worktree/        # Create, set up, transfer inactive conflict worktrees on human retry, clean up/gc; interrupt setup on stop/cancel
│  │  ├─ verify/          # Gate pipeline: diff → commands → review (D8, D10); command-runner.ts is shared with worktree setup (D45)
│  │  ├─ merge/           # Serial merge queue, detached integration worktree, rebase, re-verification, squash/rebase strategies, protected checkout/ref transactions with recovery journals, cleanup, feedback, conflict sub-tasks and interruption/restart recovery (D38–D46)
│  │  ├─ memory/          # Layers, shared protected prompt budget, promotion (D15)
│  │  ├─ workflow/        # Phase instructions, Scheduler phase tasks, durable gates, automatic dispatch completion and approved integrate summary memory
│  │  └─ events/          # In-process event bus behind SSE
│  ├─ adapters/           # claude-code, codex, fake (antigravity later, D17)
│  └─ roles/              # Built-in role prompts and permission profiles; workspace overrides stay in config
├─ ui/                    # Board UI (Next.js static export + Tailwind + shadcn/ui, D80/D81), built to dist/ui and served by the server
└─ test/
   ├─ tsconfig.json       # Typecheck config for everything (npm run typecheck)
   ├─ global-setup.ts     # Builds dist/ so tests drive the current crew binary
   ├─ harness/            # In-process pipeline harness (index.ts) plus the pipeline tests: runner, worktree, timeouts, dispatcher, ask/resume, stop-all, rate limits, cancel, human CLI, verification gates, stop hook, worktree setup, merge queue, config/init, ticket creation/assignment
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
├─ integration/           # <workspace-id>/ detached merge worktree; sibling .index/.checkout.json hold the private checkout index and recovery journal
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

`crew init` registers the canonical git root, one grill board and a four-agent Claude Code team, without overwriting an existing config. The real CLI startup loads every registered workspace config before binding; in-process harness startup does not execute repository config. Configured custom role rows use workspace-qualified IDs; built-in rows remain shared, with per-workspace overrides resolved by the runner.

Ticket creation/assignment lives in `scheduler/tickets.ts` and the thin `cli/commands/ticket.ts` client. Generated migration `0004` records task kind and immutable creation phase for durable quotas. Task statuses still belong to the Scheduler.

Phase instructions and lifecycle live in `src/server/workflow/phases.ts` and `index.ts`. The engine uses Scheduler phase transitions, durable task-linked drafts and human gates; `cli/commands/phase.ts` and `approve.ts` are thin clients. `test/harness/phases.test.ts` covers engine/recovery behavior and `phase-transport.test.ts` checks exact CLI transport. Generated migration `0005` links outputs and constrains active phase tasks. `test/adapters/phase-permissions.test.ts` checks the scoped output rule and the recorded real permission probe.

Bullet 5 adds `test/harness/early-workflow.test.ts`: real Dispatcher/Runner/CLI grill Q&A and fallback, spec publication, held tickets, rejection/recovery and live Orchestrator command boundaries. Scheduler owns the ticket hold/release; Workflow validates the ticket graph and publishes approved spec memory atomically.

`test/harness/dispatch-integrate.test.ts` covers the grill-to-done three-ticket pipeline, staffed-role assignment, worker Q&A, integrate promotion/summary memory, atomic dispatch completion, gate races and human recovery. Workflow advances dispatch on work-status events and startup; the board move and integrate task commit together. Integrate role-memory listing in `src/server/api/app.ts` is limited to a live integrate Orchestrator in the same workspace.

`test/adapters/crew-home-permissions.test.ts` covers Crew state-file Read denials (not the worktrees subtree) for every Claude profile, spawn/resume and custom homes; the matching real Read probe is in `test/fixtures/claude-code/crew-home-read-dontask.json`.

`test/harness/cli-status.test.ts` drives real CLI phase/gate/recovery output, dispatch ticket counts, combined task filters and help. The status API supplies per-board work-ticket counts and registered role IDs/names; task filtering and validation stay in `src/cli/commands/tasks.ts`, using that metadata and the existing task list.

`src/server/runner/reaper.ts` is the D77 startup reaper: `crew start` ends runs left unfinished by a dead server and kills an agent process group only when `/proc/<pid>/environ` still names the run's `CREW_TASK_ID` (Linux; other platforms warn), and never while `server.json` names a live server. `test/harness/reaper.test.ts` covers it (kill, reused PID, gone process, live-server guard); `server-sigkill.test.ts` proves it end to end with a real SIGKILLed server.

`test/harness/interruptions.test.ts` covers grill/spec/tickets live-run and pending-gate server restarts with fresh runtime components and a new database connection, stop/resume, concurrent cancel/retry replacement, escalation recovery and all phase-endpoint auth checks. Kill cases assert both agent and child PIDs are gone; restart coverage uses graceful server close, not a hard process crash.

`test/harness/server-sigkill.test.ts` runs the built CLI/server as a real child, replaces only the paid Claude executable with a stub, SIGKILLs the server and records orphan/duplicate behavior after real CLI startup. It proves explicit old-process cleanup plus human stop/resume/approval recovery; no durable orphan fix is claimed. Dispatch/integrate and interruption tests cover the full board, promotion boundaries, auth matrix and worker process termination. `scripts/smoke-milestone-5.ts` uses real CLI init/start, a capped real-Claude launcher, scripted human commands and read-only database/log evidence; it is typechecked but never executed by the suite.

Milestone 6 bullet 0 adds `cli/commands/open.ts` (server.json discovery, fresh login URL and browser launcher), `server/api/sessions.ts` (single-use key exchange and revocable sessions) and `server/api/static.ts` (static export host, route fallback and safe asset caching). `test/harness/board-server.test.ts` covers browser authentication, CLI login recovery/restart, static exports and traversal, Board reads/personas, task detail and global SSE. The server works with no `ui/` build. `server.json` remains mode 0600 and contains only URL, secret and PID, never browser keys or cookies.

The Board (`ui/`, its own package with its own lockfile) has these routes in `ui/app/`: `/` (boards), `/board` (Board view, `?id=`, task panel `?task=`), `/phase` (gates, `?board=`), `/inbox`, `/team`, `/memory`. Feature components live in `ui/components/{board,task,gates,inbox,team,memory}`; every control comes from the shadcn primitives in `ui/components/ui` and colors come from the tokens in `ui/app/globals.css` (D81). `ui/lib/` holds the cookie API client, SSE hook and per-feature data/logic modules; their pure logic is covered by `node --test` checks in `ui/checks/` (`npm --prefix ui run check`), not by the root suite. `npm run build:ui` exports the static site into `dist/ui`.

Track E adds `test/harness/ticket-edit.test.ts` for pending-ticket API/CLI edits,
transactional dependency replacement, gate release, prompt content and dispatch
races. `ui/components/gates/ticket-cards.tsx` persists gate ticket changes through
those endpoints; `Tickets.edit` delegates readiness recomputation to Scheduler.

`src/server/api/logs.ts` reads bounded per-run file tails with Crew-home path checks.
`test/harness/run-logs.test.ts` exercises real API/CLI history selection, tail limits,
missing files, unsafe paths and actual Runner ask/answer logs. The task Log tab's
run selection and summary live in `ui/components/task/run-logs.tsx`; `log-viewer.tsx`
loads that run's bounded history and streams only when it is active.
The shared SSE hook supplies task/type invalidation hints to `ui/lib/board-data.ts`
so pending-ticket edits refresh dependency arrows even within one timestamp second.

Milestone 7 bullet 0 adds `src/adapters/codex.ts` (headless sandbox mapping,
run-local chunked JSONL parser and resume), `test/adapters/codex.test.ts`, and
`test/fixtures/codex/` with real edit/resume/read-only output and explicitly
synthetic rate-limit errors. `scripts/record-codex-fixtures.ts` is a manual paid
recorder (three tiny turns; never invoked by tests).

Milestone 7 bullet 1 registers Codex in Runner and exports it from the adapter
barrel. `crew init` reports installed tools and provisions optional additive
`crew.config.ts` team entries (`name`, `role`, `cliType: 'codex' | 'claude-code'`),
as does real CLI startup. Existing named agents cannot silently change role/tool;
omitting entries never deletes agents. Default Claude staffing stays unchanged.
`test/harness/codex.test.ts` wraps the fake process to emit Codex JSONL consumed
by the production parser while driving real CLI and worktree operations.

Milestone 7 bullet 2 adds `cli/commands/pull.ts`: token-only join/next clients
that keep no credentials on disk. Dispatcher serializes spawn and Pull provisioning,
shares Scheduler worktree/setup and Runner's role/memory/permission prompt builder,
and reserves capacity for pid-less Pull runs. `test/harness/pull.test.ts` drives the
real CLI against the real database/server for context, long-poll, auth and activity.
Pull lifecycle helpers in Runner record updates in ordinary run logs; the startup
reaper leaves pid-less Pull rows alone. No stale scanner or UI changes are included.
