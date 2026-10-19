# Milestone 3: Verification

The implementation plan for milestone 3 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** implemented, pending the user's review and the manual smoke run (`npm run smoke:m3`, bullet 8). Tracer bullets 0–7 are done with harness tests. After the first review: a Reviewer now waits while its tool is rate-limit paused (D7), the main-checkout snapshot lives on disk, and Reviewer selection skips stopped and paused agents. P1–P9 (D29–D37) are implemented.

## 1. Goal

When an agent calls `crew done`, Crew checks the work itself. Work that passes goes on to `merge-queue`. Work that fails goes back to the agent with a summary of what failed, and work that keeps failing is escalated to the human. No task reaches the merge queue on the agent's word alone.

From the PRD build order: gates pipeline, retries, escalation, and the Claude Code Stop hook (D26). The gates are the diff check, the verify commands (D10) and the Reviewer agent (D8).

### Done when

- A harness test drives a task from `ready` to `merge-queue` through dispatch → run → `crew done` → diff gate → command gates → review → approval, with one VerificationResult stored per step.
- Each gate has a failing-path harness test: an empty diff, an out-of-worktree change, a failing command, a command that times out, and "changes requested". Each one sends the task back to `doing` with feedback and uses one retry.
- The next run after a failure gets the feedback in its prompt (user stories 49 and 91). After `maxRetries` the task is `escalated`.
- Verify commands honour their working directory, timeout and path filters (D10).
- The Reviewer is a fresh read-only process that prefers a different tool than the author (D8), and its verdict counts toward the same retry limit.
- Stop-all, cancel and a server restart during verification are handled and tested.
- The Claude Code adapter has contract tests for the read-only Reviewer profile and the Stop hook settings. One manual smoke run with real Claude Code shows a task passing a verify command.
- Every human command whose feature lands here works through the real CLI (D2) and is in `docs/commands.md` (D3).
- The architecture docs, the PRD and the handoff match the code.

## 2. Scope

**In:**
- The verification pipeline: diff gate, command gates, review gate, and a VerificationResult per step.
- Retry feedback: failure summaries stored on the task and included in the next run's prompt.
- Reviewer selection, a read-only permission profile, and the `crew review` agent command.
- Escalation past the retry limit (already in the scheduler; tested here end to end).
- Recovery: re-verify after a restart, and behaviour on stop-all and cancel.
- The Claude Code Stop hook (D26).
- Human command `crew results <task>`, and verification results in `GET /api/tasks/:id`.

**Out (later milestones):**
- Merge queue, rebase, re-verification on the rebased diff, worktree cleanup on `merged` (milestone 4).
- Loading `crew.config.ts` and `crew init` (milestone 5 at the latest). Here verify commands come from the workspace's stored config (D29).
- Built-in role definitions beyond the one Reviewer prompt, memory injection in the prompt (milestone 5).
- Pull mode verification (milestone 7), the Board's verification view (milestone 6).
- A way to restart an `escalated` task (see §8).

## 3. What milestones 1 and 2 give us

- `Scheduler` already allows `doing → verifying`, `verifying → review | doing`, `review → merge-queue | doing`, and counts a retry on `verifying → doing` and `review → doing`, escalating past `maxRetries`. `TransitionContext.alongside` writes feedback in the same transaction.
- `POST /api/tasks/:id/done` moves the task to `verifying`. Until now nothing acts on it.
- The `verification_results` table exists (`runId`, `step`, `passed`, `output`).
- The Runner, Dispatcher, worktrees, stop-all, rate limits and the Claude Code adapter exist. The Dispatcher re-dispatches a `doing` task that has no live run, which is how a returned task gets picked up again.
- `runs.prompt` records what each run was given, so tests can check that feedback reached the next run.
- `claude --settings <file>` exists in Claude Code 2.1.300, which the Stop hook can use without touching the user's repo.

## 4. Design

### 4.1 Pipeline shape (`src/server/verify/`)

A `Verifier` subscribes to `task_status_changed` events with `to: verifying` and runs the gates in order. The Scheduler stays the only writer of task status.

```text
verifying ──diff gate──▶ fail ─────────────────────────────▶ doing (retry)
    │ pass
    ├──command gates (all applicable) ──▶ any fail ─────────▶ doing (retry)
    │ pass
    ▼
 review ──Reviewer run──▶ changes requested ────────────────▶ doing (retry)
    │ approved (or review skipped, D34)
    ▼
merge-queue
```

