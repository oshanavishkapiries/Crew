# Milestone 5: Memory and workflow

The implementation plan for milestone 5 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** bullets 0–5 implemented and verified (257 tests across 43 files). Bullets 6–9 remain; the manual smoke has not been written or run. This milestone is not done. The proposals (P1–P10 below) were approved on 2026-10-20 and are logged in the PRD as D56–D65. D28 (the optional budget cap on the Claude Code adapter) is still open and unrelated.

## 1. Goal

A trusted tester can run Crew on a real repository from the terminal, with Claude Code only: `crew init`, `crew start`, then an Orchestrator grills them, writes a spec, creates tickets, the team builds and merges them through the pipeline of milestones 2 to 4, and the Orchestrator closes the run with a summary. Agents start with the right memory, and learnings flow from roles into the project.

When this milestone is done, the **private preview** ships (D1).

### Done when

- `crew init` in a git repo creates the workspace, a board, the built-in roles, a default team and a `crew.config.ts`. `crew start` loads that file, so verify commands, limits, merge strategy and `worktreeSetup` no longer live only in the database.
- An Orchestrator-only `crew ticket create` and `crew assign` work through `POST /api/tasks`. Any other role is rejected. The per-phase ticket limit holds.
- The three memory layers can be written by agents (`crew remember`) and by a human (`crew memory`), each entry records its source, and role learnings can be promoted to project memory.
- Every run prompt (work, review, phase) carries persona, role, project summary, role memory and task context, trimmed to the configured budget (about 8k tokens).
- A harness test walks one board through grill → spec → tickets → dispatch → integrate with a fake Orchestrator: it stops at each human gate, a fresh process starts after approval, approved outputs land in project memory, tickets become tasks, and the tasks merge.
- A phase run that fails, hangs or is cancelled can be recovered by a human without losing the board.
- `crew status` shows the board's phase and any pending gate.
- One manual smoke run with real Claude Code goes from grill to merge on a tiny throwaway repo.
- The architecture docs, the PRD and the handoff match the code.

## 2. Scope

**In:**
- `crew.config.ts` loading and `crew init`.
- Built-in roles and a default team, and project-test commands for roles (the open question left by milestone 4).
- Task creation over HTTP: `POST /api/tasks`, `crew ticket create`, `crew assign`.
- The memory layers, `crew remember`, `crew memory`, promotion, and prompt injection within a budget.
- The workflow engine: phases as data, the Orchestrator's `crew phase` and `crew phase done`, human gates, `crew approve`.
- Dispatch and integrate phases, including promotion of role learnings and the release summary.
- Recovery for phase runs (restart, stop-all, cancel, retry).

**Out (later milestones):**
- `crew join` and `crew next` (Pull mode, milestone 7).
- The Board's phase and memory screens (milestone 6).
- Codex and other tools (milestone 7).
- An Orchestrator that answers worker questions on its own (see §8).

## 3. What milestones 1 to 4 give us

- Tables for `memory`, `phase_outputs`, `boards.currentPhase`, `roles` and `agents` already exist with no code behind them (milestone 1).
- `crew ask` / `crew answer` already block a task and resume or respawn its session (D4). The grill phase can use them as they are (D9).
- Runs, permissions profiles, budget and loop limits, rate-limit pause, stop-all and resume, and the Stop hook.
- The Verifier, the Reviewer gate, the merge queue, `crew retry`, `crew queue`, and `worktreeSetup`.
- Tests create tasks through the Scheduler because there is no `POST /api/tasks` yet. This milestone adds it.
- Verify commands, `mergeStrategy` and `worktreeSetup` are read from `workspaces.config` today (D29, D40, D45).

## 4. Design

### 4.1 `crew.config.ts` and `crew init` (P1, P2)

`crew init` runs in a git repository. It records the workspace and a board, creates the built-in roles (§4.3), creates a default team of agents (one orchestrator, two developers, one reviewer, all `claude-code`), writes a commented `crew.config.ts`, and prints the next step. Running it twice changes nothing.

`crew.config.ts` is loaded when the server starts (`crew start`) and copied into `workspaces.config`, so the rest of the server keeps reading the database. The file wins on every start. It holds verify commands, `worktreeSetup`, `mergeStrategy`, limits (D24), roles and the workflow's gate toggles. A broken file stops `crew start` with a message that names the line.

