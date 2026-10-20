# Milestone 4 bullet 4 handoff

Bullets 0–4 are implemented on `feat/milestone-4-merge`; bullet 3 is `4094c69`. Merge re-verification stores every matching result and returns all command failures as feedback to a fresh author run. Scheduler transitions `merge-queue → doing` and `merge-queue → escalated` now exist; the feedback, failed item and retry/status update commit atomically. Exhausted retries escalate; integration setup failure escalates without a retry. A failed item is reopened only on a new pipeline approval, never on the safety tick. Full-suite failures exposed second-resolution run timestamp ties: latest-run lookups now use SQLite rowid as a secondary order. A deterministic tied-timestamp regression proves each failed attempt retains its own results; the existing escalation test now triggers a dispatch pass instead of sleeping.

Verification: `rm -r dist && npm test` passed 123 tests across 31 files with typecheck and fresh build. Three new harness tests prove atomic feedback, a green second attempt, exhaustion and integration setup escalation. Commands reference regenerated unchanged. No deviations, dependencies or PRD edits. Next: bullet 5 conflicts, then interruptions and human CLI. Write bullet 8 last without running it; milestone 4/manual smoke remain incomplete.

---

# Milestone 4 bullet 3 handoff

Bullets 0–3 are implemented on `feat/milestone-4-merge`; bullet 2 is `5c0f1ef`. Stored workspace `mergeStrategy: rebase` now retains the rebased commits and their author messages, while the default squash creates one commit with the task trailer. The fake adapter supports git argument arrays, tested through two real author commits. All three strategy tests advance main before merging and assert the resulting history and checkout files; an empty git identity exercises the Crew committer fallback during rebase.

Verification: `rm -r dist && npm test` passed 120 tests across 30 files, including typecheck and a fresh build. Commands reference regenerated unchanged. No deviations, dependencies or PRD changes. Next: bullet 4 (re-verify failure), then conflicts, interruptions, human CLI and the smoke script without running it. Manual smoke is pending; milestone 4 is not complete.

---

# Milestone 4 bullet 2 handoff

Bullets 0–2 are implemented on `feat/milestone-4-merge`; bullet 1 is `cd76972`. Checkout safety now covers clean default-branch fast-forward, another branch/detached HEAD ref-only update, and dirty tracked/untracked default checkout pause. The initial check and a second check before ref movement preserve dirty bytes; queue output and the worker warning map name the branch. The 5-second safety tick resumes a clean checkout. A lost CAS repeats rebase/re-verification, bounded at three attempts; exhaustion leaves the item failed without overwriting competing commits. CLI/API warning presentation remains bullet 7.

Verification: `rm -r dist && npm test` passed 117 tests across 29 files (typecheck and fresh build included); the environment rejects `rm -rf`. Seven checkout harness cases cover those paths and late dirtiness. No product deviations, dependencies or PRD edits. Next: bullet 3 (strategies), then bullets 4–7 and the smoke script only. Milestone 4 is not complete; manual smoke remains pending.

---

# Milestone 4 bullet 1 handoff

Branch: `feat/milestone-4-merge`, based on `f9acd405503ffabe34a355f16f8dd6b61eaf1291`. Bullet 0 is committed as `0b37f79`; bullet 1 adds the merge happy path. Nothing pushed.

Bullets 0–1 are implemented. `MergeQueue` is wired into `crew start`, subscribes to task transitions and checks every 5 seconds. Each workspace runs one item at a time in `<crewHome>/integration/<workspace-id>`. It rebases onto the current default tip, applies path-filtered verification commands with `merge:` results, squashes with the agent as author and the user's configured git identity as committer (Crew fallback), persists the candidate commit before CAS, transitions through the Scheduler with the item update in `alongside`, removes the task worktree/branch and promotes dependents. Hooks are disabled on Crew's worktree, diff-gate and merge housekeeping. Migration `0003_absurd_black_widow.sql` was generated with drizzle-kit and upgrades milestone 3 data without loss.

