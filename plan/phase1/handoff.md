# Handoff: Crew Phase 1 — Milestones 1, 2, and 3 done, Milestone 4 next

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Branch: `feat/milestone-3-verification` holds Milestone 3.
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
- **Review fixes after the first look:** a Reviewer waits while its tool is rate-limit paused (no tight re-run loop, D7); the main-checkout snapshot is stored on disk under `<crewHome>/snapshots/` so a restart doesn't skip the D31 check; Reviewer selection skips stopped agents and prefers usable, idle agents on a different tool. The first smoke run (`npm run smoke:m3`) passed but did NOT exercise the Reviewer: the script named the role "Reviewer" and the Verifier matched the exact string "reviewer", so the review was skipped. The Verifier now matches the role name ignoring case, a test covers it, and the script fails if the review step is skipped. The smoke run must be repeated.
- `rm -rf dist && npm test` passes 100%: 103 tests passing across 26 test suites.

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

- User runs `npm run smoke:m3` and inspects results.
- Merge `feat/milestone-3-verification` to `main`.
- Plan and implement Milestone 4: Merge Queue and Rebase (`merge-queue → merged`).