Loading TypeScript at runtime needs a loader. Proposal: add `jiti`, pinned. The alternative is a `crew.config.json` and no loader.

### 4.2 Roles and project tests (P3)

Built-in roles: orchestrator, architect, backend, frontend, qa, reviewer, each with a default prompt and a permission profile (PRD roles module). The orchestrator role is read-only on the repository apart from one output file and `crew *`. Milestone 4 found that the `standard` profile can run neither git nor the project's tests. The config gets `permissions.allowCommands`, a list of command prefixes (for example `npm test`) that is added to the allow-list of roles that edit code. Nothing in it can allow `git push`.

### 4.3 Creating tickets (P4)

`POST /api/tasks` creates a task with title, description, acceptance criteria, role, blockers and optional assignee. It is open to the Orchestrator and to humans. Any other agent token gets a 403 (story 40). Creation is counted per board and phase; more than `maxTicketsPerPhase` (default 20, D24) is rejected. `crew ticket create` and `crew assign <agent> <task>` are thin clients. A task with no assignee is assigned to an idle agent of its role at dispatch.

### 4.4 Memory (P7, P8)

Three layers, as in the PRD: project, role, task. Each entry has a title, body, source (agent, human or phase) and `promotedAt`.

- Agents: `crew remember "..."` saves to their role's memory with source `agent:<id>`.
- Humans: `crew memory list|add|edit|delete|promote`. Promote copies a role entry into project memory and records `promotedAt`.
- The Orchestrator promotes role learnings during integrate (story 103) through the same promote call.

**Injection.** One builder assembles every prompt: persona and role prompt, then the project summary and conventions, then role memory, then task context (parent task, results of finished blockers, earlier messages and failures, relevant files). It estimates tokens as characters divided by 4 (no tokenizer dependency). Over the budget, entries are dropped by relevance to the task first (word overlap with its title, description and changed files), then by age. The persona, the task itself and the current feedback are never dropped. The same builder serves the fresh-process fallback of D4 and the Reviewer, so all prompts agree.

### 4.5 Phases as tasks (P5)

The Orchestrator is an agent, not a daemon, so each phase run is a task: migration `0004` adds `tasks.kind` (`work` | `phase`). A phase task goes through the normal dispatcher, runner, permissions, rate-limit and stop-all machinery. What differs:

- It runs in a throwaway worktree of the default branch with the orchestrator profile, so it can read the code.
- `crew phase` prints the current phase, its instructions and the memory to read. `crew phase done --output <file>` stores the file's text as a draft `PhaseOutput`, ends the run, and moves the task `doing → merged` (a transition only phase tasks may take). There is no diff gate, review or merge for a phase task.
- Phase instructions live on the server as data (`src/server/workflow/`), with the five phases of the PRD and gate toggles from the config.

### 4.6 Human gates (P6)

After grill, spec and tickets the board waits at a gate with the draft output. `crew approve [--edit <file>]` (and `crew approve --reject --note "..."` to send it back) marks the output approved, then starts a fresh phase task for the next phase (PRD "Human gates and Orchestrator lifecycle"). Rejection starts a new run of the same phase with the note in its prompt. Approving the spec writes it into project memory and asks the next phase run to refresh the project summary (D15). Gates can be switched off per phase in the config; an ungated phase goes straight on.

Phase flow:
1. **grill:** the Orchestrator asks one question at a time with `crew ask`, the human answers with `crew answer` (D9). Output: requirements. Gate.
2. **spec:** goals, non-goals, architecture, acceptance criteria. Gate. Approved spec goes to project memory.
3. **tickets:** the Orchestrator creates tickets with `crew ticket create` (blockers and criteria included), then submits a summary. Gate. Approval turns the tickets from `todo` into runnable tasks.
4. **dispatch:** no Orchestrator process (P10). Crew assigns by role, the existing pipeline runs, and the phase ends when every ticket is terminal.
5. **integrate:** the Orchestrator reviews the role learnings, promotes the good ones, rewrites the project summary and writes a release summary. Final gate, then the board is `done`.

### 4.7 Recovery (P9)

A phase task that escalates (retries, timeout, crash) leaves the board waiting on a human, shown in `crew status`. `crew retry <phase task>` works exactly as for work tasks (D44). Stop-all and restart behave as for any run. Cancelling a phase task cancels nothing else; the board stays in that phase so the human can retry. A gate is never lost on restart: a draft output is in the database.