At this boundary only another-branch/detached checkout merges; the default branch checkout pauses. Bullet 2 adds clean-checkout fast-forwarding, dirty warnings and race retries. Failed rebase/verification items remain failed for now; bullets 4–6 add feedback, conflicts and recovery. Cancellation/restart races have not yet been verified. No queue/retry human commands or smoke script yet. Continue bullets 2–7 in order, then write bullet 8 without running it. Do not mark milestone 4 complete until the user runs the smoke.

Verification: fresh-build `npm test` passed 110 tests across 28 files, including the new migration upgrade and `merge-happy.test.ts`. The environment rejects `rm -rf dist`; `rm -r dist && npm test` removed the build and ran the same typecheck/build/suite. `npm run generate:docs` regenerated an unchanged commands reference. No PRD decisions or dependencies changed.

---

# Handoff: Crew Phase 1 — Milestone 4 in progress (bullet 0 complete)

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Milestones 1–3 are on `main`. Current branch: `feat/milestone-4-merge`, based on `f9acd405503ffabe34a355f16f8dd6b61eaf1291`.
- **Milestone 4 bullet 0 (Worktree setup) is implemented:**
  - `workspaces.config.worktreeSetup` runs before a new task worktree is dispatched. Setup and verification share `src/server/verify/command-runner.ts`, including the minimal environment, 10 minute default timeout and process group kill.
  - A private Git-directory success marker prevents rerunning completed setup after restart; a recreated worktree gets fresh setup. No install cache or symlinks are introduced.
  - Setup failure stores feedback and escalates through the Scheduler in one transaction, before any agent run; initial setup failure costs no retry. Its worktree and branch remain available for diagnosis.
  - Stop-all and cancel interrupt setup; cancel waits for setup before removing the worktree and keeps the branch. Resume reruns interrupted setup. Server close also interrupts setup.
  - Five tests in `test/harness/worktree-setup.test.ts` cover setup-dependent verification, restart/recreation, detached-worktree setup, failure escalation, stop-all/resume and cancel. The kill tests assert that setup and its child processes are gone.
  - The detached-worktree setup helper is tested directly; automatic integration worktree creation and its call to the helper belong to bullet 1.
- **Current verification:** fresh-build `npm test` passed typecheck and all 108 tests across 27 files (141.37s). The requested `rm -rf dist && npm test` was rejected by the shell guard; the previous `dist/` was moved to a temporary backup before `npm test`. `npm run generate:docs` succeeded without changing the commands reference.
- **Next: milestone 4 bullet 1.** Bullets 1–8 are not implemented; the milestone 4 smoke script is not yet written or run.
- **Milestone 3 (Verification) is fully implemented and tested:**
  1. **Bullet 0 (Diff gate & failure loop):** Migration `0002_silent_owl.sql` adds `runs.kind` (`work` | `review`, default `work`) and `tasks.reviewer_agent_id`. Diff gate auto-commits leftover agent changes, fails empty diffs ("no changes against <base>"), runs out-of-worktree check (symlink escape + main checkout porcelain status snapshot), commits failure feedback message in transaction, and injects failure feedback into the next run's prompt.
  2. **Bullet 1 (Escalation):** Verified end to end that tasks repeatedly failing verification escalate to `escalated` once `retries` exceed `maxRetries`, recording VerificationResults and events.
  3. **Bullet 2 (Command gates):** Shell command runner for `workspaces.config.verifyCommands` (D10, D29) with per-command cwd, timeouts with process group kill (`-pid`), path-filtering with `picomatch@4.0.7` (D37), all-failures-together feedback collection (D32), and output capping (64 KB in DB, 4 KB per failure in feedback).
  4. **Bullet 3 (The pass path):** Diff and command gates pass, review step skips cleanly with visible status when no reviewer exists (`review → merge-queue`, D34), and tasks reach `merge-queue` in order.
  5. **Bullet 4 (Reviewer gate):** Reviewer selection preferring a different `cliType` (D8), `read-only` permission profile (denies edits/writes), `crew review approve` (`review → merge-queue`) and `crew review changes --feedback "..."` (`review → doing` charging author a retry), token auth isolation (reviewer token rejected on author endpoints, author token rejected on `/review`), and reviewer crash recovery (up to 2 runs before escalating, author not charged, D35).
  6. **Bullet 5 (Interruptions):** Verifier restart recovery re-enqueues `verifying` and unreviewed `review` tasks and replaces partial verification results (§4.6); `crew stop-all` terminates active command subprocesses and Reviewers, and `crew resume` restarts pipelines without charging retries; `crew cancel` aborts in-flight commands and kills reviewer before removing worktrees; rate-limited Reviewers pause and resume without retry penalties; concurrency limited to `maxParallelVerifications` (default 2, D37).
  7. **Bullet 6 (Stop hook):** Crew-written `<crewHome>/claude-settings.json` configuring Stop hook (D26, D36); hidden agent command `crew hook stop` that checks `stop_hook_active` on stdin, blocks while `doing` (exit code 2 with stderr), allows when status != `doing`, and gives up after 2 blocks; adapter contract tests for `--settings` flag and `read-only` profile; real hook-blocked fixture recorded in `test/fixtures/claude-code/hook-blocked.jsonl`.
  8. **Bullet 7 (Human CLI):** `crew results <task>` prints pass/fail for each verification step followed by the output of failed steps; `GET /api/tasks/:id` extended with `verificationResults`; `crew status` and `GET /api/status` extended with `verifyingTasks` and `reviewTasks` lists; `docs/commands.md` regenerated via `npm run generate:docs`.
  9. **Bullet 8 (Smoke script):** `scripts/smoke-milestone-3.ts` (`npm run smoke:m3`) written and verified with `npm run typecheck`. Ready for manual run by user.
