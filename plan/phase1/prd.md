# Crew — Phase 1 PRD (First Public Release)

Source: `docs/Crew Design Doc.md`. Phase 1 is the whole first public release (build milestones 1–8). There is no MVP: every feature here must be at release quality before launch.

## Decision Log

Decisions from the grilling session on 2026-10-18, plus later ones: D20 from milestone 1, D21–D26, which Claude proposed in `milestone-2.md` and the user approved on 2026-10-19, D27, proposed by the implementing agent and approved by the user, D28, decided on 2026-10-21, D29–D37, which Claude proposed in `milestone-3.md` and the user approved on 2026-10-19, and D38–D46, which Claude proposed in `milestone-4.md` and the user approved on 2026-10-20, D47–D55, proposed by the implementing agent in `milestone-4.md` §9 and approved by the user on 2026-10-20, D56–D65, which Claude proposed in `milestone-5.md` and the user approved on 2026-10-20, and D66–D78, proposed by the implementing agents in `milestone-5.md` §9 and approved by the user on 2026-10-21, D79, decided by Claude from the first real smoke on 2026-10-21 (to be confirmed by the user), D80–D81, decided by the user for the Board UI on 2026-10-21, and D82–D87, proposed by Claude in `milestone-6.md` and approved by the user on 2026-10-21. D79 was also confirmed by the user then. Each is referenced in the text below by its ID.

- **user**: the user decided it directly.
- **Claude-decided**: Claude recommended it, and the user accepted all remaining recommendations in advance. These are agreed but open to veto: review them first.

