# Project Tech Stack

The runtime, libraries and tooling Crew is built with. Based on `docs/Crew Design Doc.md` and updated with `plan/phase1/prd.md` (Decision Log D1–D87). Milestones 1, 2, and 3 are implemented; the versions below are pinned exactly in `package.json`.

**Keep this file current.** When a dependency, tool, version requirement or supported platform is added, removed or swapped, update this document in the same change.

## Runtime

| Area | Choice | Notes |
| --- | --- | --- |
| Language | TypeScript | CLI, API server, runner and UI all live in one Node.js process |
| Runtime | Node.js 22 LTS or newer | D14 |
| Platforms | Linux, macOS; Windows via WSL only | D14 |
| Distribution | npm, run with `npx crew` | Package name `crew` still to be confirmed (PRD open questions) |

## Libraries

| Area | Library | Version | Purpose |
| --- | --- | --- | --- |
| CLI | `commander` | 15.0.0 | Command parsing. Its declarations also generate `--help` and `docs/commands.md` (D3) |
| HTTP server | `hono`, `@hono/node-server` | 4.13.13 / 2.1.5 | REST + SSE API, package-relative static Board host and HttpOnly browser sessions (milestone 6 bullet 0) |
| Database | SQLite via `better-sqlite3` | 13.0.3 | One DB at `~/.crew/crew.db` (D12) |
| Migrations / ORM | `drizzle-orm`, `drizzle-kit` | 0.45.4 / 0.31.11 | Schema and migrations |
| TypeScript config loader | `jiti` | 2.7.0 | Loads `crew.config.ts` at real CLI startup (D56), with module/filesystem caches disabled; validates JSON settings before updating SQLite |
| Processes | `execa` | 10.2.0 | Spawning agents (structured JSON events, D5), verify commands and worktree setup (D45; shared command runner, 10 minute default timeout) |
| Path matching | `picomatch` | 4.0.7 | Path filter glob matching for command gates (D37) |
| Git | git CLI wrapper | — | Worktrees, rebase, squash and compare-and-swap ref updates. Crew worktree/verification/merge housekeeping disables hooks; merge Git subprocesses use detached process groups; stop-all/cancel kill and await rebase, while protected checkout publication finishes. Prepared ref transactions + private index protect checkout updates (verified Git 2.53.0; HEAD lock capability checked before writing); no libgit bindings |
| Build / Dev runner | `tsup`, `tsx` | 9.0.0 / 4.23.15 | Bundling to `dist/cli.js` and running dev scripts |
| UI | Next.js (App Router, static export) + TypeScript + Tailwind + shadcn/ui | Next 16.4.2, React 19.3.1, Tailwind 4.3.3, shadcn 4.22.1, TypeScript 6.0.3 | Board UI in `ui/`, built at package time (`output: 'export'`) and served as static files by the crew server; `next dev` proxies `/api` to the server during development (D80, D81) |
| Live updates | Server-Sent Events | — | No WebSockets |
| Agent output view | Live log view of structured events | — | Replaces the design doc's xterm.js PTY terminal (D5) |

**Removed from the design doc:** `node-pty`. Spawn mode no longer uses a PTY (D5), which also keeps native build steps out of `npx` installs.

## AI tool adapters