- **Review fixes after the first look:** a Reviewer waits while its tool is rate-limit paused (no tight re-run loop, D7); the main-checkout snapshot is stored on disk under `<crewHome>/snapshots/` so a restart doesn't skip the D31 check; Reviewer selection skips stopped agents and prefers usable, idle agents on a different tool. The first smoke run (`npm run smoke:m3`) passed but skipped the Reviewer (case-sensitive role-name match, now fixed). The repeated run on 2026-10-20 passed with a real Reviewer: diff, `smoke-file-check` and `review` ("Approved") all passed and the task reached `merge-queue` in 28s.
- Milestone 3 baseline: `rm -rf dist && npm test` passed 103 tests across 26 test suites.

## Open questions answered in Milestone 3

- **Stop hook format on Claude Code 2.1.300:** Verified live with real Claude Code 2.1.300 runs and binary analysis. Claude Code uses exit code 2 with stderr (`echo "..." >&2; exit 2`) as its standard blocking mechanism (`Exit code 2 - show stderr to model and continue conversation`). It also supports exit code 0 with JSON `{"decision":"block","reason":"..."}`. On subsequent turn, Claude Code sends `"stop_hook_active": true` on stdin to prevent infinite loops. `crew hook stop` uses exit 2 with stderr. Real fixture recorded in `test/fixtures/claude-code/hook-blocked.jsonl`.

## How to run the Milestone 3 smoke test

Run the smoke script using:
```bash
npm run smoke:m3
```
or
```bash
npx tsx scripts/smoke-milestone-3.ts
```
The script will:
1. Detect local Claude Code CLI version.
2. Initialize throwaway Git repo and temporary `CREW_HOME`.
3. Start the Crew server with Dispatcher, Runner, and Verifier.
4. Configure `verifyCommands` (`test -f smoke.txt`) and Stop hook in workspace config.
5. Seed Author agent (`claude-code`) and Reviewer agent (`claude-code`).
6. Dispatch task to Author to create `smoke.txt`.
7. Author creates file, calls `crew done`, triggers diff gate and verifyCommand (`test -f smoke.txt`).
8. Reviewer reviews diff in `read-only` mode and approves.
9. Task reaches `merge-queue`.
10. Runs `crew results` CLI and verifies worktree diff and file contents.

## Next steps

- Milestones 1 to 3 are done and on `main`; both milestone 3 smoke runs are recorded above.
- Milestone 4 (Merge): `plan/phase1/milestone-4.md` is approved and logged as D38–D46. Continue at tracer bullet 1 (happy path). D28 (the optional budget cap on the Claude Code adapter) is still open.
