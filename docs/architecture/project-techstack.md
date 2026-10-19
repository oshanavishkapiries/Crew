# Project Tech Stack

The runtime, libraries and tooling Crew is built with. Based on `docs/Crew Design Doc.md` and updated with `plan/phase1/prd.md` (Decision Log D1–D19). No dependencies are installed yet. Exact versions get pinned in `package.json` when the project is scaffolded.

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
| HTTP server | `hono`, `@hono/node-server` | 4.13.13 / 2.1.5 | REST + SSE API |
| Database | SQLite via `better-sqlite3` | 13.0.3 | One DB at `~/.crew/crew.db` (D12) |
| Migrations / ORM | `drizzle-orm`, `drizzle-kit` | 0.45.4 / 0.31.11 | Schema and migrations |
| Processes | `execa` | 10.2.0 | Spawning agents (structured JSON events, D5) and running verify commands |
| Git | git CLI wrapper | — | Worktrees, rebase, merge. No libgit bindings |
| Build / Dev runner | `tsup`, `tsx` | 9.0.0 / 4.23.15 | Bundling to `dist/cli.js` and running dev scripts |
| UI | Vite + React | — | Board UI, built at package time and served by the crew server |
| Live updates | Server-Sent Events | — | No WebSockets |
| Agent output view | Live log view of structured events | — | Replaces the design doc's xterm.js PTY terminal (D5) |

**Removed from the design doc:** `node-pty`. Spawn mode no longer uses a PTY (D5), which also keeps native build steps out of `npx` installs.

## AI tool adapters

| Tool | Headless command | Session resume | Status |
| --- | --- | --- | --- |
| Claude Code | `claude -p --output-format stream-json --session-id <uuid>` | `--resume <id>` | Launch (milestone 2) |
| Codex | `codex exec --json` | `codex exec resume <id>` | Launch (milestone 7) |
| Antigravity | Unknown | — | Pull mode only (D17) |
| Fake | Scripted `crew` calls | Supported | Tests and demos |

Tool versions checked on 2026-10-18: Claude Code 2.1.300, codex-cli 0.163.0.

## Testing and tooling

| Area | Choice | Version | Notes |
| --- | --- | --- | --- |
| Test runner | Vitest | 5.0.5 | All tests |
| TypeScript | TypeScript | 7.0.2 | Typechecking and compilation |
| Main test seam | In-process pipeline harness | — | Real server, temp git repo, fake adapter |
| Adapter tests | Contract tests | — | Recorded `stream-json` / `--json` fixtures |
| CI | Linux and macOS | — | D14 |
| Telemetry | None | — | D18 |