- Each step writes one `verification_results` row, attached to the run that called `crew done`. The review row is attached to the review run.
- Events: `verification_step` (`taskId`, `step`, `passed`) after each step, so the harness and later the Board can follow along.
- Up to `maxParallelVerifications` pipelines run at once (default 2, D37). The rest wait in order.
- A failure transition is `verifying → doing` through `transitionTask`, with `alongside` inserting the feedback message. The existing retry rule then counts it and escalates past the limit.

### 4.2 Diff gate

All checks run in the task's worktree, against the merge-base with the workspace's default branch.

1. **Commit what the agent left behind (D30).** If the worktree is dirty, Crew runs `git add -A` and commits it, with the task title as the message. An agent that edited files but never committed isn't punished for it, and the merge queue gets a branch with commits.
2. **Empty diff fails.** "Done" with no changes is a failure, with the message "no changes against <base>".
3. **Out-of-worktree check (D31).** Permissions are enforced by the tool, and this is the server-side backstop (PRD, Permissions):
   - a changed path that is a symlink pointing outside the worktree fails;
   - at run start the Runner records a snapshot of `git status --porcelain` for the main checkout in `<crewHome>/snapshots/<run-id>.txt`, and the gate compares it at `crew done`. It is on disk so a server restart doesn't skip the check, and it is deleted once the diff gate has decided, or when the run ends without `crew done`. New or changed entries fail the gate and name the paths.

   The snapshot can false-positive if the user edits the main checkout while an agent runs. The failure message says so, and the open question in §8 asks whether that's acceptable.
4. A failed diff gate ends the pipeline: running commands on a broken diff only adds noise.

### 4.3 Command gates (D10)

- **Source (D29):** `workspaces.config.verifyCommands`, an array of `{ name, command, cwd?, timeoutMs?, paths? }`. Loading `crew.config.ts` into that field is milestone 5; the harness and the smoke script set it directly.
- **Which run:** an entry with `paths` globs runs only if a changed file (from `git diff --name-only <base>...HEAD`) matches. An entry without `paths` always runs. Matching uses `picomatch` (D37).
- **How:** `execa(command, { shell: true, cwd: worktree/<cwd>, timeout, reject: false })`. A shell is right here: these commands are written by the user in their own config (`npm test && npm run lint`), unlike the agent input that D13 and the fake adapter keep shell-free. The child gets a minimal environment (PATH, HOME, locale, `CI=1`), and runs in its own process group so a timeout kills everything it started.
- **Default timeout:** 10 minutes per command.
- **All applicable commands run, then all failures are reported together (D32).** Retries are scarce, and an agent that sees both the lint error and the failing test fixes both in one go.
- **Output:** the full output (capped at 64 KB, keeping the end) goes in `verification_results.output`. The feedback message carries the last 4 KB of each failing command, so prompts stay small.
- A timeout or a missing binary is a failed step like any other, with "timed out after Ns" or the shell's error in the output.

### 4.4 Review gate (D8)

**When it runs:** after the diff and command gates pass, the task moves `verifying → review` and the Reviewer starts.

**Who reviews:** an agent whose role is `reviewer` in the same workspace. Stopped agents are never chosen. Otherwise the best of: usable now over rate-limit paused, idle over busy, then a `cliType` different from the author's (D8). If the chosen agent's tool is paused, the review waits until the pause clears instead of starting a run. If only the author's tool is available, the same tool reviews. If the workspace has no reviewer agent, the gate is **skipped (D34)**: the step is recorded as passed with the output "skipped: no reviewer agent", and the task goes `review → merge-queue`. That keeps the pipeline working for teams without a reviewer, and the skip is visible.

**What it gets:** a fresh process in the task's worktree, with a prompt of the Reviewer role text, the task title and acceptance criteria, the diff against the base, and the earlier verification results. The permission profile is new:

```ts
interface PermissionProfile {
  mode: 'standard' | 'full' | 'read-only';   // 'read-only' added for the Reviewer
  // …existing fields
}
```

`read-only` allows reading, searching and `git diff|log|show`, plus `crew review *`. It denies edits, writes and everything else. For Claude Code it maps to `--permission-mode dontAsk` with only those tools allowed and `Edit`/`Write` denied.

**How it answers (D34):** a new agent command with two forms, each ending the review:

```text
crew review approve
crew review changes --feedback "<what to change>"
```

They call `POST /api/tasks/:id/review`. D13 says an agent may act only on its own task, so this endpoint accepts the task's current **reviewer**: a new nullable `tasks.reviewer_agent_id`, set when the review starts and cleared when it ends. The author's token is rejected here, and the reviewer's token is rejected everywhere else.

