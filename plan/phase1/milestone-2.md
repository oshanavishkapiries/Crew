# Milestone 2: Runner and core safety

The implementation plan for milestone 2 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** approved, not started. The decisions this plan proposed were approved on 2026-10-19 and are logged in the PRD as D21–D26.

## 1. Goal

A real Claude Code agent can pick up a task, work in its own worktree under Crew's permissions, report through `crew`, ask a question and resume after the answer, and be stopped, timed out or paused for a rate limit. All of it is proven through the harness with the fake adapter, plus contract tests on recorded Claude Code output.

From the PRD build order: adapter interface, Claude Code adapter, structured-event runner with session resume, timeouts, worktree manager (D4, D5), plus permissions, stop-all, budget and loop limits, and Claude Code rate-limit handling, so no real agent ever runs without them (D19).

### Done when

- A harness test drives a task from `ready` to `verifying` through dispatch → worktree → run → `crew done`, with the work landing in the task's worktree and branch, not the user's checkout.
- `crew ask` ends the run, `crew answer` resumes the same session, and a failed resume falls back to a fresh process. Both paths are tested.
- Max runtime, no-output timeout, stop-all and rate-limit pause each have a harness test. A rate-limited run doesn't use up a retry (D7).
- The Claude Code adapter passes contract tests against recorded `stream-json` fixtures, including the permission mapping.
- Every human command whose feature lands here works through the real CLI (D2) and is in `docs/commands.md` (D3).
- One manual smoke run with real Claude Code on a throwaway repo succeeds.
- The architecture docs, the PRD and the handoff match the code.

## 2. Scope

**In:**
- Versioned DB migrations (the first schema change happens here).
- Worktree manager: create, clean up, gc.
- Runner: spawn, structured events, logs, Run records, exit outcomes, kill, timeouts.
- Dispatcher: picks ready tasks within the parallel-agent limit.
- `crew ask` / `crew answer` with session resume and the fresh-process fallback (D4, D6).
- Claude Code adapter with permission mapping and rate-limit detection.
- Safety: permission profiles, stop-all, budget and loop limits, rate-limit pause and backoff (D7, D19).
- Human commands that control these features: `stop-all`, `answer`, `cancel`, `worktree gc`, `logs --follow`, `status`, `tasks`, `diff` (D2, D16).

**Out (later milestones):**
- Verification gates, the diff gate's out-of-worktree check, retries from gate failures (milestone 3). Here a task stops at `verifying`.
- Merge queue, rebase, worktree cleanup on `merged` (milestone 4).
- Memory injection, `crew remember`, `crew join`, phases, `crew ticket create` (milestone 5). Spawn prompts here carry persona, role and task context only.
- The Claude Code Stop hook (`installExtras`). It blocks stopping "before verification passes", so it needs milestone 3 (D26).
- Codex, Pull mode, heartbeat (milestone 7, D19).

## 3. What milestone 1 gives us

- `Scheduler` is the only writer of task status, transactional, with events published after commit. It already handles `doing ↔ blocked`, retries and escalation.
- The DB schema already has `tasks.branch`, `tasks.worktreePath`, `runs.pid`, `runs.sessionId`, `runs.resumedFromRunId` and `runs.logPath`.
- `EventBus.publishRunEvent` and the `/api/runs/:id/stream` SSE endpoint exist.
- `AgentAdapter` includes `buildResume`. `FakeAdapter` emits structured JSON lines and drives real `crew` calls.
- Auth: agent tokens and the per-start secret are enforced (D13).

## 4. Design

### 4.1 DB migrations

Today `runMigrations` runs one `CREATE TABLE IF NOT EXISTS` script, so a new column never reaches an existing `~/.crew/crew.db`. Switch to Drizzle's migrator over the `drizzle/` folder: generate a migration per schema change with `drizzle-kit`, ship `drizzle/` in the package, and apply pending migrations on open. Do this first, because milestone 2 adds columns.

Schema changes in this milestone:
- `runs.exitReason`: `done | asked | exited | timeout | no-output | stopped | rate-limited | cancelled | resume-failed` (D21). `exitCode` alone can't tell a timeout from a crash.
- `runs.prompt` or a prompt file path, so a fresh-process fallback and debugging can see what the agent was given.

### 4.2 Worktree manager (`src/server/worktree/`)

