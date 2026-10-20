# Milestone 4: Merge

The implementation plan for milestone 4 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** approved, not started. The proposals (P1–P9 below) were approved on 2026-10-20 and are logged in the PRD as D38–D46. D28 (the optional budget cap on the Claude Code adapter) is still open and unrelated.

## 1. Goal

Verified, reviewed work lands on the local default branch, one task at a time, tested against the latest main. A task that conflicts with main is handed back to an agent as a "rebase + resolve" sub-task and lands once it is resolved. Dependent tasks start when their blockers have landed. Crew never pushes, and never touches uncommitted work in the user's own checkout (D11).

From the PRD build order: dependencies, merge queue, rebase, conflict tasks. Dependencies themselves (blockers, cycle checks, promotion to `ready` on `merged`) already exist from milestone 1, so this milestone adds the merge side and the tests that prove a merge unblocks dependents.

### Done when

- A harness test lands two independent tasks through the real queue: each is rebased onto the latest main, re-verified, squash-merged, and the default branch ends with one commit per task. Both tasks end `merged`, their worktrees are gone, and a task that depended on them became `ready`.
- The three checkout cases of D11 each have a test: the user's checkout is on another branch (the ref is updated), on the default branch and clean (it is fast-forwarded), and on the default branch with uncommitted changes (the queue pauses with a warning and the user's files are untouched).
- A conflict creates a "rebase + resolve" sub-task for the same role, linked from the MergeQueueItem. When the sub-task lands, the original task is `merged` too. A conflict past the depth limit escalates instead.
- A re-verify failure on the rebased code returns the task to `doing` with feedback and uses a retry.
- The queue survives a restart, stop-all and cancel without losing or double-merging a task.
- A human can restart an `escalated` task (`crew retry`) and see the queue (`crew queue`).
- Verify commands can run in a real project: worktrees get a setup step (for example `npm ci`) before anything runs in them.
- One manual smoke run with real Claude Code on a throwaway repo resolves a real conflict and lands both tasks.
- The architecture docs, the PRD and the handoff match the code.

## 2. Scope

**In:**
- The merge queue: `MergeQueueItem` lifecycle, one item at a time per workspace, ordered by when the task reached `merge-queue`.
- The integration worktree, rebase, re-verification, merge strategies (`squash` default, `rebase`).
- Updating the default branch safely for the three checkout cases (D11).
- Conflict detection and the "rebase + resolve" sub-task.
- Worktree and branch cleanup after a merge.
- Restart, stop-all and cancel behaviour for queued and in-flight items.
- A worktree setup command (needed for verify commands to work on real projects).
- Human commands `crew queue` and `crew retry <task>`.

**Out (later milestones):**
- Pushing, pull requests, remotes (never; Phase 1 non-goal).
- The release summary and the `integrate` phase that reads merged work (milestone 5).
- `crew ticket create`, loading `crew.config.ts`, memory, phases (milestone 5).
- The Board's queue view (milestone 6), Codex (milestone 7).

## 3. What milestones 1 to 3 give us

- `Scheduler` already allows `review → merge-queue` and `merge-queue → merged`. On `merged` it promotes every dependent whose blockers are all merged. `createTask` takes `blockedByIds`, with cycle checks.
- The `merge_queue_items` table exists (`taskId`, `position`, `status`, `conflictTaskId`) with no code behind it.
- `WorktreeManager` creates and removes task worktrees, keeps the branch on cancel, and `gc` already treats `merged` as terminal.
- The Verifier's shell command runner (timeouts, process-group kill, path filters, output caps) can be reused for the re-verify step.
- Runs, retries, escalation, stop-all, rate limits and the feedback-in-prompt loop exist.
- There is no HTTP endpoint for creating tasks yet (milestone 5), so tests and the smoke script create tasks through the Scheduler.

## 4. Design

### 4.1 The merge worker (`src/server/merge/`)

A `MergeQueue` per workspace takes one item at a time. It starts when a task enters `merge-queue` (a `task_status_changed` event), on server start, on `crew resume`, and on a slow safety tick (every 5 seconds, which also notices a clean checkout again).

Item status: `queued → rebasing → verifying → merging → merged`, or `conflict` / `failed`. Position is the order tasks arrived.

Everything runs in an **integration worktree** at `<crewHome>/integration/<workspace-id>`, created on first use with `git worktree add --detach`. It is never a branch checkout, so it can't collide with the user's own checkout of the default branch.

For the head item:

1. **Check the user's checkout (4.2).** If it blocks the merge, pause before doing any work.
2. **Rebase.** In the integration worktree: `git switch --detach <task-branch>`, `git rebase <default>`. A conflict goes to 4.4.
3. **Re-verify.** Run the workspace's verify commands in the integration worktree on the rebased code, matched against the rebased diff (D10). Results are stored as VerificationResults with the step name `merge:<name>`. A failure goes to 4.5.
4. **Merge.** `squash`: `git reset --soft <default-tip>` and one commit. `rebase`: keep the rebased commits as they are. The commit message is the task title plus `Crew-Task: <id>` as a trailer; the author is the agent (`<agent name> <agent@crew.local>`) and the committer is the user's configured git identity, with a fallback to `Crew <crew@localhost>`.
5. **Move the default branch (4.2)**, then mark the item and the task `merged`, store the commit in `merge_queue_items.commit_sha`, and clean up (4.6).