- `approve`: `review → merge-queue`.
- `changes`: `review → doing`, feedback stored as a message, retry counted. This is the same limit as verification failures (D8).

**A Reviewer that ends without a verdict (D35):** crash, timeout or silence. The review run is recorded with its exit reason, and the Reviewer is re-run, up to 2 times in total. After that the task is `escalated`. The author isn't charged a retry for the Reviewer's failure.

**Schema changes** (migration `0002`): `runs.kind` (`work` | `review`, default `work`) and `tasks.reviewer_agent_id`. The Runner uses `kind` to skip work-run behaviour for reviews: no retry on exit, a different default prompt, and an exit reason of `done` when a verdict was recorded.

### 4.5 Feedback to the next run (user stories 49, 78, 79, 91)

When a task returns to `doing`, the failure summary is stored as a message (`type: feedback`) in the same transaction as the transition. The Runner's default prompt builder then adds, after the task text:

- the latest feedback, in full;
- a short list of earlier failures ("attempt 1: lint failed; attempt 2: Reviewer asked for…") so the agent doesn't repeat itself;
- the instruction to fix the problems, commit, and call `crew done` again.

The returned run is a **fresh process, not a session resume (D33)**. A resumed session carries the whole earlier conversation and its mistakes, the worktree already holds the work, and a fresh run avoids depending on resume for the common path. The `crew ask` resume from milestone 2 is unchanged.

### 4.6 Recovery and interruptions

- **Restart:** on server start, tasks in `verifying` with no pipeline in flight start one again. Tasks in `review` with no live Reviewer run get a new one. Results of a pipeline that never finished are replaced, not duplicated.
- **Stop-all (D23):** also stops pipelines and kills running verify commands and Reviewers. The tasks stay in `verifying` or `review`, and `crew resume` restarts them without using a retry.
- **Cancel:** kills the pipeline and the Reviewer first, then removes the worktree, like the work-run kill from milestone 2.
- **Rate limits (D7):** a rate-limited Reviewer pauses its tool like any run and is re-run after the pause. It uses no retry and no part of the 2-run allowance in P7.

### 4.7 Claude Code Stop hook (D26)

The hook keeps a Claude Code agent from ending its turn without calling `crew done` or `crew ask`.

- **No repo files:** `installExtras` would write into the worktree, where the file would show up in the task's diff. Instead the adapter passes `--settings <crewHome>/claude-settings.json`, written by Crew, with a `Stop` hook that runs `crew hook stop`.
- **`crew hook stop`** is a hidden agent command. It reads `CREW_TASK_ID` and the token from the environment, asks the server for the task's status, and:
  - allows stopping when the status is anything but `doing` (the agent called `crew done` or `crew ask`);
  - blocks while the status is `doing`, with the message "Call `crew done` when the work is finished, or `crew ask` if you're blocked."
- **No loops (D36):** it blocks at most 2 times per run, and always allows when Claude Code reports `stop_hook_active`. A stuck agent then ends and is handled by the exit rules from milestone 2 (an `exited` run costs one retry).
- **Off by default (D36).** The PRD calls the hook optional. It turns on per role or workspace with `stopHook: true`.
- The exact hook output format (`exit 2` with stderr, or JSON `decision: block`) is verified against Claude Code 2.1.300 while recording the fixture. See §8.

### 4.8 Human CLI

- `crew results <task>` prints each verification step with pass or fail, then the output of the failed ones. Endpoint: the existing `GET /api/tasks/:id`, extended with `verificationResults`.
- `crew status` shows tasks that are currently being verified or reviewed.
- Agent commands that land here: `crew review approve|changes` (Reviewer only), and the hidden `crew hook stop`.
- `docs/commands.md` is regenerated.

## 5. Tracer bullets, in order

Each slice runs end to end and lands with its harness test.

