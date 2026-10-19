# Handoff: Crew Phase 1 — Milestone 2 (Runner and Core Safety) Complete

## Where things stand

- Repo: `/home/oshan/Projects/Crew`
- Branch: `feat/milestone-2-runner` (base commit: `5d35720` on `main`).
- **Milestone 2 (Runner and core safety) is fully implemented and tested:**
  1. **Bullet 0 (Migrations):** Versioned Drizzle migrator baselines legacy unversioned databases, adds `runs.exitReason` (D21) and `runs.prompt`.
  2. **Bullet 1 (Worktree on dispatch):** `WorktreeManager` creates isolated git worktrees at `~/.crew/worktrees/<workspace>/<task-id>` with branch `crew/<task-id>-<slug>` on `ready → doing`, removes worktree and deletes branch on `cancel`, and `worktree gc` cleans up orphan worktrees.
  3. **Bullet 2 (Runner with fake adapter):** Spawns agent processes via `execa` with `detached: true` in task worktrees, injects `crew` binary shim in PATH, records `runs` entries, and streams structured events both to disk (`~/.crew/logs/...`) and SSE.
  4. **Bullet 3 (Timeouts and kill):** Handles max runtime (default 30m) and no-output (default 5m) timeouts, kills whole process group with negative PID (`-pid`), escalates task past `maxRetries` (D22).
  5. **Bullet 4 (Dispatcher):** Parallel agent dispatcher (max 3 concurrent runs), assigns ready tasks to matching idle agents by role, and recovers orphaned `doing` tasks on startup without retry penalties.
  6. **Bullet 5 (Ask and resume):** Fake and real agent `ask` steps block tasks; `crew answer` resumes the session preserving the same session UUID; graceful fallback with git diff summary if resume is refused.
  7. **Bullet 6 (Stop-all and resume):** `crew stop-all` kills all live runs (`exitReason: 'stopped'`), marks agents `stopped`, creates `<crewHome>/stopped` marker, and prevents task dispatch without burning retries; `crew resume` clears marker, restores agents to `idle`, and re-dispatches.
  8. **Bullet 7 (Rate limits):** When an agent hits rate limits (`isRateLimit`), run is terminated (`exitReason: 'rate-limited'`) without retry penalty, all agents of that tool marked `rate-limited`, exponential backoff (1 → 2 → 4 → 8 → 16 → 30 min) or reported reset time scheduled with injectable clock, pause state persisted in DB and `<crewHome>/rate-limits.json`, session resumed upon clearance.
  9. **Bullet 8 (Claude Code adapter):** `ClaudeCodeAdapter` implementing `AgentAdapter` (`buildSpawn`, `buildResume`, `parseOutput`, `isRateLimit`, `detect`), permission profiles (`default`, `full`), safety denied tools, and recorded real and synthetic fixtures in `test/fixtures/claude-code/`.
  10. **Bullet 9 (Human CLI):** Discovery via `~/.crew/server.json` (0600 mode, D25), `crew status`, `crew tasks`, `crew diff`, `crew logs` (with `-f, --follow`), `crew cancel`, `crew worktree gc`, and `crew answer`.
  11. **Bullet 10 (Smoke script):** Standalone integration smoke script `scripts/smoke-milestone-2.ts` (`npm run smoke`) ready for manual verification by the user.
- `rm -rf dist && npm test` passes 100%: 64 tests passing across 16 test suites.

## Open items & Decisions Proposed

- **D27 (proposed):** Vitest executes test suites serially (`fileParallelism: false`, `testTimeout: 30000`) to prevent CPU and process contention when multiple in-process server/agent/git test harnesses run simultaneously.
- **D28 (proposed):** `ClaudeCodeAdapter` accepts optional `maxBudgetUsd?: number` to enforce safety caps (`--max-budget-usd <amount>`) during agent execution.
- **D29 (proposed):** `WorktreeManager.cleanup()` uses `git branch -D` to reliably delete unmerged task branches on cancellation or completion.

## Open questions answered

- **Claude Code rate-limit event shape:** Real Claude Code emits `{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","resetsAt":...,"rateLimitType":"five_hour",...}}`. Under rate limiting, `status !== 'allowed'` or error code 429. Synthetic fixture generated and verified.
- **`--verbose` requirement:** When using `-p` (`--print`), `--output-format=stream-json` strictly requires `--verbose`.
- **`--disallowedTools` under `bypassPermissions`:** Explicitly verified live; Claude Code blocked the disallowed tool and returned `permission_denied`.
- **Minimum Claude Code version:** Set to `2.1.0`.

## Next steps

- Run smoke test: `npm run smoke` (seeds throwaway repo, starts server, runs real Claude Code agent with `--max-budget-usd 0.50`, verifies task reaches `verifying`).
- Proceed to **Milestone 3: Verifier and merge queue** (D8, D10, D11, D26).