## 5. Tracer bullets, in order

Each slice runs end to end and lands with its harness test. Same commit rules as milestone 4: one commit per bullet, tests and docs in that commit, nothing pushed.

0. **Config and init.** `crew.config.ts` loading, `crew init`, built-in roles, default team, `allowCommands`. Test: init twice in a temp repo, start the server, change the file, restart, and see the database follow it; a broken file stops start.
1. **Creating tickets.** `POST /api/tasks`, `crew ticket create`, `crew assign`, Orchestrator-only and ticket-limit checks. Test: a worker token gets 403; the 21st ticket in a phase is rejected; blockers and cycle checks still hold.
2. **Memory store and human CLI.** The memory API, `crew remember`, `crew memory`, promotion with `source` and `promotedAt`. Test: each layer, role isolation, promote.
3. **Memory injection.** The prompt builder with the budget and trimming, used for work, review, phase and fallback prompts. Test: an overflowing set of entries is trimmed by relevance then recency, protected parts survive, the Reviewer sees the same project memory.
4. **Phase engine.** Migration `0004`, phase tasks, `crew phase`, `crew phase done`, `PhaseOutput`, gates, `crew approve`. Test: a fake Orchestrator stops at a gate, a fresh run starts after approval, reject sends it back with the note.
5. **Grill, spec, tickets.** The three early phases with a scripted fake Orchestrator, `crew ask` / `crew answer` in grill, spec into project memory, tickets created and released on approval.
6. **Dispatch and integrate.** Assignment by role, the dispatch phase ending when every ticket is terminal, integrate with promotion, summary rewrite and release summary, board `done`. Test: a three-ticket board with a dependency goes from grill to `done` and the default branch holds all three.
7. **Interruptions.** Restart at every phase and gate, stop-all during a phase run, cancel, escalated phase task and `crew retry`, unauthorised callers. Prove child processes are gone.
8. **Human CLI polish.** `crew status` with phase and gate, `crew tasks` filters, `docs/commands.md` regenerated.
9. **Smoke run (manual, script only).** `scripts/smoke-milestone-5.ts` and `npm run smoke:m5`: a tiny throwaway repo, real Claude Code Orchestrator and two workers, a real Reviewer, scripted human answers and approvals through the real CLI. It must assert on phases reached, tickets merged, memory rows with sources, and the final `git log`, and fail if any is missing. The agent writes it and does not run it. Cost is the biggest of any smoke so far, so it carries a run cap and a deadline.

## 6. Testing notes

- Everything goes through the in-process harness (PRD testing decisions). The fake adapter learns Orchestrator scripts: ask a question, create tickets, call `crew phase done`.
- The human is a test helper that runs the real CLI (`crew answer`, `crew approve`).
- Wait on events (`phase_changed`, `task_status_changed`), never sleep.
- Prompt tests assert on the text a fake adapter received.
- Do not repeat the milestone 2 to 4 bugs: re-dispatch of a killed run, a loop on a paused tool, a vacuous smoke pass. Each phase transition needs a race test, and the smoke script must assert the things it claims.

## 7. Decisions from this plan

Proposed here and approved by the user on 2026-10-20. The PRD Decision Log holds the full text.

| ID | PRD ID | Decision |
| --- | --- | --- |
| P1 | D56 | `crew.config.ts` is loaded at `crew start` and copied into `workspaces.config`; the file wins on every start. The loader is `jiti`, pinned (alternative: JSON, no loader). |
| P2 | D57 | `crew init` creates the workspace, board, built-in roles, a default Claude Code team (orchestrator, two developers, reviewer) and a config template, and is safe to run twice. |
| P3 | D58 | Config gets `permissions.allowCommands` (command prefixes added to code-editing roles; never `git push`). This closes milestone 4's "standard profile cannot run tests" gap. |
| P4 | D59 | `POST /api/tasks`, `crew ticket create` and `crew assign` are Orchestrator-or-human only; at most 20 tickets per phase. |
| P5 | D60 | Each phase run is a task with `tasks.kind = 'phase'`, run by the normal dispatcher and runner in a throwaway worktree with the orchestrator profile, and finished by `crew phase done` with a transition `doing → merged` that only phase tasks may take. |
| P6 | D61 | Gates after grill, spec and tickets (and integrate) are on by default and configurable; `crew approve [--edit] [--reject --note]` approves or sends back. |
| P7 | D62 | Memory injection uses a character-based token estimate (chars / 4), a default budget of 8k, and drops entries by relevance, then age; persona, task and feedback are never dropped. |
| P8 | D63 | `crew remember` writes role memory; promotion to project memory is explicit (`crew memory promote`, and by the Orchestrator in integrate) and records `promotedAt`. |
| P9 | D64 | A failed phase run escalates like a work task; `crew retry` recovers it, and the board stays in its phase. |
| P10 | D65 | The dispatch phase has no Orchestrator process: Crew assigns by role and the phase ends when all tickets are terminal. Worker questions go to the human. |