0. **Diff gate and the failure loop.** Migration `0002`, the `Verifier` skeleton on `verifying`, the diff gate (auto-commit, empty diff, out-of-worktree), the feedback message, and the prompt builder. Test: a fake agent that changes nothing fails the gate, the task returns to `doing` with `retries = 1`, and the next run's `runs.prompt` contains the feedback.
1. **Escalation.** A fake agent that always fails the diff gate reaches `escalated` after `maxRetries`, with the right VerificationResults and events.
2. **Command gates.** `verifyCommands` from workspace config, the shell runner, timeout and process-group kill, path filters, working directories, all-failures-together feedback, output capping. Tests use real commands in the temp repo (`node -e`, `test -f`).
3. **The pass path.** Gates pass, the review step is skipped with no reviewer, and the task reaches `merge-queue`. One VerificationResult per step, `verification_step` events in order.
4. **Reviewer gate.** Reviewer selection (different tool preferred), the `read-only` profile, `crew review`, the reviewer token rule, approval, changes requested counting toward retries, and a Reviewer that crashes (re-run, then escalate). The fake adapter learns the `review` steps.
5. **Interruptions.** Re-verify after a restart, stop-all and resume, cancel, the parallel verification limit, and rate-limited Reviewers.
6. **Stop hook.** The settings file, `crew hook stop` against a real harness server (blocks while `doing`, allows after `crew done`, gives up after 2 blocks), and adapter contract tests for the `--settings` flag and the read-only mapping. Record a fixture of a real hook-blocked run.
7. **Human CLI.** `crew results`, `crew status` additions, regenerate `docs/commands.md`.
8. **Smoke run (manual).** Extend `scripts/smoke-milestone-2.ts` into a milestone 3 version: a verify command (`test -f smoke.txt`), a real Claude Code author, and, if the user has a second tool, a real Reviewer. Record the result in the handoff.

## 6. Testing notes

- Everything except bullet 6's adapter contract tests goes through the in-process harness (PRD testing decisions), asserting on CLI output, API responses, DB rows (`verification_results`, `messages`, `runs`), SSE events and git state.
- The fake adapter learns per-run scripts, for example "first run changes nothing, second run commits a file and calls `crew done`", so one test can walk the whole retry loop.
- Verify commands in tests are real shell commands against the temp repo. A timeout test uses a command that sleeps, and checks that its child process is gone.
- Wait for `verification_step` and status events instead of sleeping, as in milestone 2.
- Reviewer tests run two fake agents with different `cliType` values to check the "different tool" preference.

## 7. Decisions from this plan

Proposed here and approved by the user on 2026-10-19. The PRD Decision Log holds the full text.

| ID | PRD ID | Decision |
| --- | --- | --- |
| P1 | D29 | Verify commands come from `workspaces.config.verifyCommands` until `crew.config.ts` loading lands in milestone 5. |
| P2 | D30 | The diff gate commits leftover changes for the agent, and an empty diff fails. |
| P3 | D31 | Out-of-worktree check = symlink escape plus a status snapshot of the main checkout at run start vs. at `crew done`. |
| P4 | D32 | Run every applicable command gate and report all failures together; a diff-gate failure ends the pipeline at once. |
| P5 | D33 | A returned task starts a fresh process with the feedback in its prompt, not a session resume. |
| P6 | D34 | The review gate is skipped (and recorded as skipped) when the workspace has no reviewer agent. The Reviewer answers with `crew review approve\|changes`, authorised by a new `tasks.reviewer_agent_id`. Adds `runs.kind` too. |
| P7 | D35 | A Reviewer that ends without a verdict is re-run, up to 2 runs in total, then the task is escalated. The author pays no retry. |
| P8 | D36 | The Stop hook uses a Crew-written `--settings` file (no repo files), blocks only while the task is `doing`, blocks at most 2 times per run, and is off by default. |
| P9 | D37 | Up to 2 verification pipelines run in parallel, and `picomatch` (pinned) does the path-glob matching. |

## 8. Open questions

- What does a Claude Code Stop hook have to print to block a stop on 2.1.300: `exit 2` with stderr, or JSON `{"decision":"block"}`? Answered by recording a real run in bullet 6: exit code 2 with the message on stderr (`echo "..." >&2; exit 2`) is the standard, documented mechanism in Claude Code 2.1.300 (`Exit code 2 - show stderr to model and continue conversation`). Claude Code also supports JSON `{"decision":"block","reason":"..."}` on exit 0. `crew hook stop` uses exit 2 with stderr. Fixture recorded in `test/fixtures/claude-code/hook-blocked.jsonl`.
- Is a false positive from the main-checkout snapshot acceptable (D31), or should the check only look at paths the worktree's diff could plausibly have escaped to? The simple version is recommended for now, because it catches real escapes.
- An `escalated` task is terminal in the state machine, so a human can't hand it back to an agent. Does that need a `crew retry <task>` command, and in which milestone? Suggested: milestone 4, together with the merge conflict flow, since both need a way to reopen work.
- If a team has one AI tool and no second one for review, is "same tool reviews" or "skip the review" the better default? This plan reviews with the same tool when a reviewer agent exists, and skips only when none does.