Crew's own git commands here run with hooks disabled (`-c core.hooksPath=` pointing at nothing), so the user's pre-commit and pre-rebase hooks don't fire on Crew's housekeeping. Agents' own commits are unaffected.

### 4.2 Updating the default branch safely (D11)

Cases, decided by looking at the user's checkout (`workspace.repoPath`):

| User's checkout | What Crew does |
| --- | --- |
| On another branch, or a detached HEAD | `git update-ref refs/heads/<default> <new> <old>`. The old value makes it a compare-and-swap. |
| On the default branch, no changes at all (including untracked files) | `git merge --ff-only <new>` inside the user's checkout, so the working tree moves with the ref. |
| On the default branch, with any change | The queue **pauses**. The item stays `queued`, nothing is touched, and `crew status` and `crew queue` show a warning naming the branch. The queue resumes by itself when the checkout is clean again. |

The check runs before an item starts and again right before the ref moves. If the compare-and-swap loses a race (the user committed to the default branch in the meantime), the item goes back to the rebase step, up to 3 times, then `failed`.

### 4.3 Merge strategies (user story 95)

`workspaces.config.mergeStrategy`: `squash` (default) or `rebase`. A plain merge commit isn't supported in Phase 1. Until `crew.config.ts` loading lands (milestone 5), the setting lives in the workspace's stored config, like the verify commands (D29).

### 4.4 Conflicts: the "rebase + resolve" sub-task

On a rebase conflict Crew aborts the rebase, lists the conflicting files, and sets the item to `conflict`. It then creates a sub-task:

- Same role as the original task, `parentTaskId` = the original, `depth` = original depth + 1, linked from `merge_queue_items.conflictTaskId`.
- It **continues the same branch**. Crew removes the original task's worktree (the branch stays) and creates the sub-task's worktree on that branch, so no work is copied and nothing is shared. The sub-task's `branch` is the original branch.
- Its prompt names the conflicting files and says: rebase onto `<default>`, resolve every conflict, run the project's checks, then `crew done`. Git runs with `GIT_EDITOR=true` so `git rebase --continue` never opens an editor.
- For this sub-task the agent may run `git rebase`, `git add`, `git status`, `git diff` and `git log` even in the `standard` profile, on top of the role's profile. `git push` stays denied.
- It goes through the normal pipeline: dispatch, run, diff gate, command gates, review, merge queue. It is the sub-task that gets merged.
- When the sub-task is `merged`, the original task becomes `merged` too, with the reason "merged via <sub-task id>", and its dependents are promoted. Its queue item is closed.
- Limits: if the sub-task's depth would exceed `maxDepth` (3, D24), or the sub-task is `escalated` or cancelled, the original task is `escalated`. Cancelling the original cancels the sub-task. A resolved branch can conflict again if main moved; that makes another sub-task one level deeper, which the depth limit bounds.

### 4.5 Re-verify failure

A failing command on the rebased code sends the task back to `doing` (`merge-queue → doing`) with the failures as feedback, using the milestone 3 loop. It costs a retry, and past the retry limit the task is `escalated` (`merge-queue → escalated`). The next run starts on the same branch, which the agent can rebase itself.

Both transitions are new: the state machine today allows only `merge-queue → merged` (and cancel).

### 4.6 Cleanup after a merge

On `merged`: remove the task's worktree and delete its branch with `git branch -D` (the work is in the default branch; a squash merge leaves the branch looking unmerged, so `-d` can't be used). A cancelled task keeps its branch (milestone 2). `crew worktree gc` already covers worktrees that were missed.

### 4.7 Worktree setup

A fresh `git worktree` has the tracked files but not `node_modules` or build output, so `npm test` fails in every new worktree. `workspaces.config.worktreeSetup` is an optional shell command (for example `npm ci`) run once, in the worktree, after Crew creates a task worktree or the integration worktree. It uses the verify command runner (timeout default 10 minutes). A failing setup escalates the task with the output as the reason, because retrying won't fix a broken environment. It applies to milestone 2 and 3 dispatch too.

### 4.8 Persistence and recovery

Migration `0003` adds `merge_queue_items.commit_sha` and `merge_queue_items.output`. On server start:

- Items in `rebasing`, `verifying` or `merging` go back to `queued` and the integration worktree is reset. If an item already has a `commit_sha` that is reachable from the default branch, the merge happened before the crash: it is completed (task `merged`, cleanup) instead of repeated.
- Stop-all (D23) pauses the queue and kills running re-verify commands, like dispatch. `crew resume` restarts it, using no retries.
- Cancelling a queued task removes its item. Cancelling the task being merged aborts the rebase and kills its commands first, as in milestone 2.