## 8. Open questions

- **Loader.** `jiti` or a JSON config? TypeScript is the PRD's wording; JSON is one dependency fewer and can't run code.
- **Orchestrator answering questions (story 32).** P10 sends worker questions to the human. An Orchestrator that answers them costs a long-lived or repeatedly resumed process. Is the human-only answer acceptable for the preview?
- **Orchestrator output file.** Claude Code should be allowed to write exactly one file in its throwaway worktree. The implementer must confirm which permission flags achieve that on 2.1.300, and record a fixture.
- **Agent tokens after restart.** Agent tokens are hashed in the database but the runner keeps plain tokens in memory (milestone 2). After a restart a default team may have no usable tokens. The implementer must check this in bullet 0 and, if so, propose how `crew init` and `crew start` mint them.
- **Preview packaging.** How testers install it (npm tag, tarball or git URL) and the README quick start are not decided. Out of this milestone's code but needed before the preview ships.
- **Rejecting a gate repeatedly.** There is no limit on rejections. Is the existing run budget enough?

## 9. Proposed during implementation

- **Config layout and validation (bullet 0).** Use flat limit names (`maxParallelAgents`, `maxParallelVerifications`, `maxRetries`, `maxDepth`, `maxRuntimeMs`, `noOutputTimeoutMs`, `maxTicketsPerPhase`, `memoryBudgetTokens`), `permissions.allowCommands`, `roles.<name>.defaultPrompt` / `permissionProfile`, and `workflow.gates.<phase>`. Durations are milliseconds. Reject unknown options and invalid values before binding the server; load all files successfully before changing stored configuration. This makes typos actionable and avoids partially applying a multi-workspace start. `jiti` is pinned to **2.7.0** (the loader itself was already approved in D56); its module and filesystem caches are disabled so imported settings also refresh.
- **Existing workspaces without a config (bullet 0).** Preserve their stored settings when `crew.config.ts` is absent, for compatibility with milestones 1–4. Run `crew init` to create the template. A present file always replaces the entire stored config; removed options return to runtime defaults. A missing file therefore does not reset stored settings. This compatibility policy also applies if a user removes a config after initialization; making that an error would require tracking whether a file was previously required.
- **Role configuration (bullet 0).** Keep built-in role rows shared, apply prompt/profile overrides per workspace at run time, and give custom roles workspace-qualified IDs. Keep the reviewer and Orchestrator permission profiles fixed; their prompts remain configurable. This avoids one repository changing another repository's built-in permissions. Config `allowCommands` entries are literal command prefixes, expanded to exact and argument-bearing Bash rules only for editing roles. Entries containing shell operators or permission syntax are ignored. Git prefixes must name one literal supported subcommand (`diff`, `status`, `log`, `show`, `add`, `commit`, `rebase`, `rev-parse`, `ls-files`, `ls-tree`, `grep`, `blame`); bare Git, absolute Git executables and global-option prefixes are ignored. This closes the documented `git -C ... push` bypass without shell-policy infrastructure; the adapter's fixed push denials also remain present. The initial Orchestrator profile permits reading and `crew *` but grants no file edits. The single output-file rule and the real Claude Code 2.1.300 fixture were deferred from bullet 0 to bullet 4; see the verified probe below. No bypass mode is used.
- **Default branch discovery (bullet 0).** `crew init` reads the local `origin/HEAD` symbolic ref, otherwise prefers an existing `main`, then `master`, then the currently checked-out branch. No network request or git configuration change is made. Repositories with an unconventional default and no local `origin/HEAD` should initialize while on their default branch.
- **Agent tokens after restart: finding (bullet 0).** Plain tokens are lost, but the existing Runner `getOrCreateAgentToken()` already mints a replacement on the first run after restart, updates the stored hash and retains the plain value in memory. Preserve that mechanism; `init` stores only an initial random hash. A harness test uses the initialized default team with the fake adapter across two server instances, authenticates through real CLI calls, and rejects the previous token. No new token persistence or minting mechanism is proposed.