- On `ready → doing`: `git worktree add -b crew/<task-id>-<slug> <crewHome>/worktrees/<workspace-id>/<task-id> <defaultBranch>`, then store `branch` and `worktreePath` on the task, in the same transaction as the transition (via `TransitionContext.alongside`, or create the worktree first and roll it back if the transition fails).
- Slug: lowercase title, non-alphanumerics to `-`, max 40 characters.
- If the worktree already exists (a re-dispatch after a retry or stop-all), reuse it.
- On `cancelled`: remove the worktree. Keep the branch so the work isn't lost (`git worktree remove --force`, no `git branch -D`).
- `crew worktree gc`: remove worktrees whose task is terminal or missing, then `git worktree prune`. Print what it removed.
- The git wrapper is a thin `execa('git', …)` helper, with no shell (same rule as the fake adapter fix).

### 4.3 Runner (`src/server/runner/`)

One `Runner` owns all live child processes.

**Start a run:**
1. Create a `runs` row (adapter, agent, task, startedAt, sessionId if the adapter assigns it up front: Claude Code does, D6).
2. Build the command with `adapter.buildSpawn` (or `buildResume`).
3. Spawn with `execa`: `cwd` = worktree, the prompt on **stdin** rather than in argv (long prompts can hit argv limits), `detached: true` so the whole process group can be killed, `env` = a minimal allowlist (PATH, HOME, locale, the tool's own auth vars) plus `CREW_SERVER_URL`, `CREW_TASK_ID` and `CREW_AGENT_TOKEN` (D13).
4. Make sure `crew` resolves inside the agent: put a small `crew` shim (`#!/bin/sh` → `exec node <dist/cli.js> "$@"`) in `<crewHome>/bin/` and prepend it to the agent's PATH. Under `npx`, `crew` is otherwise not on PATH.

**While it runs:**
- Split stdout into lines, pass them to `adapter.parseOutput`, publish each event with `publishRunEvent(runId, …)`, and append the raw line to `<crewHome>/logs/<run-id>.jsonl` (`runs.logPath`).
- Capture the session ID from events when the adapter reports it there (Codex, later).
- Reset the no-output timer on every line.
- If `adapter.isRateLimit(event)`, hand off to rate-limit handling (4.7).

**Exit outcomes** (the runner reads the task status after the process exits):

| Situation | exitReason | Task |
| --- | --- | --- |
| Task is `verifying` (agent called `crew done`) | `done` | Unchanged |
| Task is `blocked` (agent called `crew ask`) | `asked` | Unchanged; waits for the answer |
| Killed by max runtime | `timeout` | Retry (see below) |
| Killed by no-output timeout | `no-output` | Retry |
| Exited while still `doing` | `exited` | Retry |
| Killed by stop-all | `stopped` | Stays `doing`, no retry used |
| Rate limit detected | `rate-limited` | Stays `doing`, no retry used (D7) |

**"Retry"** means: increment `retries` through the scheduler and re-dispatch, or `escalated` past the max. There is no separate `failed` state: a failed run counts like a failed verification attempt, a retry and then `escalated`, so a hung agent costs at most `maxRetries` runs (D22).

**Kill:** `SIGTERM` to the process group, then `SIGKILL` after 5 seconds. Used by timeouts, stop-all, cancel and `crew ask`.

**`crew ask` ends the process (D4):** after the question is stored and the task is `blocked`, the runner kills the run (exitReason `asked`) if it hasn't exited by itself within a short grace period. The spawn prompt tells the agent to end its turn right after `crew ask`.

### 4.4 Resume after an answer (D4, D6)

- `POST /api/tasks/:id/answer` (human secret) stores the answer as a `messages` row (`type: answer`) and moves the task `blocked → doing` in one transaction.
- The runner then calls `adapter.buildResume({ sessionId, prompt: answer, … })` with the last run's session ID and starts a new run with `resumedFromRunId` set.
- **Fallback:** if the adapter has no `buildResume`, there's no session ID, or the resumed run exits within a few seconds with no events, start a fresh run whose prompt has the task context, the Q&A so far and a `git diff --stat` summary of the worktree. The failed attempt is recorded with exitReason `resume-failed` and doesn't use up a retry.

### 4.5 Dispatcher (in `src/server/scheduler/`)

- Picks `ready` tasks, oldest first, while live runs < `maxParallelAgents` (default 3).
- Skips tasks whose agent's tool is rate-limit paused, and does nothing while dispatch is stopped (4.6).
- Assigns an idle agent of the task's role when the task has no assignee.
- Moves the task `ready → doing` (which creates the worktree), then starts the run.
- Triggered by `task_status_changed` and run-exit events, plus a slow safety tick (for example every 5 seconds).
- On server start, `doing` tasks with no live run (a crash or stop-all) are re-dispatched without using up a retry.

### 4.6 Stop-all

- `POST /api/control/stop-all` (human secret) and `crew stop-all`: stop dispatch, kill every live run (exitReason `stopped`) and mark the agents `stopped`. Prints what it stopped.
- Dispatch stays stopped until the user runs a new `crew resume` (and later the Board's switch). Restarting the server doesn't silently restart agents after an emergency stop, so the stopped flag is persisted (D23).

### 4.7 Rate limits (D7)

- When `isRateLimit` fires: kill the run (exitReason `rate-limited`), pause **every** agent of that tool (`agents.status = rate-limited`), and schedule a resume at the reported reset time, or with backoff of 1, 2, 4, 8, 16, then 30 minutes.
- On resume, re-dispatch the paused tasks. Prefer resuming the session (as in 4.4), since the agent was mid-task.
- A successful run resets the backoff. Retry counts never change.
- Pause state lives in the DB, so a restart keeps it.
- Time is injected (a clock interface), so tests check the 1 → 30 minute schedule without waiting.

### 4.8 Permissions

`PermissionProfile` becomes the shape roles store and adapters map:

```ts
interface PermissionProfile {
  mode: 'standard' | 'full';   // 'full' = everything allowed, still only inside the worktree
  allowCommands: string[];     // extra Bash patterns, e.g. "npm test"
  denyCommands: string[];      // extra deny patterns on top of Crew's fixed deny list
}
```

- **Always allowed:** reading, editing and writing files in the worktree, and `crew *`.
- **Always denied** (no profile can lift these): `git push`, `git remote` changes, `sudo`, writes outside the worktree. Plus a short list of destructive patterns (`rm -rf /`, `rm -rf ~` and similar).
- Defense in depth: the diff gate's server-side check for changes outside the worktree comes in milestone 3, so it's out of scope here.

### 4.9 Claude Code adapter (`src/adapters/claude-code.ts`)

Checked against the installed Claude Code 2.1.300 `--help`:

```text
claude -p
  --output-format stream-json --verbose
  --session-id <uuid>
  --permission-mode <mode>
  --permission-prompts none
  --allowedTools "Read Edit Write Glob Grep Bash(crew *) …"
  --disallowedTools "Bash(git push *) Bash(sudo *) …"
  (prompt on stdin)
```

- `--session-id` takes a UUID that Crew generates (D6). Resume is `claude -p --resume <id>`, with the answer on stdin.
- `--permission-prompts none`: anything that would prompt is denied automatically, so a headless agent never hangs on a permission prompt.
- **Permission mapping:** `standard` maps to `--permission-mode dontAsk` with the allow and deny lists above. `full` maps to `acceptEdits` plus a broad Bash allow, keeping the deny list. **To verify with a recorded run:** whether deny rules still hold under `bypassPermissions`. Until that's proven, never use `bypassPermissions`.
- `--verbose` is believed to be required with `stream-json` under `-p`. Confirm while recording fixtures.
- `detect()`: `claude --version`, parse the version, report `installed` and `headless`. Set a minimum version once fixtures are recorded.
- `isRateLimit`: the exact event shape is unknown (PRD open question). Record real samples first. If a real rate-limit sample can't be produced on demand, write the detector against the documented error shape and mark the fixture as synthetic until a real one is captured.

### 4.10 Budget and loop limits

These are enforced now, with defaults from the PRD and overridable through server options until config loading exists:

| Limit | Default | Enforced by |
| --- | --- | --- |
| Max parallel agents | 3 | Dispatcher |
| Max retries per task | 3 | Scheduler (exists) |
| Max task depth | 3 (D24) | `Scheduler.createTask` rejects deeper sub-tasks |
| Max runtime per run | 30 min (D24) | Runner |
| No-output timeout | 5 min (D24) | Runner |
| Max tickets per phase | 20 (D24) | Stored now; enforced when `crew ticket create` lands (milestone 5) |

### 4.11 Human CLI commands

- **How the human CLI finds the server (D25):** `crew start` writes `<crewHome>/server.json` (mode 0600) with the URL, the per-start secret and the pid, and deletes it on shutdown. Human commands read it and send `X-Crew-Secret`. `crew start` stops printing the secret.
- Commands landing here (D2, D16): `stop-all`, `resume` (D23), `answer <task> <text>`, `cancel <task>`, `worktree gc`, `logs <task> [--follow]` (reads `logPath`, and with `--follow` the run SSE stream), `status` (agents, live runs, rate-limit pauses, stopped flag), `tasks`, `diff <task>` (`git diff` of the task's worktree against its base).
- Agent command landing here: `ask "<question>"`.
- Each command gets its API endpoint from the PRD contract (`/api/tasks`, `/api/tasks/:id/answer`, `/api/tasks/:id/cancel`, `/api/tasks/:id/diff`, `/api/control/stop-all`), and `docs/commands.md` is regenerated.

## 5. Tracer bullets, in order

Each slice runs end to end and lands with its harness test.

0. **Migrations.** Drizzle migrator over `drizzle/`, plus the `runs.exitReason` column. Test: an old-schema DB opens and gets upgraded.
1. **Worktree on dispatch.** `ready → doing` creates the worktree and branch. The fake agent's edit lands there, not in the repo root. `cancel` removes the worktree. `worktree gc` cleans up orphans.
2. **Runner with the fake adapter.** Spawn in the worktree, stream events to SSE and the log file, record the Run, exit outcome `done`. Replace the harness's hand-rolled spawn with the real runner.
3. **Timeouts and kill.** New fake steps `hang` and `sleep`. Max runtime and no-output timeouts kill the whole process group, use up a retry, and escalate past the max.
4. **Dispatcher.** Five ready tasks with max 3 parallel: never more than 3 live runs, and all 5 reach `verifying`.
5. **Ask and resume.** Fake step `ask`. The run ends, `crew answer` resumes with `resumedFromRunId` and the same session ID. The fallback path runs when the fake refuses to resume.
6. **Stop-all and resume.** Kills everything, nothing dispatches until `crew resume`, and no retries are used.
7. **Rate limits.** The fake `rate_limit` step pauses all fake agents. With a fake clock, check the 1 → 30 minute backoff and honour the reset time. Retries stay unchanged.
8. **Claude Code adapter.** Record fixtures (a short real run, a resume and, if possible, a rate limit) into `test/fixtures/claude-code/`. Contract tests cover `buildSpawn` per permission profile, `buildResume`, `parseOutput`, `isRateLimit` and `detect`.
9. **Human CLI.** `server.json` discovery, then `status`, `tasks`, `logs`, `diff`, `cancel` and `answer` through the real CLI. Regenerate `docs/commands.md`.
10. **Smoke run (manual).** A script seeds a throwaway repo and one task, then dispatches with the real Claude Code adapter. Watch it reach `verifying`. Record the result in the handoff.

## 6. Testing notes

- Everything except bullet 8's contract tests goes through the in-process harness, asserting on CLI output, API responses, DB rows, SSE events and git state (PRD testing decisions).
- New fake adapter steps: `hang`, `sleep <ms>`, `exit <code>`, `ask <question>`, plus a "refuse resume" switch.
- The harness gets an injectable clock and a way to wait for a task to reach a state, for example by subscribing to board events, without sleeping in tests.
- Kill tests check that grandchild processes (a `sleep` the fake agent started) are gone too.

## 7. Decisions from this plan

Proposed here and approved by the user on 2026-10-19. The PRD Decision Log holds the full text.

| ID | Decision |
| --- | --- |
| D21 | Every Run stores an `exitReason` |
| D22 | A timed-out, silent or exited run counts as one retry, then the task escalates. There is no `failed` state |
| D23 | After `stop-all`, dispatch stays stopped, even across restarts, until `crew resume` |
| D24 | Defaults: max depth 3, max runtime 30 min, no-output timeout 5 min, max tickets per phase 20 |
| D25 | `crew start` writes `~/.crew/server.json` (0600) with the URL and secret, and never prints the secret |
| D26 | The Claude Code Stop hook moves to milestone 3 |

## 8. Open questions

- What do Claude Code `stream-json` rate-limit events look like? (PRD open question, answered by bullet 8.)
- Do `--disallowedTools` rules hold under `bypassPermissions`? Until proven, `full` mode doesn't use it.
- When do `crew init` and `crew.config.ts` loading land? Milestone 2 runs with defaults and server options. The private preview after milestone 5 needs both, so they belong in milestone 5 at the latest.