| ID | Decision | Decided by |
| --- | --- | --- |
| D1 | Public release still needs all 8 milestones and the real end-to-end run. A private preview for a few trusted testers ships after milestone 5: Claude Code only, CLI only. | user |
| D2 | Every human action on the Board can also be done from the terminal (approve or edit a phase, answer a question, view and edit memory, cancel a task). These commands stay after release. | user |
| D3 | One commands reference document exists from day one. It is generated from the same command definitions as `--help`, and a test fails if it is stale. | user |
| D4 | After `crew ask`, a spawned agent's process ends. On answer, Crew resumes the same tool session with the answer. If that fails or isn't supported, it falls back to a fresh process with task context, the Q&A and a summary of the current diff. | user |
| D5 | Spawned agents run as plain child processes emitting structured JSON events (Claude Code `stream-json`, Codex `--json`), not inside a PTY. The Board renders these events as a live log. `node-pty` is dropped from spawn mode. This changes the design doc. | Claude-decided |
| D6 | Crew assigns the Claude Code session ID up front and captures the Codex session ID from its events. Every Run stores its session ID. | Claude-decided |
| D7 | Rate limits are detected from structured error events. All agents of that tool pause, with exponential backoff from 1 minute capped at 30 minutes, or until the reported reset time. A rate-limited run doesn't use up a retry. | Claude-decided |
| D8 | The Reviewer is a fresh read-only process that prefers a different tool than the author when one is available. "Changes requested" uses the same retry limit as verification failures. | Claude-decided |
| D9 | In the grill phase the Orchestrator asks the user through `crew ask`, one question per ask, and resumes per D4. There is no separate chat channel. | Claude-decided |
| D10 | Verify commands are a named list. Each has a command, an optional working directory, a timeout, and optional path globs so it runs only when changed files match. | Claude-decided |
| D11 | Crew merges into the local default branch only and never pushes. Merges happen in an internal integration worktree. The default branch is updated only if the user's checkout isn't on it, or is on it and clean (fast-forward). Otherwise the queue pauses with a warning. | Claude-decided |
| D12 | One Crew home at `~/.crew` holds a single SQLite DB for all workspaces, plus logs and worktrees. | Claude-decided |
| D13 | The server binds to 127.0.0.1 only and checks the Host header. Per-agent tokens are random and stored hashed, and spawned agents get theirs through an env var. The Board and human CLI use a per-start secret. | Claude-decided |
| D14 | Linux and macOS are supported at launch, Windows through WSL only. Node 22 LTS or newer. | Claude-decided |
| D15 | The memory injection budget defaults to about 8k tokens, configurable. The Orchestrator keeps the project summary up to date. Overflow is trimmed by relevance and recency. | Claude-decided |
| D16 | Extra human CLI commands for working without the Board: `crew tasks`, `crew logs <task> --follow`, `crew diff <task>`. | Claude-decided |
| D17 | Antigravity is Pull mode only at launch. | Claude-decided |
| D18 | No telemetry. | Claude-decided |
| D19 | Permissions, stop-all, budget and loop limits, and Claude Code rate-limit handling move to milestone 2, so preview testers (D1) never run agents without them. Codex, Pull mode, heartbeat and Codex rate-limit handling stay in milestone 7. | user |
| D20 | The Crew home directory defaults to `~/.crew` and can be overridden by the `CREW_HOME` environment variable, enabling isolated test environments with temporary databases, worktrees, and logs. | Claude-decided |
| D21 | Every Run stores an `exitReason` (`done`, `asked`, `exited`, `timeout`, `no-output`, `stopped`, `rate-limited`, `cancelled`, `resume-failed`), because the exit code alone can't tell a timeout, a stop-all and a crash apart. | user |
| D22 | A run that hits max runtime, goes silent past the no-output timeout, or exits without `crew done` or `crew ask` counts as one retry, and the task is re-dispatched. Past the max it becomes `escalated`. There is no separate `failed` state. Runs ended by stop-all, a rate limit or a failed resume don't use up a retry. | user |
| D23 | After `crew stop-all`, dispatch stays stopped, even across server restarts, until the user runs `crew resume` (or uses the Board's switch). | user |
| D24 | Limit defaults: max task depth 3, max runtime per run 30 minutes, no-output timeout 5 minutes, max tickets per phase 20. | user |
| D25 | `crew start` writes `~/.crew/server.json` (mode 0600) with the server URL, the per-start secret and the pid, and deletes it on shutdown. Human CLI commands read the secret from it. The secret is never printed. | user |
| D26 | The optional Claude Code Stop hook moves from milestone 2 to milestone 3, because it depends on verification results. | user |
| D27 | Test files run one at a time (`fileParallelism: false`) with a 30 second test timeout. Each harness test starts a real server, database, git repo and child processes, and running files in parallel starves them and makes timeouts flaky. The cost is a longer suite (about 45 seconds today). | user |
| D28 | `ClaudeCodeAdapter` keeps its optional `maxBudgetUsd` constructor option (it passes `--max-budget-usd`) for embedding and manual probes, which use it as a per-run cost cap. Crew does not expose it in `crew.config.ts` and sets no default cap in Phase 1: cost is bounded by `maxRetries`, `maxRuntimeMs`, `noOutputTimeoutMs`, run caps in the smoke scripts and the merge/verify limits. Per-task or per-board budgets belong to Phase 2. Logged on 2026-10-21 and closes the item left open since milestone 2. | Claude-decided, delegated by the user |
| D29 | Until `crew.config.ts` loading lands in milestone 5, verify commands are read from the workspace's stored config (`verifyCommands`). | user |
| D30 | The diff gate commits any changes the agent left uncommitted, on its behalf, and fails an empty diff. | user |
| D31 | The diff gate's server-side out-of-worktree check is a symlink-escape check plus a comparison of the main checkout's `git status` at run start and at `crew done`. | user |
| D32 | Every applicable verify command runs and all failures are reported together. A diff-gate failure ends the pipeline at once. | user |
| D33 | A task returned after a failed gate or "changes requested" starts a fresh process with the feedback in its prompt, not a session resume. | user |
| D34 | If the workspace has no reviewer agent, the review gate is skipped and recorded as skipped. The Reviewer answers with `crew review approve` or `crew review changes`, authorised through `tasks.reviewerAgentId`. Runs get a `kind` (`work` or `review`). | user |
| D35 | A Reviewer that ends without a verdict is re-run, up to 2 runs in total, then the task is escalated. The author is not charged a retry. | user |
| D36 | The Claude Code Stop hook is a Crew-written `--settings` file (no repo files). It blocks stopping only while the task is `doing`, at most 2 times per run, and is off by default. | user |
| D37 | Up to 2 verification pipelines run in parallel, and path globs are matched with `picomatch` (pinned). | user |
| D38 | Merges happen in a detached integration worktree, one queue item at a time per workspace: rebase onto the default branch, re-verify, then squash and move the ref. Crew's own git commands run with hooks off. | user |
| D39 | The default branch moves in one of three ways: update the ref when the user's checkout is on another branch or detached, fast-forward inside the user's checkout when it is on the default branch with no changes at all (by the D54 transaction), and pause the queue with a warning (never fail, never touch files) when it is on the default branch with any change. The check is re-run every 5 seconds and right before the ref moves. | user |
| D40 | Merge strategies are `squash` (default) and `rebase`. Plain merge commits are not supported in Phase 1. | user |
| D41 | A conflict creates a "rebase + resolve" sub-task for the same role. It continues the same branch in a new worktree, goes through the whole pipeline and merge queue, and when it is merged the original task becomes `merged` too. If it would exceed the depth limit, or is escalated or cancelled, the original task is escalated. | user |
| D42 | A re-verify failure on the rebased code returns the task to `doing` (`merge-queue → doing`) with feedback and uses a retry. Exhausted retries escalate from `merge-queue`. | user |
| D43 | After a merge, the task's worktree is removed and its branch is deleted with `git branch -D`. A cancelled task keeps its branch. | user |
| D44 | `crew retry <task>` lets a human restart an `escalated` task: `escalated → doing`, retries reset to 0, optional note stored as feedback. Only a human can leave `escalated`. | user |
| D45 | An optional `worktreeSetup` command (for example `npm ci`) runs once in every new task or integration worktree. A failing setup escalates the task. | user |
| D46 | Merge queue items store the merge commit (`commitSha`) and an `output`. On restart, in-flight items go back to `queued`, and a merge that already reached the default branch is completed instead of repeated. | user |
| D47 | Merge commit identity: a squash commit's author is the agent that did the work (`<agent name> <agent@crew.local>`) and its committer is the user's git identity, falling back to `Crew <crew@localhost>`; it carries a `Crew-Task: <id>` trailer. The `rebase` strategy keeps the author commits and messages. | user |
| D48 | A worktree's `worktreeSetup` success is remembered by a marker in that worktree's private git directory, so a restart does not rerun it and a new worktree does. There is no shared cache and no `node_modules` symlink. If Crew's own cleanup removes setup output, it clears the marker so setup runs again. | user |
| D49 | If a conflict resolution leaves no changes (an empty diff), the normal empty-diff gate rejects it. When retries run out, the sub-task and its parent escalate. There is no separate "nothing left to merge" outcome. | user |
| D50 | A terminal merge failure (a git failure that is not a conflict, an empty squash, or three lost ref races) escalates the task through the feedback path, with the reason as feedback and no retry charge, in the same transaction as the failed queue item. Failed items found at restart are escalated the same way. A checkout that becomes dirty late pauses the queue instead of failing. | user |
| D51 | Before every merge attempt, and after a crash, Crew aborts any rebase, resets and cleans the integration worktree. Ignored install files survive the clean. | user |
| D52 | If cancellation arrives after the merge commit already reached the default branch, Crew records the task as `merged` and cleans up instead of reporting a cancellation. | user |
| D53 | When a human retries an escalated conflict parent, the deepest inactive conflict sub-task's worktree moves to the parent with `git worktree move`, keeping uncommitted files, because git allows one checkout of a branch. | user |
| D54 | Replaces the plain `git merge --ff-only` in D39 for a clean default checkout. Crew prepares a `git update-ref --stdin` transaction that locks HEAD, checks HEAD still names the default branch, fast-forwards files with `git read-tree -m -u` through a private index, publishes the index while HEAD is locked, then commits the ref. A journal lets a restart finish an interrupted publish. A foreign index or HEAD lock, or an ignored file that an incoming file would overwrite, pauses the queue and never overwrites user bytes. Verified with Git 2.53.0; Crew refuses to write if git does not lock HEAD. Follow-up: simplify this and make the ignored-file check cheaper. | user |
| D55 | Stop-all and cancel kill rebase, verify and setup processes, but once the protected checkout publication of D54 has started it finishes its index and ref transaction first, so a stop never leaves a half-updated checkout. If its ref landed, the task is recorded as merged (D52). | user |
| D56 | `crew.config.ts` is loaded when `crew start` runs and copied into `workspaces.config`; the file wins on every start, and a broken file stops start with a message that names the line. The loader is `jiti`, pinned. | user |
| D57 | `crew init` creates the workspace, a board, the built-in roles, a default Claude Code team (one orchestrator, two developers, one reviewer) and a commented `crew.config.ts`. Running it twice changes nothing. | user |
| D58 | The config has `permissions.allowCommands`, a list of command prefixes (for example `npm test`) added to the allow-list of roles that edit code. It can never allow `git push`. This closes the gap that the `standard` profile could not run tests. | user |
| D59 | `POST /api/tasks`, `crew ticket create` and `crew assign` are open to the Orchestrator and to humans only; any other agent token gets 403. At most 20 tickets can be created per phase. | user |
| D60 | Each Orchestrator phase run is a task with `tasks.kind = 'phase'` (migration `0004`). It goes through the normal dispatcher and runner, in a throwaway worktree with the orchestrator profile, and ends with `crew phase done --output <file>`, which stores a draft PhaseOutput and moves the task `doing → merged`. Only phase tasks may take that transition; they have no diff gate, review or merge. | user |
| D61 | Gates after grill, spec, tickets and integrate are on by default and can be switched off per phase in the config. `crew approve [--edit <file>]` approves a draft and starts a fresh phase run for the next phase; `crew approve --reject --note "..."` runs the same phase again with the note in its prompt. | user |
| D62 | Memory injection estimates tokens as characters divided by 4, uses a default budget of 8k, and drops entries by relevance to the task first, then by age. The persona, the task itself and current feedback are never dropped. One prompt builder serves work, review, phase and fallback prompts. | user |
| D63 | `crew remember` writes role memory with source `agent:<id>`. Promotion to project memory is explicit (`crew memory promote`, or by the Orchestrator during integrate) and records `promotedAt`. | user |
| D64 | A phase run that fails, hangs or crashes escalates like a work task, and `crew retry` recovers it. The board stays in that phase, and a draft gate output survives a restart. | user |
| D65 | The dispatch phase has no Orchestrator process: Crew assigns each ticket to an idle agent of its role and the phase ends when every ticket is terminal. Worker questions go to the human through `crew answer`. | user |
| D66 | `crew.config.ts` uses flat limit names (`maxParallelAgents`, `maxParallelVerifications`, `maxRetries`, `maxDepth`, `maxRuntimeMs`, `noOutputTimeoutMs`, `maxTicketsPerPhase`, `memoryBudgetTokens`), `permissions.allowCommands`, `roles.<name>.defaultPrompt` / `permissionProfile` and `workflow.gates.<phase>`; durations are milliseconds. Unknown options and invalid values are rejected before the server binds, and every workspace's file is loaded before any stored config changes. `jiti` is pinned to 2.7.0 with its caches disabled. A workspace with no config file keeps its stored settings (milestone 1 to 4 compatibility); a present file replaces them entirely. Runtime, retry, dispatch and verification limits are per workspace, with an optional explicit server-wide ceiling for embedding and tests. | user |
| D67 | Built-in role rows are shared and prompt/profile overrides apply per workspace at run time; custom roles get workspace-qualified IDs. The Reviewer and Orchestrator permission profiles are fixed (only their prompts are configurable). The Orchestrator profile can read, run `crew *` and `git diff/log/show/status`, and edit exactly one file, its phase output (`Edit(//absolute/path)`, verified under `dontAsk` on Claude Code 2.1.300; phase spawn and resume also pass `--setting-sources ""` so wider user rules cannot broaden it). `allowCommands` entries are literal command prefixes expanded to exact and argument-bearing Bash rules for editing roles only; entries with shell operators or permission syntax are ignored; Git prefixes must name one supported subcommand, and `git push` is never allowed. | user |
| D68 | `crew init` reads the local `origin/HEAD`, then `main`, `master`, then the current branch for the default branch, repairs a missing default team, roles or board without touching existing data, and says that its untracked `crew.config.ts` pauses merging until committed (the merge pause message repeats it). Agent tokens are not persisted: the Runner mints a replacement on the first run after a restart (existing behaviour, kept). | user |
| D69 | Tickets: migration `0004` stores the task kind and an immutable creation phase, so the D59 quota is durable (cancelled tickets still count, failed creations do not, older tasks do not). A human creates tickets with `--board` and `--phase`; an agent must be an Orchestrator with a live, assigned, active phase task whose phase matches, and cannot override board or phase. `POST /api/tasks/:id/assign` serves `crew assign` (agent ID or exact name, or a staffed role). Creation rejects unstaffed roles and cross-board, phase-task, cancelled or escalated blockers. After worktree setup the Dispatcher rechecks the assignee and, if a human reassigned the ticket, releases the old agent without charging a retry. | user |
| D70 | Memory API: agents read project memory, their own role's memory and tasks assigned to them or designated for their review, and write only their own role learning with `agent:<id>` as the source; humans edit and delete, and an edit keeps the original source. Promotion copies a role entry to project memory with `source = promotion:<id>:<original source>` and stamps both rows with `promotedAt` in one transaction; repeating it is a conflict. A live integrate Orchestrator may list every role learning in its workspace (injected prompts still use only the agent's own role memory) and may promote; ended contexts and another board's context are rejected. Promotions take effect immediately and are not rolled back when a later integrate draft is rejected. | user |
| D71 | `memory/prompt.ts` is the single prompt builder for work, Reviewer, phase and fallback runs. Persona, role override, task, acceptance criteria, latest feedback, additional run instructions and every question and answer are protected and kept even over the budget (D62). Optional context is ranked by word overlap with the task title, description and changed paths, then age. The Reviewer's diff is protected but capped at the smaller of 16,000 characters and half the budget, with a visible `[truncated; run git diff <base>...HEAD for the rest]` notice. The D33 earlier-failure list is kept whole when it fits and otherwise omitted as a unit with an explicit notice. Git discovery uses argument arrays with hooks off and never stages files. | user |
| D72 | Phase engine: migration `0005` links each output to its task (unique) and allows one active phase task per board and phase. A draft output and `doing → merged` commit in one Scheduler transaction. `crew approve` requires `--board`; `--draft` pins the expected gate, and without it the CLI reads the current one. Approving or rejecting decides the draft and creates the next phase task (or moves the board to dispatch or done) atomically; a rejection creates a fresh same-phase task with the note, the rejected draft and the earlier questions and answers, at no retry charge. A cancelled phase task stays cancelled and `crew retry` creates one replacement. Phase and work completion paths are separate. | user |
| D73 | Early phases: approving the spec writes the approved (or edited) text to project memory as `phase:spec:<draft-id>` in the same transaction, a rejected spec writes nothing. Tickets created in the tickets phase stay `todo` until that gate is approved; approval validates dependencies (cycles, cancelled or escalated blockers), approves the draft, moves to dispatch and releases ready tickets in one transaction, and a failed validation leaves the draft and the held tickets as they were. Rejection keeps the existing ticket rows and their quota use. The summary is advisory: a human may change tickets before approving. A process carrying `CREW_AGENT_TOKEN` cannot use human CLI authentication. | user |
| D74 | Dispatch and integrate: when every work ticket is merged or cancelled (or there are none) the board moves to `integrate` and creates the integrate task in one transaction, on every work-status event, after the tickets gate and at startup. A last ticket that escalates keeps the board in dispatch with a `problem` naming `crew retry` and `crew cancel`; a missing Orchestrator names `crew init` then `crew resume`. Approving integrate publishes the combined project and release summary as one project memory row `Project summary` sourced `phase:integrate:<draft-id>` and moves the board to `done` in one transaction; snapshots append and nothing is deleted. A cancelled blocker still does not satisfy a dependency. | user |
| D75 | `crew tasks` filters by status, role, board and assignee on the client, combined with AND; an ID wins over a name, and an ambiguous name needs an ID. `/api/status` adds registered role IDs and names and per-board ticket counts; `crew status` shows the phase, a pending gate with its exact `crew approve` command, the phase task, any `problem`, and recovery hints. | user |
| D76 | Every Claude Code profile denies `Read` of `server.json`, `crew.db` with its `-wal` and `-shm` files, `claude-settings.json` and `logs/**` in the resolved Crew home, and never the `worktrees/` subtree (agents run inside it). Verified by a real `dontAsk` probe on Claude Code 2.1.305. This is defence in depth, not an OS sandbox. | user |
| D77 | After an abrupt server death (SIGKILL), a detached agent can survive and a new `crew start` can start a second run for the same task; graceful restart tests do not prove otherwise. Before the private preview, `crew start` gets a small startup reaper: for each unfinished run with a recorded process group that is still alive and verifiably the same agent (on Linux its environment names the same `CREW_TASK_ID`, which guards against a reused PID), it terminates that group, ends the run row as interrupted, and only then lets the Dispatcher start new runs. Until then the documented manual workaround is to kill the old group and `crew resume`. | user |
| D78 | The milestone 5 manual smoke (`npm run smoke:m5`) runs the real CLI with a real Orchestrator, two workers and a Reviewer, adds the existing `--max-budget-usd 0.50` flag through a launcher that also counts run slots, has a 30-run cap (11 expected runs plus every legitimate retry, written out in the script), a 20-minute deadline and an expected cost of about $1 to $6, rejects one tickets gate with a note, and fails on any missing evidence, excess run, worktree Read denial or human-only command used by the Orchestrator. | user |
| D79 | Found by the first real milestone 5 smoke: an agent whose compound Bash command was denied concluded that Bash was off for the whole session and never ran `crew done` or `crew review`. The shared prompt builder (D71) therefore adds a protected tool-use note to every run: one simple command per Bash call, a denial affects only that command, use the file tools instead of `cat`/`echo`/`printf`, and a denial is never a reason to skip `crew done`, `crew review`, `crew ask` or `crew phase done`. The default Reviewer prompt names its allowed commands (git diff/log/show, `crew review`) and says verification already ran. A second real run then needed no retries. | Claude-decided |
| D80 | The Board is a Next.js app (App Router) with TypeScript and Tailwind, built with `output: 'export'` at package time and served as static files by the crew server, so `npx crew` still runs one process on one port (story 116). The reverse proxy the user wanted exists in development only: `next dev` rewrites `/api` to the running crew server. Next.js server features (Server Components with data, route handlers, middleware) are not used. This replaces Vite + React in the earlier design. | user |
| D81 | Every UI element is built from shadcn/ui components that live in the repository (`ui/components/ui`), and feature components compose them; pages never style raw HTML controls. Colors, radius and fonts are CSS-variable theme tokens, so the user can restyle the Board in one place later. | user |
| D82 | Browser auth: `crew start` and `crew open` print a login URL whose fragment holds a single-use key (in memory only). The page exchanges it at `POST /api/session` for an HttpOnly, SameSite=Strict session cookie, accepted on human endpoints and both SSE streams next to `X-Crew-Secret`. State-changing cookie requests must send `X-Crew-Board: 1`. A restart invalidates cookies and keys; `crew open` recovers. This answers the open question on SSE auth. | user |
| D83 | `ui/` is its own package with exactly pinned dependencies. `npm run build:ui` (typecheck, lint, `next build`, copy to `dist/ui`) is not part of `npm test`; `prepack` runs it so `dist/ui` ships in the npm package. | user |
| D84 | New human-only Board endpoints: `GET /api/boards|agents|agents/:id|roles` and `PATCH /api/agents/:id` (name, systemPrompt, personality only), plus the CLI-only `POST /api/session/key`. The only new CLI command is `crew open`. | user |
| D85 | No SSE event replay: after a reconnect the UI refetches the affected resources. | user |
| D86 | No browser end-to-end suite in Phase 1; the Board is checked by its REST/SSE harness tests, the UI build and a manual browser checklist (milestone-6.md §6). | user |
| D87 | Dependency arrows and columns use plain SVG/CSS, no graph library. | user |
| D88 | Codex sandbox mapping (workspace network is on by default, because a network-off sandbox cannot reach the local Crew API; `allowNetwork: false` disables it): `read-only` → `workspace-write` (OS `read-only` only with `allowNetwork: false`; the Reviewer's no-edit rule becomes a prompt rule), `standard`/`orchestrator` → `workspace-write`, `full` → `danger-full-access` (only when the human configured `full`). Codex has no per-command allow/deny lists, so those are enforced by the sandbox and prompt rules; this limitation is documented. | user |
| D89 | Pull assignment reuses the Dispatcher's worktree provisioning and prompt builder; the only difference is handing the task to the polling agent instead of spawning a process. | user |
| D90 | Stale window default is 10 minutes (`staleAfterMs`, configurable); a stale Pull agent's task is re-queued without charging a retry and its branch is kept. | user |
| D91 | Every `crew` call from a Pull agent is a heartbeat; no background heartbeat process is required. | user |
| D92 | Pull runs have no pid; Stop-all and cancel reach the agent on its next `crew` call. | user |
| D93 | Milestone 7 ships Codex and Pull mode together; Antigravity is a Pull agent type with a copy-paste connect prompt (D17). | user |

## Problem Statement

A developer with one AI coding subscription (Claude Code or Codex) can only work with one agent at a time, turn by turn. Running several agents as a team breaks down quickly:

- CLI agents can't wait in the background for work. Bash commands time out, every poll costs tokens and context, and when the session stops the loop stops with it.
- One long session that handles many tasks fills its context and gets compacted, so it loses what it knew.
- Memory, roles, conventions and workflow live inside the AI tool (CLAUDE.md, AGENTS.md, tool-specific skills, MCP config). Switching tools or restarting a session loses that, and a mixed Claude + Codex team writes inconsistent code.
- Nobody checks the agents' work. An agent says "done", and the developer has to read the diff, run the tests, merge the branches and fix the conflicts by hand.
- Parallel agents in one checkout overwrite each other's files, and nothing controls the cost, the rate limits or a runaway agent.

The developer wants to point a team at a repo, describe what they want, approve a few key decisions, and get verified, merged code back without babysitting every agent.

## Solution

Crew is a CLI tool (`npx crew`) that runs a local server and web Task Board and turns AI coding agents into a tool-independent dev team with its own memory.

- `crew start` launches the server and the Board at localhost:4000. `crew init` adds a `crew.config.ts` to the repo with verify commands, roles and limits.
- An **Orchestrator** agent takes the developer through a server-defined workflow: grill → spec → tickets → dispatch → integrate. The developer approves the outputs at human gates on the Board.
- Tickets become **Tasks** in a state machine. By default (**Spawn mode**) the scheduler spawns a fresh agent process for each task, in its own git **worktree** and branch, with persona, role, relevant memory and task context injected into the prompt.
- Agents talk to Crew only through the `crew` CLI (`join`, `next`, `update`, `ask`, `remember`, `done`). No MCP config and no edits to tool config files are needed. Pasting one connect prompt is enough.
- After `crew done`, Crew checks the work itself with **verification gates**: diff check, lint/typecheck/test commands, then a Reviewer agent against the acceptance criteria. Work that fails goes back to the agent. Work that keeps failing is escalated to the human.
- Verified work goes through a **merge queue**: rebase onto the latest main, re-verify, squash merge. Conflicts become "rebase + resolve" sub-tasks automatically.
- **Memory** has three layers (project, role, task). It lives in Crew, so agents can be swapped, restarted or changed from Claude to Codex without losing anything.
- The Board shows live agent logs, diffs, verification results, questions, phase approvals, memory, agents and budget, and has a Stop-all kill switch.
- Everything a human does on the Board can also be done from the terminal, so Crew works fully without a browser (D2, user).
- Claude Code and Codex are supported at launch. **Pull mode** lets an agent run in the developer's own terminal, for tools without headless support.
- A private preview for trusted testers ships after milestone 5 (Claude Code, CLI only). The public release follows once all 8 milestones are done (D1, user).

## User Stories

### Setup and onboarding

1. As a developer, I want to run Crew with `npx crew` and no global install, so that I can try it on any repo right away.
2. As a developer, I want `crew init` to create a `crew.config.ts` with sensible defaults for verify commands, roles and limits, so that I don't have to write config from scratch.
3. As a developer, I want `crew init` to detect my project's lint, typecheck and test commands where it can, so that verification works without manual setup.
4. As a developer, I want `crew start` to launch the server and the Board on localhost:4000 in one command, so that setup is one step.
5. As a developer, I want Crew to detect which AI tools (Claude Code, Codex) are installed, their versions and whether they support headless mode, so that I know which agents I can run.
6. As a developer, I want a clear error when no supported AI tool is installed, so that I know what to install.
7. As a developer, I want to create a Workspace for a repo, with its path and default branch, so that Crew knows where to work.
8. As a developer, I want several Workspaces for different repos, so that I can use Crew across projects.
9. As a developer, I want Crew to keep all its state in a local SQLite database, so that nothing leaves my machine and state survives restarts.
10. As a developer, I want `crew status` to print agents, tasks and budget in the terminal, so that I can check progress without opening the Board.
11. As a developer, I want every command to have clear `--help` output, so that I can learn the CLI from the terminal (D3, user).
12. As a developer, I want one commands reference document that always matches the CLI, so that I can see every available command in one place (D3, user).
13. As a developer, I want Crew to run on Linux and macOS (and on Windows through WSL), so that I know where it's supported (D14, Claude-decided).
14. As a developer, I want all Crew state for all my workspaces kept under one Crew home directory, so that it's easy to find, back up or delete (D12, Claude-decided).

### Workspaces, boards and agents

15. As a developer, I want each Workspace to have a Board that tracks its current workflow phase, so that I can see where the project stands.
16. As a developer, I want to create agents with a name, role, personality and AI tool, so that I can build a team that fits my project.
17. As a developer, I want built-in roles (orchestrator, architect, backend, frontend, qa, reviewer), so that I can start without defining roles myself.
18. As a developer, I want to define custom roles with their own default prompt and permission profile, so that the team fits my project.
19. As a developer, I want to edit an agent's persona from the Board, so that I can tune its behaviour without touching files.
20. As a developer, I want to run several agents on the same AI tool (e.g. 5 Claude Code agents), so that one subscription gives me a whole team.
21. As a developer, I want to mix Claude Code and Codex agents in one team, so that I can use the tools I have.
22. As a developer, I want to switch an agent from one AI tool to another without losing its memory or role, so that the agent is just a replaceable worker.

### Orchestrator workflow

23. As a developer, I want the Orchestrator to get its workflow from Crew rather than from tool-specific skills, so that it behaves the same on any AI tool.
24. As a developer, I want the Orchestrator to grill me about requirements, constraints and edge cases one question at a time, answered on the Board or in the terminal, so that the spec is based on what I really need (D9, Claude-decided).
25. As a developer, I want to approve the grill output before the spec is written, so that misunderstandings are caught early.
26. As a developer, I want the Orchestrator to write a spec with goals, non-goals, architecture and acceptance criteria, so that every agent works from the same plan.
27. As a developer, I want to review, edit and approve the spec on the Board, so that I control what gets built.
28. As a developer, I want the approved spec saved to project memory, so that every later task can use it.
29. As a developer, I want the Orchestrator to break the spec into tracer-bullet tickets with dependencies and acceptance criteria, so that work can run in parallel safely.
30. As a developer, I want to review, edit and approve the ticket list before dispatch, so that I control scope and order.
31. As a developer, I want the Orchestrator to assign tickets to roles or agents during dispatch, so that each task goes to the right specialist.
32. As a developer, I want the Orchestrator to answer agent questions, unblock tasks and promote memory during integrate, so that the team keeps moving without me.
33. As a developer, I want a release summary at the end of integrate, so that I know what was built and merged.
34. As a developer, I want the Orchestrator process to stop at each human gate and a fresh process to start for the next phase after I approve, so that its context stays clean.
35. As a developer, I want to add or remove phases and turn human gates on or off from the Board, so that the workflow fits how I work.
36. As an Orchestrator agent, I want `crew phase` to tell me the current phase and its instructions, so that I know what to do next.
37. As an Orchestrator agent, I want `crew phase done --output <file>` to submit my phase output, so that it can go to the human gate or the next phase.
38. As an Orchestrator agent, I want `crew ticket create` to create tickets with dependencies and acceptance criteria, so that the scheduler can dispatch them.
39. As an Orchestrator agent, I want `crew assign <agent> <task>` to give a task to a specific role or agent, so that I control who does what.
40. As a developer, I want Orchestrator-only commands to be rejected for other roles, so that a worker agent can't create or reassign tickets.

### Agent commands and connection

41. As an agent, I want `crew join --token <t>` to give me my role, persona, rules, working directory and project memory, so that I can start working with full context.
42. As an agent, I want `crew update "..."` to report progress, so that the developer can follow my work on the Board.
43. As an agent, I want `crew ask "..."` to post a question to the Board and block my task, so that I don't guess when requirements are unclear.
44. As an agent, I want to resume my same session with the answer once the developer replies, so that I keep everything I was thinking mid-task (D4, user).
45. As a developer, I want a blocked agent's process to end while it waits for my answer, so that waiting costs no runtime, tokens or Bash timeouts (D4, user).
46. As a developer, I want Crew to fall back to a fresh process with full context if a session can't be resumed, so that an answered question never leaves a task stuck (D4, user).
47. As an agent, I want `crew remember "..."` to save a learning to my role memory, so that future agents of my role don't repeat my mistakes.
48. As an agent, I want `crew done --result "..."` to send my task to verification, so that my work is checked and merged.
49. As an agent, I want a summary of the error output when verification fails, so that I can fix the problem and run `crew done` again.
50. As an agent, I want `crew --help` to explain every command clearly, so that I can use the CLI correctly without extra instructions.
51. As an agent, I want CLI arguments that are easy to pass from Bash (no hand-written JSON), so that I don't make quoting mistakes.
52. As a developer, I want the Board to generate a ready-to-paste connect prompt for each agent, so that connecting an agent takes one paste.

### Spawn mode (default)

53. As a developer, I want the scheduler to pick only dispatchable tasks (dependencies merged, budget available), so that agents never start work that can't land.
54. As a developer, I want each task to run in a fresh agent process, so that context never fills up across tasks.
55. As a developer, I want the agent's structured event stream shown live as a readable log on the Board and in the terminal, so that I can watch it work (D5, Claude-decided).
56. As a developer, I want persona, role, relevant memory and task context injected into the spawn prompt, so that the agent starts with what it needs.
57. As a developer, I want the agent process to end after `crew done` and verification, so that resources are freed and the next task starts fresh.
58. As a developer, I want each run recorded with adapter, pid, start/end time, exit code and log, so that I can debug what happened.

### Human commands in the terminal

59. As a developer, I want to review, edit and approve phase outputs from the terminal, so that I'm never blocked when the Board isn't available (D2, user).
60. As a developer, I want to answer agent questions from the terminal, so that blocked tasks resume without opening a browser (D2, user).
61. As a developer, I want to view and edit memory from the terminal, so that I can curate what agents know from scripts or over remote connections (D2, user).
62. As a developer, I want to cancel a task from the terminal, so that I can drop work without the Board (D2, user).
63. As a developer, I want to list tasks and their states from the terminal, so that I can see the board without a browser (D16, Claude-decided).
64. As a developer, I want to follow a task's live agent log from the terminal, so that I can watch an agent work without the Board (D16, Claude-decided).
65. As a developer, I want to see a task's current diff from the terminal, so that I can inspect work without the Board (D16, Claude-decided).

### Pull mode (optional)

66. As a developer, I want to run an agent in my own terminal session with Pull mode, so that I can use tools without headless support or keep my agent visible.
67. As a Pull-mode agent, I want `crew next --wait` to hold the request for less than the Bash timeout (e.g. 90 seconds) and tell me to call again if there is no task, so that I can wait for work without timing out.
68. As a Pull-mode agent, I want to be told to clear my context and run `crew join` again after each `crew done`, so that my context stays fresh while memory stays in Crew.
69. As a developer, I want a Pull-mode agent shown as "stale" on the Board and its task re-queued when it makes no `crew` call for a set time, so that work isn't stuck on a dead session.
70. As a developer, I want verification gates to apply fully in Pull mode, so that Pull-mode work is held to the same standard.
71. As a developer, I want the Pull-mode connect prompt to tell me to add `crew *` to my tool's allowlist, so that the agent isn't blocked by permission prompts.

### Code isolation

72. As a developer, I want a `crew/<task-id>-<slug>` branch and a worktree under the Crew home directory created when a task moves to `doing`, so that parallel agents never touch each other's files.
73. As a developer, I want the agent's working directory to be that worktree and writes outside it denied, so that my main checkout is safe.
74. As a developer, I want worktrees cleaned up when a task is merged or cancelled, so that disk space doesn't leak.
75. As a developer, I want `crew worktree gc` to remove abandoned worktrees, so that I can recover from crashes.

### Task state machine

76. As a developer, I want tasks to move through todo → ready → doing → verifying → review → merge-queue → merged, so that every task follows the same pipeline.
77. As a developer, I want a task to become `ready` only when all its blockers are `merged`, so that dependent work builds on real code.
78. As a developer, I want a task that fails verification to go back to `doing` with feedback, so that the agent can fix it.
79. As a developer, I want a task returned to `doing` when the Reviewer requests changes, with the feedback attached, so that review comments get addressed.
80. As a developer, I want a task to move to `blocked` on `crew ask` and back to `doing` on answer, so that the Board shows what's waiting on me.
81. As a developer, I want a task to become `escalated` after it exceeds its max retries (default 3), so that I'm pulled in only when agents can't solve it.
82. As a developer, I want to cancel a task from the Board, so that I can drop work that's no longer needed.
83. As a developer, I want invalid state transitions rejected by the server, so that the task history is always consistent.

### Verification gates

84. As a developer, I want the server to check that the worktree has changes and that no files outside it were modified, so that empty or out-of-bounds work is caught.
85. As a developer, I want lint, typecheck and test commands from `crew.config.ts` to run with timeouts after `crew done`, so that broken code never reaches review.
86. As a developer in a monorepo, I want each verify command to have its own working directory and path filters, so that only the checks relevant to the changed files run (D10, Claude-decided).
87. As a developer, I want a Reviewer agent to check the diff against the acceptance criteria from the spec, so that the work does what was asked.
88. As a developer, I want the Reviewer to use a different AI tool than the author when I have one, so that review catches mistakes the author's model is blind to (D8, Claude-decided).
89. As a developer, I want "changes requested" to count against the task's retry limit, so that an author and Reviewer can't loop forever (D8, Claude-decided).
90. As a developer, I want each verification step's result and output stored and shown on the task card and with `crew results <task>`, so that I can see why a task passed or failed (D2, user).
91. As a developer, I want previous verification failures included in the task context on retry, so that the agent doesn't repeat the same mistake.

### Merge pipeline

92. As a developer, I want verified, reviewed tasks merged one at a time through a merge queue, so that main never breaks from parallel merges.
93. As a developer, I want each branch rebased onto the latest main and the verify commands re-run before merge, so that what lands on main is tested against main.
94. As a developer, I want a "rebase + resolve" sub-task created automatically on conflict and given to the same role, so that conflicts are fixed without me.
95. As a developer, I want squash merge by default (one commit per task), with the strategy configurable, so that history stays clean the way I like.
96. As a developer, I want Crew to merge only into my local default branch and never push, so that I decide what goes to the remote (D11, Claude-decided).
97. As a developer, I want Crew never to touch uncommitted work in my own checkout, and to pause the merge queue with a warning instead, so that merges can't destroy my changes (D11, Claude-decided).
98. As a developer, I want the merge queue order shown on the Board, so that I know what lands next.

### Memory

99. As a developer, I want project memory (spec, architecture decisions, conventions, glossary) injected as a summary into every task, so that all agents share the same understanding.
100. As a developer, I want role memory injected only into agents of that role, so that context stays relevant.
101. As a developer, I want task memory (parent task, dependency results, relevant files, messages, earlier failures) injected only into that task, so that agents get exactly the context they need.
102. As a developer, I want memory injection kept within a configurable context budget (about 8k tokens by default), so that prompts stay small and effective (D15, Claude-decided).
103. As a developer, I want the Orchestrator to review role learnings during integrate and promote useful ones to project memory, so that the whole team benefits.
104. As a developer, I want to view and edit all three memory layers from the Board, so that I can correct or add knowledge.
105. As a developer, I want conventions in project memory to apply to every tool, so that a mixed Claude + Codex team writes consistent code.
106. As a developer, I want memory to record its source and when it was promoted, so that I can trust and trace it.

### Board UI

107. As a developer, I want a Board view with state-machine columns, dependency arrows and agent avatars, so that I can see the whole project at a glance.
108. As a developer, I want a task card with a live agent log (D5, Claude-decided), live git diff, commits, verification results and messages, so that I can inspect any task in depth.
109. As a developer, I want a questions inbox where I answer `crew ask` questions, so that blocked agents resume quickly.
110. As a developer, I want phase approval screens where I review, edit and approve the spec and tickets, so that human gates are easy to act on.
111. As a developer, I want an agents view with connected / running / stale / rate-limited status and a persona editor, so that I can manage my team.
112. As a developer, I want a memory view for all three layers, so that I can curate what agents know.
113. As a developer, I want a budget bar showing parallel agents, retries and runtime, so that I can keep cost under control.
114. As a developer, I want a Stop-all button on the Board, so that I can halt everything instantly.
115. As a developer, I want the Board to update live over SSE without refreshing, so that I always see the current state.
116. As a developer, I want the Board to be built and served by the Crew server itself, so that there is nothing else to run.

### Budget, safety and permissions

117. As a developer, I want a max number of parallel agents (default 3), so that I stay within my subscription limits.
118. As a developer, I want all of a tool's agents to pause and retry with backoff (or until the reported reset time) when its adapter detects a rate limit, shown as "rate-limited" on the Board, without using up a retry, so that hitting a limit doesn't fail tasks (D7, Claude-decided).
119. As a developer, I want limits on task depth, retries per task, runtime per run and tickets per phase, so that agents can't loop forever.
120. As a developer, I want processes that exceed max runtime or hang without output killed, with the run counted as one retry and the task escalated past the max, so that stuck agents don't waste budget (D22, user).
121. As a developer, I want `crew stop-all` and the Board kill switch to stop every agent and keep dispatch stopped until I run `crew resume`, even across restarts, so that I can halt the team in an emergency and an emergency stop never undoes itself (D23, user).
122. As a developer, I want spawned agents allowed to edit and run commands only inside their worktree, plus `crew *` commands, so that they can work but can't harm my system.
123. As a developer, I want `git push`, writes outside the worktree and destructive commands denied, so that agents can't publish or destroy anything.
124. As a developer, I want "everything allowed" mode granted only inside the worktree, so that full autonomy stays contained.
125. As a developer, I want each agent token to authenticate only that agent, so that one agent can't act as another.
126. As a developer, I want the server reachable only from my machine and protected from other web pages calling it, so that a malicious site can't drive my agents (D13, Claude-decided).
127. As a developer, I want Crew to send no telemetry, so that nothing about my code leaves my machine (D18, Claude-decided).

### Tool adapters

128. As a developer, I want a Claude Code adapter that runs `claude -p` headless with allowed/denied tool flags, so that Claude agents run under Crew's permissions.
129. As a developer, I want an optional Claude Code Stop hook that keeps the agent from ending its turn while its task is still `doing`, so that agents don't quit before calling `crew done` or `crew ask`. It lands in milestone 3, with verification (D26, D36, user).
130. As a developer, I want a Codex adapter that runs `codex exec` with sandbox and approval flags, so that Codex agents run under the same rules.
131. As a contributor, I want adding a new AI tool to mean writing one adapter against a fixed interface, so that Crew can grow to more tools easily.
132. As a developer, I want Antigravity agents usable in Pull mode until its headless interface is confirmed, so that I can still include it (D17, Claude-decided).

### Release quality

133. As a developer, I want every failure path (verification failure, conflict, rate limit, hung process) handled and tested, so that Crew is reliable on real projects.
134. As a developer, I want Crew proven end to end on a real project with a mixed Claude + Codex team before release, so that I can trust it from day one.
135. As a trusted tester, I want a private preview after milestone 5 that runs Claude Code teams from the CLI, so that I can give feedback before the Board and Codex support are built (D1, user).

## Implementation Decisions

### Process and runtime

- One Node.js + TypeScript process contains the CLI, API server, runner and served UI. Distributed as `npx crew`, with the `crew` binary as the package's bin entry.
- CLI built with `commander`. Server built with Hono. Storage is SQLite via `better-sqlite3` with Drizzle migrations. Spawned agents run as plain child processes via `execa` with structured JSON output; there is no PTY in spawn mode, so `node-pty` is not a dependency (D5, Claude-decided). Verify commands also via `execa`. Git through a thin wrapper around the git CLI (no libgit bindings).
- Board UI is Next.js (App Router, static export) + TypeScript + Tailwind + shadcn/ui, with a live log view for agent events, built at package time and served statically by the server (D80, D81). Live updates use SSE only (no WebSockets).
- Agents never talk to each other. The Board UI, runner and all agents go through the crew server.
- Supported platforms: Linux and macOS, with Windows only through WSL. Requires Node 22 LTS or newer. CI runs the test suite on Linux and macOS (D14, Claude-decided).
- All state lives in one Crew home at `~/.crew`: a single SQLite database for all workspaces, run logs and task worktrees (D12, Claude-decided).
- No telemetry of any kind (D18, Claude-decided).

### Modules

- **CLI:** human commands (`start`, `init`, `stop-all`, `resume` (D23, user), `status`, `worktree gc`, plus `approve`, `answer`, `memory`, `cancel` (D2, user) and `tasks`, `logs --follow`, `diff` (D16, Claude-decided), plus `results <task>` for verification results, `queue` for the merge queue and `retry <task>` to restart an escalated task (D44); final names are settled in the commands reference) and agent commands (`join`, `next`, `update`, `ask`, `remember`, `done`, `review approve|changes` (Reviewer only, D34), `phase`, `ticket create`, `assign`). Agent commands are thin HTTP clients of the server API; they identify the agent by token. Human commands call the same API endpoints as the Board, so anything possible on the Board is possible in the terminal (D2, user). They find the running server and its per-start secret through `~/.crew/server.json` (D25, user).
- **Commands reference:** every command's name, arguments, flags and help text are declared once. Both `--help` and the commands reference document are generated from those declarations, and handwritten examples sit around the generated parts (D3, user).
- **API:** REST + SSE endpoints (contract below). Validates input, enforces role permissions (Orchestrator-only commands), and drives the other modules.
- **DB:** schema and migrations for the full data model below.
- **Scheduler:** task state machine, dependency resolution, dispatch decisions within budget, retry/escalation counts, loop-protection limits.
- **Runner:** spawns adapter commands as child processes (D5, Claude-decided), parses their structured events through the adapter, streams them to the event bus and a log file, records each Run's session ID (D6, Claude-decided), resumes or respawns blocked tasks after an answer (D4, user), enforces max runtime and no-output timeouts, kills processes, records Runs with an exit reason (D21, user).
- **Worktree manager:** creates `crew/<task-id>-<slug>` branches and worktrees under the Crew home directory per workspace (D12, Claude-decided), cleans them up on merged/cancelled, and runs gc for abandoned ones.
- **Verify:** runs the gate pipeline (diff → commands → review) and stores a VerificationResult per step. Up to 2 pipelines run at once (D37, user). Failures are stored as feedback messages and included in the next run's prompt (D33, user). Plan: `milestone-3.md`.
- **Merge:** merge queue processed one item at a time per workspace: rebase onto latest default branch, re-run verify commands, merge with the configured strategy (`squash` by default, or `rebase`, D40), create conflict sub-tasks on rebase conflict (D41). Merges run in a detached integration worktree and only ever target the local default branch; Crew never pushes (D38). After a merge, the default branch ref is updated only if the user's own checkout isn't on that branch, or is on it and has no changes at all (then fast-forwarded, D54). Otherwise the queue pauses and a warning is shown on the Board and in `crew status` (D11, Claude-decided, D39, user). After a merge, the worktree is removed and the branch deleted (D43). Plan: `milestone-4.md`.
- **Memory:** three layers, injection within a context budget, promotion from role to project, CRUD for the Board.
- **Workflows:** Orchestrator phases (grill, spec, tickets, dispatch, integrate) defined on the server as data plus instructions, customisable per Board (add/remove phases, toggle gates).
- **Roles:** built-in roles (orchestrator, architect, backend, frontend, qa, reviewer) with default prompts and permission profiles; custom roles supported.
- **Adapters:** claude-code, codex, fake at launch; antigravity later.
- **Event bus:** in-process pub/sub that the API exposes as SSE per board and per run.

### Adapter interface

Every AI tool is one adapter implementing this shape (from the design doc):

```ts
interface AgentAdapter {
  id: "claude-code" | "codex" | "antigravity";
  detect(): Promise<{ installed: boolean; version?: string; headless: boolean }>;
  buildSpawn(opts: {
    prompt: string;          // persona + memory + task context
    workDir: string;         // task worktree
    permissions: PermissionProfile;
  }): { command: string; args: string[]; env: Record<string, string> };
  parseOutput(chunk: string): AgentEvent[];   // tool calls, errors, completion
  isRateLimit(event: AgentEvent): boolean;
  buildResume?(opts: {      // D4/D6: continue a session after an answer
    sessionId: string;
    prompt: string;         // the answer to the agent's question
    workDir: string;
    permissions: PermissionProfile;
  }): { command: string; args: string[]; env: Record<string, string> };
  installExtras?(workDir: string): Promise<void>; // optional; Claude Code's Stop hook doesn't use it, see D36
}
```

- The `AgentEvent` stream includes the session ID, and rate-limit events carry the reset time when the tool reports one. `buildResume` was added during grilling (D4, user) (D6, Claude-decided).
- **claude-code:** `claude -p --output-format stream-json` headless, with a Crew-generated `--session-id`, resumed with `--resume <id>` (D5, Claude-decided) (D6, Claude-decided); permissions mapped to allowed/denied tool flags; an optional Stop hook, passed as a Crew-written `--settings` file rather than files in the worktree, blocks stopping while the task is still `doing` (milestone 3, D26, D36, user).
- **codex:** `codex exec --json`; permissions mapped to sandbox and approval flags; session ID captured from its events and resumed with `codex exec resume <id>` (D5, Claude-decided) (D6, Claude-decided).
- **fake:** a scripted adapter that runs a script of `crew` CLI calls and file edits inside the worktree. Used for all pipeline tests and for local demos.
- **antigravity:** Pull mode only until its headless interface is confirmed (D17, Claude-decided).

### Task state machine

```text
todo → ready → doing → verifying → review → merge-queue → merged
                 ▲         │           │          │
                 └─failed──┘           │          └─conflict → rebase task
                 ▲                     │
                 └──changes requested──┘
        blocked (crew ask) ↔ doing
        escalated (retry limit exceeded) → human
```

- `todo → ready` only when every `blockedBy` dependency is `merged`.
- `ready → doing` triggers worktree creation and (Spawn mode) a run.
- `doing → verifying` on `crew done`.
- `verifying → doing` on gate failure, with an error summary attached and `retries` incremented. The summary is stored as a `feedback` message in the same transaction and goes into the next run's prompt (D33, user).
- `verifying → review` when diff and command gates pass; the review gate is a Reviewer agent run, or is skipped and recorded as skipped when the workspace has no reviewer agent (D34, user).
- `review → doing` on "changes requested", with feedback attached and `retries` incremented (D8, Claude-decided).
- `review → merge-queue` on approval.
- `merge-queue → merged` after rebase, re-verify and merge succeed. On conflict, a "rebase + resolve" sub-task is created for the same role and linked from the MergeQueueItem; when it is merged, the original task is `merged` too (D41, user).
- `merge-queue → doing` when re-verification of the rebased code fails, with feedback attached and `retries` incremented (D42, user).
- `escalated → doing` only by a human, through `crew retry` (D44, user).
- `doing → merged` for a phase task (`tasks.kind = 'phase'`) on `crew phase done`, with no verification or merge; no work task may take it (D60, user).
- `doing → blocked` on `crew ask`: the agent's process ends. `blocked → doing` on answer: the runner resumes the same session, or falls back to a fresh process with task context, the Q&A and a summary of the current diff (D4, user).
- A rate-limited run pauses its task without changing `retries` (D7, Claude-decided).
- A run that times out, goes silent or exits without `crew done` or `crew ask` counts as one retry, and the task is re-dispatched (D22, user). Runs ended by stop-all, a rate limit or a failed resume don't count.
- Any retrying state, including `merge-queue`, → `escalated` when `retries` exceeds the max (default 3), or when a worktree setup command fails (D45, user).
- `cancelled` from any non-terminal state, by the human.
- The scheduler is the only writer of task status; every other module requests transitions through it, and invalid transitions are rejected.

### Data model (SQLite)

| Table | Key fields |
| --- | --- |
| Workspace | id, name, repoPath, defaultBranch, config (json) |
| Board | id, workspaceId, currentPhase |
| Role | id, name, defaultPrompt, permissionProfile, isBuiltin |
| Agent | id, workspaceId, roleId, name, personality, systemPrompt, cliType, mode (spawn / pull), status, lastHeartbeatAt, tokenHash (D13, Claude-decided) |
| Task | id, boardId, title, description, acceptanceCriteria, status, assigneeAgentId, reviewerAgentId (D34, user), kind (work / phase, D60, user), roleId, createdBy, parentTaskId, depth, retries, branch, worktreePath |
| TaskDependency | taskId, blockedByTaskId |
| Run | id, taskId, agentId, adapter, pid, sessionId (D6, Claude-decided), resumedFromRunId (D4, user), startedAt, endedAt, exitCode, exitReason (D21, user), kind (work / review, D34, user), logPath |
| VerificationResult | id, runId, step (diff, review, or the name of a verify command), passed, output |
| Message | id, taskId, fromAgentId, type (comment / question / answer / result / feedback), body |
| Memory | id, workspaceId, layer (project / role / task), roleId, taskId, title, body, source, promotedAt |
| PhaseOutput | id, boardId, phase, body, status (draft / approved), approvedAt |
| MergeQueueItem | id, taskId, position, status (queued / rebasing / verifying / merging / merged / conflict / failed), conflictTaskId, commitSha, output (D46, user) |

### API contract

| Endpoint | Purpose |
| --- | --- |
| `POST /api/agents/join` | Agent identity, persona, workDir and memory from a token |
| `GET /api/agents/:id/next-task?wait=90` | Long-poll (Pull mode) |
| `POST /api/agents/:id/heartbeat` | Pull mode heartbeat |
| `POST /api/tasks` | Creates a task / ticket (with dependencies and criteria); Orchestrator or human only (D59, user) |
| `POST /api/tasks/:id/report` | Progress |
| `POST /api/tasks/:id/question` | Publishes a question |
| `POST /api/tasks/:id/answer` | Answer from the Board; agent resumes |
| `POST /api/tasks/:id/done` | Starts the verification pipeline |
| `POST /api/tasks/:id/review` | The Reviewer's verdict: approve, or changes with feedback. Only the task's current reviewer may call it (D34, user) |
| `POST /api/memory` / `PATCH /api/memory/:id` | Save / promote / edit memory |
| `GET /api/boards/:id/phase` / `POST /api/boards/:id/phase/approve` | Workflow phases; approve takes an optional edit or a rejection note (D61, user) |
| `GET /api/runs/:id/stream` | Live agent event stream (D5, Claude-decided) |
| `GET /api/tasks/:id/diff` | Live git diff |
| `GET /api/tasks` | Lists tasks and states (Board and `crew tasks`) (D16, Claude-decided) |
| `POST /api/tasks/:id/cancel` | Cancels a task (Board and terminal) (D2, user) |
| `POST /api/control/stop-all` | Kill switch; dispatch stays stopped (D23, user) |
| `POST /api/control/resume` | Restarts dispatch after stop-all (D23, user) |
| `GET /api/merge-queue` | Queue order, the item in progress, pause warning (`crew queue`, D2) |
| `POST /api/tasks/:id/retry` | Restarts an escalated task (human secret, D44, user) |
| `GET /api/board/:id/events` | SSE, live UI updates |

- The long-poll wait is always shorter than a typical agent Bash timeout (90 seconds default) and returns an explicit "no task, call again" response.
- Every endpoint the Board uses is also used by a human CLI command (D2, user).
- Every agent-facing response is plain, human-readable text suitable for an agent to act on, with structured data available for the Board.

### Configuration

- `crew.config.ts` optionally holds additive `team` entries (`name`, `role`, `cliType: claude-code|codex`), provisioned by init/start without deleting existing agents or silently changing their tool/role. It holds verify commands, roles, limits (max parallel agents, max retries, max depth, max runtime, no-output timeout, max tickets per phase) and merge strategy. `crew.config.ts` is loaded by `crew start` and copied into the workspace's stored config (D56, user); it also holds `permissions.allowCommands` (D58, user) and the workflow's gate toggles (D61, user). Until that lands in milestone 5, `mergeStrategy` (D40, user) and an optional `worktreeSetup` shell command (D45, user) are read from the workspace's stored config, like the verify commands.
- Verify commands are a named list. Each entry has a command, an optional working directory, a timeout (default 10 minutes), and optional path globs (matched with `picomatch`, D37). Until `crew.config.ts` loading lands in milestone 5, they are read from the workspace's stored config (D29, user). They run through a shell, because they are written by the user in their own config; an entry with globs runs only when the task's changed files match them. During merge-queue re-verification, every entry matching the rebased diff runs again (D10, Claude-decided).
- Defaults: max parallel verification pipelines 2 (D37, user), max parallel agents 3, max retries 3, max task depth 3, max runtime per run 30 minutes, no-output timeout 5 minutes, max tickets per phase 20 (D24, user), squash merge, long-poll wait 90 seconds, memory injection budget about 8k tokens (D15, Claude-decided), rate-limit backoff from 1 minute doubling up to 30 minutes (D7, Claude-decided).

### Permissions

- Each role has a permission profile, which the adapter maps to the tool's own flags.
- Spawned agents may edit files and run commands inside their worktree and run `crew *`.
- Claude Code tool rules deny `git push`, writes outside the worktree and destructive commands. Codex uses sandbox modes (D88): command allow/deny lists, push denial and the Orchestrator's one-output-file rule are advisory prompt rules, not per-command enforcement. Workspace-write network follows `allowNetwork`; read-only has no network, and full mode has unrestricted network.
- "Everything allowed" mode is explicitly configured by the human. On Codex it maps to `danger-full-access`, which has no OS filesystem or network containment (D88); the worktree boundary is a prompt rule plus the limited diff checks below.
- The diff gate also checks for out-of-worktree changes server-side, so permissions are enforced even if a tool's own sandbox fails: a changed path that is a symlink pointing outside the worktree fails, and so does any change to the main checkout's `git status` between run start and `crew done` (D31, user). The second check can false-positive if the user edits the main checkout during a run.
- The Reviewer runs with a `read-only` profile: it can read, search, `git diff|log|show` and call `crew review *`, and nothing else (D34, user).

### Local security (D13, Claude-decided)

- The server binds to 127.0.0.1 only and rejects requests whose Host header isn't a localhost name, which blocks DNS-rebinding attacks from web pages.
- Each agent gets a random token, stored only as a hash. Spawned agents get their token through an environment variable, never in the prompt text. Pull-mode agents get theirs in the connect prompt.
- `crew start` creates a per-start secret that the Board and the human CLI commands use, so other local processes and web pages can't call human endpoints.
- `crew start` writes the server URL, the per-start secret and its pid to `~/.crew/server.json` with mode 0600, and deletes it on shutdown. Human CLI commands read the secret from there; it is never printed (D25, user).
- How it's enforced: agents send their token in the `X-Crew-Agent-Token` header and can act only on tasks assigned to them (403 otherwise). Human endpoints, including the SSE streams, need the per-start secret in `X-Crew-Secret`. Missing or unknown credentials get 401.

### Rate limits (D7, Claude-decided)

- Adapters detect rate limits from structured error events, verified against recorded fixtures from real runs.
- On detection, every agent of that tool pauses. Crew retries with exponential backoff, from 1 minute doubling up to 30 minutes, or waits until the reset time if the tool reports one.
- Paused tasks keep their state and their retry count. The Board, `crew status` and `crew tasks` show "rate-limited".

### Verification gates (D29–D33, user)

- The diff gate commits anything the agent left uncommitted and fails an empty diff (D30). It then runs the out-of-worktree check above (D31).
- Every verify command that applies to the changed files runs, and all failures are reported together (D32). The full output (up to 64 KB) is stored in the VerificationResult; the feedback message carries the tail of each failing command.
- After a failure the task returns to `doing` and a fresh process starts with the feedback and a list of earlier failures in its prompt (D33).

### Reviewer gate (D8, Claude-decided)

- The review gate is a fresh Reviewer process with read-only permissions, given the diff and the task's acceptance criteria.
- When the team has more than one AI tool, the Reviewer runs on a different tool than the task's author.
- "Changes requested" uses the same retry limit as verification failures.
- The Reviewer answers with `crew review approve` or `crew review changes --feedback "..."`. The endpoint accepts only the task's current reviewer (`tasks.reviewerAgentId`), not the author (D34, user).
- With no reviewer agent in the workspace, the gate is skipped and recorded as skipped (D34, user). A Reviewer that ends without a verdict is re-run, up to 2 runs in total, then the task is escalated; the author is not charged a retry (D35, user).

### Memory budget (D15, Claude-decided)

- Injection stays within a configurable budget, about 8k tokens by default: project summary, then role memory, then task context.
- The Orchestrator rewrites the project summary when the spec is approved and during integrate.
- Anything over the budget is trimmed by relevance to the task first, then by recency. Tokens are estimated as characters divided by 4; persona, task and feedback are never dropped (D62, user). Role memory comes from `crew remember` and reaches project memory only by explicit promotion (D63, user).

### Human gates and Orchestrator lifecycle

- Each phase run is a task of kind `phase` (D60, user). Gates are on by default and configurable (D61, user). At a human gate the Orchestrator process ends. The phase output is stored as a draft PhaseOutput.
- On approval (after optional edits on the Board), the output goes into project memory and a fresh Orchestrator process is spawned for the next phase.
- Approvals and edits can be done on the Board or with the human CLI commands (D2, user).
- The dispatch phase has no Orchestrator process (D65, user), and a failed phase run is recovered with `crew retry` (D64, user).
- In the grill phase, the Orchestrator asks one question per `crew ask`, and each answer resumes it per the `crew ask` flow (D9, Claude-decided).

### Release and preview (D1, user)

- Private preview after milestone 5 for a few trusted testers: Claude Code only, driven from the CLI (human commands from (D2, user), plus (D16, Claude-decided)). No Board, Codex or Pull mode. Permissions, stop-all, budget and loop limits, and rate-limit handling are all active in the preview (D19, user).
- The public release rule is unchanged: all 8 milestones, plus the real end-to-end run with a mixed Claude + Codex team.

## Testing Decisions

### What makes a good test

- Tests check external behaviour only: what a user or agent can see through the `crew` CLI, the REST/SSE API, the database state that the Board shows, and the resulting git repository. They don't assert on internal function calls or module structure, so modules can be refactored freely.
- Each test sets up a real temporary git repository and a real SQLite database. No mocking of git or SQLite.

### The main seam: in-process pipeline harness

- One primary seam for almost all behaviour: start the real crew server in-process against a temp repo, register agents that use the **fake adapter**, and let the fake adapter run scripted sequences of real `crew` CLI commands and file edits inside its worktree.
- Assertions are made on task states and transitions, DB rows (Runs, VerificationResults, Messages, Memory, MergeQueueItems), SSE events, and the final git state (branches, worktrees, commits on main).
- This seam covers: the full state machine, dependencies and dispatch, worktree lifecycle, every verification gate, retries and escalation, merge queue, rebase and conflict sub-tasks, memory injection and promotion, phase workflow and human gates, Pull mode long-poll and heartbeat/stale handling, budget and loop limits, timeouts and kills, rate-limit pause and backoff, permissions checks, and stop-all. It also covers: resuming a blocked task's session and the fresh-process fallback (D4, user); every human CLI command, driven through the real CLI (D2, user); path-filtered verify commands (D10, Claude-decided); the merge queue pausing when the user's checkout is dirty and fast-forwarding it when clean (D11, Claude-decided, D39, user); re-verification on the rebased code, both merge strategies, conflict sub-tasks and their depth limit, cleanup after a merge, merge recovery after a restart, `crew retry` and worktree setup (D38, D40–D46, user); rejection of bad Host headers, bad tokens and missing per-start secrets (D13, Claude-decided); rate-limited runs not using up retries (D7, Claude-decided); "changes requested" counting toward retries (D8, Claude-decided); the diff, command and review gates, feedback in the next run's prompt, a skipped review and a Reviewer without a verdict (D29–D35, user); the Stop hook's blocking rules (D36, user); timed-out, silent or exited runs counting as one retry, with the right exit reason (D21, D22, user); and dispatch staying stopped after stop-all, across a restart, until `crew resume` (D23, user).
- The fake adapter emits the same structured events as the real adapters (including session IDs and rate-limit events) and supports resume (D5, Claude-decided).
- Every failure path named in the release criterion (verification failure, conflict, rate limit, hung process) has at least one harness test.

### Adapter contract tests

- The real adapters (claude-code, codex) are tested against recorded output fixtures: `buildSpawn` produces the right command, args and env for a given permission profile; `parseOutput` turns recorded chunks into the right events; `isRateLimit` recognises recorded rate-limit errors; `detect` handles installed / missing / old versions; `buildResume` builds the right resume command; session IDs are captured from recorded streams (D6, Claude-decided).
- Fixtures are recorded from real `stream-json` (Claude Code) and `--json` (Codex) runs, including real rate-limit errors (D5, Claude-decided) (D7, Claude-decided).

### Commands reference (D3, user)

- A test regenerates the commands reference from the command declarations and fails if it differs from the committed document.
- These are the only tests that know about a specific tool's flags and output format.

### Board UI

- The Board is tested through its REST/SSE contract via the same harness: the data and events it relies on are asserted there. No separate browser end-to-end suite in Phase 1.

### End-to-end

- Milestone 8 is a manual end-to-end run on a real project, from grill to merge, with a mixed Claude Code + Codex team.

### Tooling and prior art

- Vitest for all tests, run in CI on Linux and macOS (D14, Claude-decided).
- The repo is greenfield, so there is no prior art yet. The first harness tests written in milestone 1 become the pattern for all later ones.

## Out of Scope

- An MVP or partial release. Nothing ships publicly until milestones 1–8 are done and the end-to-end run succeeds.
- An Antigravity headless adapter (Pull mode only until its headless interface is confirmed).
- AI tools other than Claude Code, Codex and (Pull mode) Antigravity.
- MCP servers or edits to tool config files such as CLAUDE.md / AGENTS.md as a connection method.
- Hosted, cloud or multi-user deployment. Crew is local-only, single-user, on localhost.
- Agent-to-agent direct communication.
- Pushing to remotes or opening pull requests. Crew merges into the local default branch only.
- Browser end-to-end tests for the Board UI.
- Native Windows (Windows is supported through WSL only) (D14, Claude-decided).
- Telemetry or usage reporting (D18, Claude-decided).
- PTY capture and terminal emulation for spawned agents (D5, Claude-decided).
- Codex, Pull mode and the Board in the private preview (D1, user).

## Further Notes

### Build order

The release is one version, but built in this order, each milestone the foundation for the next:

1. **Core:** server, SQLite, full data model, task state machine, fake adapter.
2. **Runner and core safety:** adapter interface, Claude Code adapter, structured-event runner with session resume, timeouts, worktree manager (D5, Claude-decided) (D4, user). Also permissions, stop-all, budget and loop limits, and Claude Code rate-limit handling, so that no real agent ever runs without them (D19, user). Plan: `milestone-2.md`.
3. **Verification:** gates pipeline, retries, escalation, and the Claude Code Stop hook (D26, user). Plan: `milestone-3.md`.
4. **Merge:** merge queue, rebase, conflict tasks (dependencies themselves already exist from milestone 1). Plan: `milestone-4.md`.
5. **Memory and workflow:** memory layers, injection, `crew phase`, human gates.
   → **Private preview** for trusted testers once milestone 5 is done (D1, user).
6. **Board UI:** live agent logs, diffs, approvals, questions inbox, memory view.
7. **Breadth:** Codex adapter (with its permission mapping and rate-limit handling), Pull mode, heartbeat and stale detection (D19, user).
8. **End-to-end:** a real project from grill to merge with a mixed Claude + Codex team.

The commands reference and `--help` exist from milestone 1 (D3, user). Each human CLI command lands in the same milestone as the feature it controls, so the preview is fully usable from the terminal (D2, user).

### Release criterion

Milestone 8 succeeds, the full pipeline tests pass with the fake adapter, and every failure path (verification failure, conflict, rate limit, hung process) is tested.

### Open questions

- Does Antigravity have a headless / CLI interface? Its `--help` output is needed.
- What exactly do Claude Code and Codex rate-limit events look like? The detection strategy is decided (D7, Claude-decided), but real samples are needed for the fixtures.
- (Resolved by D82.) The Board sends the per-start secret on SSE through an HttpOnly session cookie, never a URL query parameter.
- Can the npm package be published as `crew`? The name was unpublished in 2024 and currently returns 404. Try to reserve it early, with a scoped name as the fallback.
- Resolved during grilling: how a spawned agent resumes after `crew ask` (D4, user), and how `crew.config.ts` handles monorepos (D10, Claude-decided).