- **Review fixes (bullet 0).** Initializing an existing workspace repairs missing default roles, team members and its board without replacing existing workspace/board data. Removing a custom role configuration resets its stored prompt/profile to safe standard defaults while preserving referenced IDs, so old privileges cannot survive file replacement. The real Reviewer prompt and role-specific Stop hook now use workspace overrides. A fresh read-only review found these issues plus broad Git prefixes; each has a regression test observed failing before the fix. No shell sandbox is added: arbitrary trusted project test commands can still execute other programs indirectly.
- **Limit scope (bullet 0).** Runtime, retry, dispatch and verification limits are per workspace. Without an explicit in-process server ceiling, dispatcher/verifier total capacity is the sum of workspace capacities; each workspace still has its own cap. Explicit server options retain a total ceiling for harness and embedding callers. Ticket/memory/gate limits are validated and stored now and will gain consumers in their respective bullets.

- **Init visibility and adapter pattern fix (after bullet 0).** Init explains in one line that its untracked config pauses merging until reviewed and committed. Merge pause warnings carry the same hint into status and queue output. Explicit adapter `allowCommands` wildcard patterns remain unchanged; plain prefixes retain exact and argument-bearing rules. Config command filtering remains as reviewed in bullet 0. This is a correction, not a change to D39/D58.

- **Ticket provenance and migration order (bullet 1).** Generate `0004_clever_red_hulk.sql` in bullet 1 rather than bullet 4: the per-board/per-phase quota needs durable `tasks.creationPhase`, so counting cannot depend on timestamps, in-memory counters or an agent's claim. Include the already-approved `tasks.kind` column in that migration; phase transitions/engine still belong to bullet 4. Existing tasks default to `work` with no creation phase and do not consume the new ticket quota. Cancelled tickets continue to count. Failed creations roll back and do not count. The upgrade test opens a milestone 4 database and preserves existing rows, including merge output, memory and draft phase output.
- **Ticket caller context (bullet 1).** Human creation requires explicit board and expected phase (`--board`, `--phase`); this avoids selecting the wrong repository or accepting a stale request. An agent must be an Orchestrator with a live, assigned, active phase task whose stored creation phase matches the board. Its board/phase are inferred and cannot be overridden; ended, cancelled, stopped and stale-phase runs cannot mutate tickets. Add `POST /api/tasks/:id/assign` for the thin assignment CLI (the PRD names the command but no assignment endpoint). Assignment accepts an agent ID/exact name or a staffed role, only for todo/ready work tickets; assigning a role clears an explicit assignee. Reject unstaffed roles and cross-board, phase-task, cancelled or escalated blockers at creation so an invalid request leaves no stranded ticket. The existing Scheduler still owns statuses, dependency/cycle checks and dispatch assignment. Gate-based release of tickets follows in bullet 5; this slice proves creation/dispatch on an existing dispatch board.

- **Assignment during setup (bullet 1).** Recheck the Scheduler-returned assignee before spawning after asynchronous worktree setup. If a human reassigned the ready ticket meanwhile, release the old agent and let the next dispatcher pass run the new owner without charging a retry. A real setup command calls the assignment API inside this window; the regression proves no run starts for the old owner. This uses the existing dispatch loop rather than new locking infrastructure.

- **Memory API and CLI scope (bullet 2).** Add human/agent `GET /api/memory`, human/agent `POST /api/memory`, human `DELETE /api/memory/:id` and `PATCH /api/memory/:id` for human edits or explicit promotion. Human list/add require a workspace; add also names the layer and its role/task ID. Agent creation always infers its workspace and role and records `agent:<id>`; agents cannot edit/delete entries or spoof provenance. Reads include project memory, the caller's own role, and tasks assigned to it or designated for its review. Human edits preserve the original source; no edit-history table is added. Promotion copies a role entry into project memory with `source = promotion:<original-id>:<original-source>` and stamps both rows with `promotedAt` atomically; repeated promotion is a clear conflict. The same PATCH call accepts a live integrate Orchestrator's `contextTaskId`, separate from a memory entry's task scope. Until the phase engine exists, its authorization is tested with a seeded phase context. No schema or dependencies change.