| Tool | Headless command | Session resume | Status |
| --- | --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --verbose --session-id <uuid>` | `--resume <id>` | Implemented (milestones 2 and 3: runner, resume, permissions, rate-limits, read-only review, stop hook; milestone 4 adds scoped conflict git permissions and noninteractive rebase editor) |
| Codex | `codex exec --json` | `codex exec resume <id>` | Implemented spawn/resume and CLI wiring (milestone 7 bullets 0–1), minimum 0.163.0 |
| Antigravity | Unknown | — | Pull mode only (D17) |
| Fake | Scripted `crew` calls and git argument arrays | Supported | Tests and demos, including multi-commit history and real rebase conflict resolution |

Tool versions checked on 2026-10-18: Claude Code 2.1.300 (minimum supported 2.1.0), codex-cli 0.163.0.

## Testing and tooling

| Area | Choice | Version | Notes |
| --- | --- | --- | --- |
| Test runner | Vitest | 5.0.5 | All tests. `npm test` typechecks first, and a global setup builds `dist/` so the harness always runs the current `crew` binary. Test files run serially with a 30 s timeout (D27) |
| TypeScript | TypeScript | 7.0.2 | `npm run typecheck` (`tsc -p test/tsconfig.json`) covers `src/`, `test/`, `scripts/` and the root configs. `tsup` doesn't check types, so this is the only type gate |
| Main test seam | In-process pipeline harness | — | Real server, temp git repo, fake adapter |
| Adapter tests | Contract tests | — | Recorded `stream-json` / `--json` fixtures |
| CI | Linux and macOS | — | D14 |
| Telemetry | None | — | D18 |

The manual milestone 4 smoke (`npm run smoke:m4`) uses real Claude Code authors and a lowercase `reviewer` role in a throwaway `/tmp` repo and separate Crew home. It reuses the existing $0.50 per-run adapter option, expects six small runs, aborts unexpected extra runs, and has an eight-minute deadline plus shutdown grace. It is typechecked with the suite but is never executed by `npm test`; the manual milestone 4 run passed on 2026-10-20 (recorded in the handoff); it was not rerun during milestone 5 bullet 0.

Milestone 5 bullet 0 adds the built-in team and role defaults, per-workspace runtime limits and prompt/profile overrides. Explicit adapter wildcard patterns are preserved unchanged; plain prefixes expand to exact-command and argument-bearing rules. Editing-role config command prefixes expand to exact and argument-bearing Claude Bash allow rules; fixed push denials remain. Configured Git prefixes require a supported literal subcommand (no bare Git or global options). Removed custom-role configuration resets its stored privileges while retaining referenced identities. The initial Orchestrator profile is read-only with Crew commands. Bullet 4 subsequently verified its scoped output-file Edit permission on Claude Code 2.1.300; see the recorded probe below. Permission syntax was checked against [Configure permissions](https://code.claude.com/docs/en/permissions) and [Permission modes](https://code.claude.com/docs/en/permission-modes).

Milestone 5 phase runs use the same Claude Code `dontAsk` mode with an exact absolute `Edit` rule for their output file and external settings sources disabled for scoped phase spawn/resume. A recorded 2.1.300 probe proves allowed Edit, denied Edit elsewhere, and a real phase-done CLI POST (`test/fixtures/claude-code/phase-output-dontask.json`); the recording receiver verifies transport rather than engine semantics. Phase engine behavior is tested separately with the fake adapter, whose script now supports `phase_done`. No new dependency is needed.

Every Claude Code profile (including full, Reviewer and Orchestrator), for spawn and resume, denies `Read` of the Crew state files in the resolved Crew home (`server.json`, `crew.db` with its `-wal`/`-shm` files, `claude-settings.json`) and of its `logs/` directory. The `worktrees/` subtree is deliberately not denied, because agents run and read inside it. `CREW_HOME` is resolved each time commands are built. This is defence in depth, not an OS sandbox: Bash and other access paths need their own controls. A real Claude Code 2.1.305 `dontAsk` probe (fake home containing spaces) recorded a denied `server.json` read, an allowed read of a file under `worktrees/`, and an allowed normal-file read for $0.1693513, under a $0.50 cap and two-minute deadline: `test/fixtures/claude-code/crew-home-read-dontask.json`. Syntax follows [Configure permissions](https://code.claude.com/docs/en/permissions).

The manual milestone 5 smoke (`npm run smoke:m5`) uses real CLI init/start and the initialized Claude team in isolated `/tmp` folders. Its executable launcher forwards the existing $0.50 budget flag and reserves up to 30 run slots atomically; the script has a 20-minute deadline. Expected cost is $1–$6, with $15 in total per-run caps. It is typechecked only and has not been run. No dependency, migration or adapter implementation change was needed in the final session. The built-server SIGKILL test uses a local Claude executable stub, not real Claude: detached agents survive server death and startup can duplicate a run; see milestone-5.md §9 before preview use.

Milestone 6 bullet 0 uses Node crypto for random browser login/session credentials (hashes retained in server memory only), Hono cookie and MIME helpers, and Node realpath checks for `dist/ui`. Human header-secret authentication remains available; cookie mutations require `X-Crew-Board: 1`. `crew open` uses execa argument arrays to run macOS `open`, Linux/WSL `xdg-open`, or the executable named by `BROWSER`; if unavailable it prints paste-the-URL guidance. No new dependency or runtime version is required. The server build and test suite do not require a UI export; Track B owns `build:ui` and `prepack`.

The Board package `ui/` pins every direct dependency exactly (Next 16.4.2, React and React DOM 19.3.1, Tailwind and `@tailwindcss/postcss` 4.3.3, shadcn 4.22.1, radix-ui 1.8.1, lucide-react 1.61.0, sonner 2.0.8, next-themes 0.4.6, class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0, tw-animate-css 1.4.0, ESLint 9.39.5 with eslint-config-next 16.4.2, TypeScript 6.0.3) and commits `ui/package-lock.json`. The full reasons are in `plan/phase1/milestone-6.md` §9 (Track B). `npm run build:ui` builds it into `dist/ui`; `npm test` does not.

Codex 0.163.0 uses `exec --json -s <sandbox> -C <worktree>` with stdin prompts;
resume options precede `resume --json <thread-id> -`. D88 maps read-only to
`workspace-write` (the OS `read-only` sandbox only when `allowNetwork: false`, because it blocks the local Crew API and `crew review` would fail; the Reviewer's no-edit rule is then a prompt rule), standard/orchestrator to `workspace-write`, and only explicit full
to `danger-full-access`. Workspace network is **enabled by default** (`allowNetwork: false` disables it): a network-disabled Codex sandbox cannot reach the localhost Crew API, so `crew done`/`ask` would fail (verified with real Codex 0.163.0). This also lets the agent reach external hosts.
Read-only has no network and full has unrestricted network: Codex cannot enforce
a network restriction in full mode. User config and execpolicy rules are ignored
so they cannot broaden these selected policies. `allowCommands`/`denyCommands`
are advisory prompt rules on Codex, not executable command filters; full also has
no OS filesystem containment. There is no Claude Stop hook.

Real fixture recording on 2026-10-21 used Codex 0.163.0. The CLI reports token
usage but no USD cost; no billing estimate is claimed. The read-only response
reports denial and left no file, but contains no command event, so it does not
prove an attempted syscall was denied. Rate-limit fixtures remain synthetic.

Codex is registered by default in Runner. `config.team` adds named spawn agents
with a built-in or configured role and `cliType: codex|claude-code`, on init/start;
matching names are idempotent, mismatched role/tool is an error, and omission
never deletes an existing agent. `init` preserves stored workspace settings;
`start` remains the point that replaces them from the config file. Role profiles
now accept boolean `allowNetwork`. Network-disabled Codex sandboxes can also block
the localhost Crew API: the fake harness does not prove real sandbox HTTP
connectivity. Workspace-write now has network by default;
a read-only Reviewer is therefore run with workspace-write plus a no-edit prompt rule (a network-disabled read-only one could not use HTTP `crew review` without a
future scoped local transport/network solution. Broad network access is enabled by default and documented (D88).
