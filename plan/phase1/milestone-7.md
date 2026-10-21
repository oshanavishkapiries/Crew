# Milestone 7: Breadth (Codex, Pull mode, heartbeat)

The implementation plan for milestone 7 of Phase 1. The PRD (`prd.md`) says *what* and *why*; this doc says *how* and *in what order*. Where they disagree, the PRD wins until its Decision Log is updated.

**Status:** plan approved by the user (D88–D93 logged in the PRD). Nothing implemented yet. Bullet prompts: `agent-prompts/m7-bullet-0-1.md`.

## 1. Goal

A team can mix Claude Code and Codex agents, and any agent (including Antigravity, D17) can run in the developer's own terminal in Pull mode. Pull-mode work passes the same verification gates, and a dead Pull session never strands a task.

### Done when

- `cliType: codex` agents are dispatched, resumed (`ask`/`answer`), rate-limit-paused and stopped exactly like Claude Code agents (stories 21, 130, 131).
- `crew join`, `crew next --wait` and `crew done` work for a Pull agent, with verification, review and merge unchanged (stories 66–70).
- A Pull agent with no `crew` call for the stale window is shown stale and its task is re-queued (story 69).
- Team and Board show mode (spawn/pull) and connected / running / stale / rate-limited (story 111).
- Adapter contract tests for Codex pass against **recorded real fixtures** (PRD testing section); the pipeline harness covers Pull mode and stale handling with the fake adapter.
- Docs, `docs/commands.md` and decisions are updated in the same commits (AGENTS.md).

## 2. Scope

In: Codex adapter; Pull mode API + CLI; heartbeat/stale; Antigravity as a Pull agent type; Team/Board status; smoke script.
Out: an Antigravity headless adapter (D17), other tools, Phase 2 budgets, the milestone 8 end-to-end run (separate, manual).

## 3. What exists

- `AgentAdapter` interface (`src/adapters/types.ts`): `detect`, `buildSpawn`, `parseOutput`, `isRateLimit`, `buildResume`. Claude Code and fake implement it; the Runner, rate-limit backoff, session resume and the `done` fallback already go through it.
- `agents.mode` (`spawn|pull`) and `lastHeartbeatAt` exist in the schema, unused. `join`/`next` are declared in `src/cli/declarations.ts` but have no handlers or endpoints. Declared endpoints in the PRD: `POST /api/agents/join`, `GET /api/agents/:id/next-task?wait=90`, `POST /api/agents/:id/heartbeat`.
- Codex CLI 0.163.0 is installed here (`codex exec --json`, `-s read-only|workspace-write|danger-full-access`, `codex exec resume`).

## 4. Design

### 4.1 Codex adapter

- `buildSpawn`: `codex exec --json -s <sandbox> -C <workDir>` with the prompt on stdin. Mapping: `read-only` → `read-only`; `standard`/`orchestrator` → `workspace-write`; `full` → `danger-full-access` (only when the human configured `full`). `allowNetwork` maps to Codex's network option for workspace-write.
- **Limitation (stated, not hidden):** Codex has no per-command allow/deny lists like Claude Code. `allowCommands`/`denyCommands` are enforced by the sandbox mode and by the prompt rules, not command by command. The PRD permission section and Team UI say so.
- `parseOutput` turns `--json` lines into `AgentEvent`s and captures the session id; `buildResume` uses `codex exec resume <id>`. `isRateLimit` recognises recorded Codex rate-limit errors (D7).
- No Stop hook equivalent: completion comes from `crew done`, and the existing "run ended without `crew done`" fallback applies (same path as Claude without the hook).

### 4.2 Pull mode