- **Shared prompt budgeting (bullet 3).** `memory/prompt.ts` is the single builder for work, Reviewer, phase-task and fallback/resume runs. Caller-supplied run text is additional protected instructions, never a replacement for persona/task/memory. Workspace role overrides, agent system prompt/personality, task/criteria and latest feedback survive trimming. Project then own-role memory precede task context; task memory is restricted to the current task. Parent details, merged-blocker result messages, earlier messages/failures and Git file context are optional context. Reviewer diff/results and fallback Q&A/diff summary use the same budget. Rank optional entries by unique word overlap with task title/description and changed-file/status paths, dropping lower overlap before older entries; ties preserve insertion order. Budget includes rendered headings and protected text, estimates characters/4 and defaults to 8000. If protected text alone exceeds the configured budget, retain it in full and remove all optional entries; silently truncating feedback would violate D62. Git discovery uses argument arrays with hooks disabled and never stages untracked files. Phase instructions can be supplied now, but the phase engine and real output-file permission fixture remain bullet 4.

- **Reviewer diff and conversation protection (review fix after bullet 3).** Keep every question/answer in protected context for D4 fallback. Keep the Reviewer diff protected, capped to the smaller of 16,000 characters and half the configured character budget (at least one character), with `[truncated; run git diff <base>...HEAD for the rest]` when capped. Protected context can still exceed the budget under D62. Preserve the entire D33 earlier-failure list before optional memory when it fits alongside protected context; otherwise omit that list as a unit with an explicit notice, while retaining current feedback. This replaces the earlier §9 description of optional Q&A/diff/history.

- **Phase output permissions verified (bullet 4).** Recorded Claude Code **2.1.300** under `dontAsk` / `--permission-prompts none`, with `Edit(//absolute/output/path)` and no broad Edit denial: the allowed file changed, another Edit was denied with its bytes preserved, and a real built `crew phase done --output` authenticated an exact-text POST. `test/fixtures/claude-code/phase-output-dontask.json` records tool results, denial, bytes and the HTTP call. The pre-engine receiver records transport; it is deliberately not claimed to be the workflow engine. Engine semantics are exercised separately through the pipeline harness. Settings sources were disabled in the probe so a broader user permission could not mask a failure. Scoped phase spawn/resume also pass `--setting-sources ""`, matching the fixture and preventing wider user/project permission rules from broadening the grant; Crew-owned hook settings can still be supplied. A contract regression failed before these runtime flags were added. No bypass mode or scoped Write rule is used. The Runner creates the output file in the detached phase worktree, forces the Orchestrator profile, and supplies the scoped path only for a phase task; ordinary work cannot inherit that grant. The completed probe cost $0.0598478 (a preliminary Edit-only probe cost $0.0586506), each with a $0.50 cap and two-minute deadline.
- **Phase persistence and gates (bullet 4).** Generated `0005_concerned_bloodstrike.sql` adds nullable `phase_outputs.task_id` (unique when set), preserving legacy drafts, and a partial unique index on board/creation-phase for active phase tasks. Phase completion writes its draft alongside the Scheduler-only phase `doing → merged` transition. Work tasks cannot take that transition, and phase tasks cannot use the work completion endpoint. Detached phase worktrees run setup, bypass verification/review/merge, and are removed after their child process exits; server shutdown kills runs and awaits owned cleanup. Approvals atomically decide the expected draft and create the next phase task (or advance to dispatch/done without an Orchestrator). Rejection creates a fresh same-phase task with protected feedback and no retry charge. Spec-memory publication and ticket release are now implemented in bullet 5 below; dispatch/integrate completion remains bullet 6.
- **Human phase commands and recovery (bullet 4).** `crew phase` and `crew phase done --output <file>` infer the live assigned Orchestrator context via task-specific POST endpoints. Human inspection uses `GET /api/boards/:id/phase`; approval uses the PRD endpoint. `crew approve` requires `--board`; optional `--draft` pins the expected output, otherwise the CLI fetches the current draft before submitting its ID. `--edit` sends the edited file text, not a path. Status exposes phase/gate/task and recovery commands now because failure recovery must be usable in this slice; broader polish remains bullet 8. Escalated phase tasks use existing human retry. A cancelled phase remains terminal and human retry creates a replacement in the same phase, avoiding an automatic escape from cancellation; cancelled work remains terminal. A missing team is repaired with init then resume. Invalid output/rejection requests leave the phase/draft available for correction. Preparation failures charge a bounded retry with feedback rather than leaving an orphan; executable spawn failure records a nonzero phase exit.
- **Scope and narrow windows (bullet 4).** DB uniqueness and a small per-phase starting-run guard prevent duplicate active tasks or overlapping starts in one server. Existing Dispatcher/Runner stop, rate-limit and retry mechanisms are reused. Phase output and completion are atomic, but gate visibility can precede child-process exit: Dispatcher waits for the assigned agent's existing live run before starting the successor. Without `--draft`, a CLI invocation reads whichever gate is current when its GET arrives; use `--draft` to pin an earlier observed gate. No additional locking protocol is introduced for that client timing window. Tests cover concurrent/stale approvals, a stale approval during a live successor, gate restart, failure/retry, timeout/stop/cancel PIDs, and draft preservation across stop-all. Arbitrary crash/restart at every running phase and the narrower in-request stop/cancel interleaving remain bullet 7. Config-loader CLI tests use the real persisted stop marker to avoid accidentally dispatching their initialized real-Claude team when workflow startup is enabled; their config assertions are unchanged.