### 4.9 Human CLI

- `crew queue`: queue order, the item being processed, the pause warning if any, and conflict sub-tasks.
- `crew retry <task>`: moves an `escalated` task back to `doing`, resets `retries` to 0, and stores an optional `--note` as feedback. This makes `escalated` non-terminal for humans only; no agent or automatic path can leave it.
- `crew status` shows the queue length and the pause warning.
- Endpoints: `GET /api/merge-queue`, `POST /api/tasks/:id/retry` (human secret). `docs/commands.md` is regenerated.

## 5. Tracer bullets, in order

Each slice runs end to end and lands with its harness test.

0. **Worktree setup.** `worktreeSetup` runs after worktree creation; failure escalates. Test: a setup command creates a file that a verify command then needs.
1. **Happy path.** Migration `0003`, the merge worker, the integration worktree, rebase, re-verify, squash, update-ref, `merged`, cleanup, dependents promoted. Test: two tasks edit different files and land in order; main has two commits; the third task blocked on them becomes `ready`.
2. **The user's checkout.** On another branch, on the default branch and clean (working tree updated), on the default branch and dirty (pause, warning, files untouched, resumes when clean), and the compare-and-swap race.
3. **Strategies.** `rebase` keeps the commits; `squash` makes one.
4. **Re-verify failure.** `merge-queue → doing` with feedback and a retry; escalation past the limit; a green second attempt lands.
5. **Conflicts.** Two tasks edit the same lines. The sub-task is created with the right role, depth and branch; a fake agent resolves it; both end `merged`; the dependent is promoted. Depth-limit and sub-task-escalation paths escalate the parent.
6. **Interruptions.** Restart in every item state (including "merged but not recorded"), stop-all and resume, cancel of queued, in-flight and conflict tasks.
7. **Human CLI.** `crew queue`, `crew retry`, `crew status` additions; regenerate `docs/commands.md`.
8. **Smoke run (manual).** A throwaway repo with two tasks that conflict, the user's checkout on `main` and clean, real Claude Code authors and a real Reviewer. Watch both land, with the conflict resolved by the agent. Record the result in the handoff.

## 6. Testing notes

- Everything goes through the in-process harness (PRD testing decisions): real git repos, real SQLite, asserting on `git log`, `git branch`, `git worktree list`, the user's working tree, DB rows and events.
- The fake adapter learns steps for resolving a conflict (write the merged file, `git add`, `git rebase --continue`), driven by the real `git` in the worktree.
- Checkout cases are built by setting up the temp repo's HEAD and working tree before the merge, and asserting that a dirty file's contents are byte-for-byte unchanged afterwards.
- The race in 4.2 is tested by committing to the default branch from the test between the rebase and the ref update (a hook point in the worker).
- Wait on events (`merge_item_changed`, `task_status_changed`), never sleep.

## 7. Decisions from this plan

Proposed here and approved by the user on 2026-10-20. The PRD Decision Log holds the full text.

| ID | PRD ID | Decision |
| --- | --- | --- |
| P1 | D38 | Merge in a detached integration worktree, one item at a time per workspace: rebase, re-verify, then squash and move the ref. Crew's own git commands run with hooks off. |
| P2 | D39 | The three checkout cases of 4.2, with a pause (not a failure) when the user's checkout is dirty on the default branch, re-checked every 5 seconds. |
| P3 | D40 | Strategies `squash` (default) and `rebase`; no plain merge commits in Phase 1. |
| P4 | D41 | Conflict = a sub-task that continues the same branch in a new worktree, goes through the whole pipeline, and when it lands the original task is `merged` too. Depth and escalation rules as in 4.4. |
| P5 | D42 | A re-verify failure returns the task to `doing` (a retry), and exhausted retries escalate from `merge-queue`. |
| P6 | D43 | After a merge, remove the worktree and delete the branch with `git branch -D`. |
| P7 | D44 | `crew retry <task>` lets a human restart an `escalated` task (retries reset to 0, optional note). |
| P8 | D45 | A `worktreeSetup` command runs once in every new worktree; a failing setup escalates. |
| P9 | D46 | Migration `0003` stores `commit_sha` and `output` on queue items; recovery finishes a merge that already reached the default branch. |

## 8. Open questions

- Is the merge author right? Proposed: the agent as author, the user's git identity as committer. The alternative is a single `Crew` author, which hides which agent wrote what.
- Should `worktreeSetup` be cached or replaced by symlinking the main checkout's `node_modules`? Re-running `npm ci` per task is slow but safe; symlinks are fast but let one task's install change another's. This plan starts with the plain command.
- A conflict resolved by dropping all of the task's changes leaves an empty diff, which the diff gate rejects. Is that the right outcome, or should such a task close as "nothing left to merge"? Recommended for now: let it fail the gate, so a human sees it.
- In the `standard` permission profile an agent has no `git` or test commands at all. Conflict sub-tasks get a few git commands (4.4); should roles in general get project test commands by default? That belongs with roles in milestone 5.