- Agent token as today. `crew join --token` returns role, persona, rules, workdir and project memory (story 41) and marks the agent `connected` (`lastHeartbeatAt = now`).
- `crew next --wait 90` long-polls (<90 s, below tool timeouts). The server provisions the worktree and moves the task `ready → doing` exactly as the Dispatcher does for spawn agents, but **assigns to the connected Pull agent instead of spawning**; the response carries the full prompt (same prompt builder as spawn). No task: `{ retryIn }` and the CLI tells the agent to call again.
- Every `crew` call from a Pull agent (`update`, `ask`, `remember`, `done`, `next`) refreshes `lastHeartbeatAt`; a dedicated `POST /api/agents/:id/heartbeat` exists for idle waiting.
- After `crew done` the response tells the agent to clear context and run `crew join` again (story 68). Verification, review, retries and merge are unchanged (story 70).
- Pull runs have no child process: the run record has no pid, `crew logs` shows the reported updates, and Stop-all/cancel mark the task and tell the agent on its next call.

### 4.3 Heartbeat and stale

- A Pull agent with a `doing` task and no call for `staleAfterMs` (default 10 min, configurable) becomes `stale`; the task goes back to `ready` without charging a retry, the run is ended `stale`, and the worktree branch is kept for the next assignee. A stale agent that calls again is reconnected, and its old task is refused with a clear message.
- Spawn agents are unchanged (process exit is the signal).

### 4.4 Antigravity

Pull mode only (D17): `cliType: antigravity`, mode `pull`; Crew prints a one-paste connect prompt (join + next loop). No adapter code beyond `detect` reporting `headless: false`.

### 4.5 UI

Team shows mode and status including stale; Board card agent badge shows stale; a "Connect prompt" copy button for Pull agents. shadcn components only (D81).

## 5. Tracer bullets

0. **Codex fixtures + adapter.** Record real `codex exec --json` runs (normal, resume, rate-limit if obtainable) as fixtures; implement the adapter; contract tests. *Needs a human-run recording (paid), like milestone 3.*
1. **Codex wiring.** `cliType: codex` in init/team/config, detection in `crew init`, dispatch/resume/rate-limit through the harness with a Codex-shaped fake, sandbox mapping tests.
2. **Pull join/next/heartbeat.** Endpoints, CLI handlers, long-poll, assignment without spawn, prompt parity test, auth isolation tests.
3. **Pull completion path.** `done`/`ask`/`update`/`remember` from a Pull agent through verification → review → merge in the harness; stop-all/cancel semantics.
4. **Stale detection.** Scanner, requeue without retry charge, reconnect behaviour, restart recovery.
5. **Antigravity + connect prompt + UI status.** Team/Board changes, `crew status` shows Pull/stale.
6. **Smoke and docs.** `scripts/smoke-milestone-7.ts` (manual, paid), generated commands reference, handoff.

## 6. Testing notes

Harness first (PRD): Pull mode uses the fake adapter driven through the real CLI as a "pull agent" process; stale handling uses the injected clock. Real Codex is only in recorded fixtures and the manual smoke. UI covered by `build:ui` and the manual checklist.

## 7. Decisions (approved, logged as D88–D93)

- **D88** Codex sandbox mapping as in §4.1, with the documented limitation that per-command allow/deny lists are not enforceable on Codex.
- **D89** Pull assignment reuses the Dispatcher's provisioning and prompt builder; the only difference is "hand to the polling agent" instead of "spawn".
- **D90** Stale window default 10 minutes (`staleAfterMs`), requeue without charging a retry, branch preserved.
- **D91** Every Pull agent `crew` call is a heartbeat; no background heartbeat process is required.
- **D92** Pull runs have no pid; Stop-all/cancel reach the agent on its next call.
- **D93** Milestone 7 ships Codex and Pull in one release line; Antigravity is a Pull agent type with a copy-paste connect prompt (D17).

## 8. Open questions

- Who records the Codex fixtures (user runs a small script, as in milestone 3)? Default: I write `scripts/record-codex-fixtures.ts`; the user runs it once.
- Is 10 minutes the right stale window for slow human-driven Pull sessions? Default: yes, configurable.