- **Fresh phase context (bullet 4 diff-read fix).** Successor/rejected tasks receive the approved/edited or rejected draft text as task context and link their predecessor through `parentTaskId`. Preserve prior questions/answers as messages in each successor or cancelled-phase replacement, in the same creation transaction, so the protected Q&A builder can retain the human's answers. A cancelled replacement also retains its predecessor's task description. This avoids asking humans to reconstruct context after a new process starts; it does not replace project-memory publication in bullet 5. Three regressions for edited output, rejected output and cancelled-phase Q&A failed before this fix.

- **Early workflow (bullet 5).** Grill uses the existing real ask/answer path, including refused-session fresh-process fallback; successor tasks keep protected Q&A. Spec approval inserts the actual edited text into project memory as `phase:spec:<draft-id>` in the same transaction as draft approval and successor creation; rejection inserts nothing. Ungated specs use the same publication path. Tickets instructions read that memory and refresh the summary in their output; the persisted project-summary rewrite remains integrate work in bullet 6.
- **Ticket gate and recovery (bullet 5).** Tickets created in the tickets phase stay `todo`, including tickets without blockers. Scheduler creation, explicit ready transitions and dependent promotion respect that hold. Approval validates active work-ticket dependencies, atomically approves the draft, advances to dispatch and releases only dependency-ready tickets; it publishes events after commit. Zero tickets is a valid plan. Rejection retains existing tickets and quota counts, starts a fresh planning task and releases nothing. Inspect with `crew tasks`, reuse/assign the retained tickets, or have the human `crew cancel <id>` discard unwanted ones, then submit and approve a revised plan. Cancelled tickets still consume the durable per-phase quota (D59); at the quota, recover by reviewing/cancelling and approving the retained set rather than creating replacements. A bad create request leaves no row or quota charge: correct `--blocked-by` and repeat `crew ticket create`. At approval, a bad blocker/cycle preserves the draft and every held status: human retry an escalated blocker, or cancel the affected dependents, then approve again. Gate rejection and bad blockers are exercised through real human commands.
- **Human authentication regression (bullet 5).** A live fake Orchestrator successfully approved another board's real pending gate before the fix: human CLI authentication loaded `server.json` despite the agent token. `getServerInfo` now rejects a process carrying `CREW_AGENT_TOKEN` before reading the human secret; memory commands continue to prefer agent authentication and deny deletion and promotion outside a live integrate task. This is command/protocol isolation, not an OS sandbox against a same-user process deliberately clearing its environment and reading credentials.
- **Narrow windows (bullet 5).** Ticket rejection preserves rows instead of introducing draft-ticket batches or deletion/rollback machinery. The summary text is advisory: approval releases the board's retained active tickets, so a human can create/assign/cancel tickets between summary submission and approval; inspect `crew tasks` before approval. Dependency validation and release share the approval transaction. A crash after commit but before events leaves durable ready tickets for the existing restart dispatcher. Exhaustive crash/interruption interleavings remain bullet 7; zero-ticket dispatch completion remains bullet 6. No migration or new dependency is needed.
