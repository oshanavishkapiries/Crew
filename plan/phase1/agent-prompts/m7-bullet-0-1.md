# Milestone 7, session 1: bullets 0 and 1 (Codex adapter and wiring)

This file is your task. The reviewer reads your result from a file in the repo, not from chat.

## Session instructions

Work on branch `feat/milestone-7-breadth` (`git pull` first). Milestones 1 to 6 are done and on `main` (`rm -r dist && npm test` passes). **This session is bullets 0 and 1 of `plan/phase1/milestone-7.md` only. Stop after bullet 1.** Bullets 2 to 6 stay "not started".

Read first, in order: `AGENTS.md`, `plan/phase1/START_HERE.md`, `plan/phase1/milestone-7.md` (§3 to §6 are your spec), the PRD Decision Log (especially D5–D7, D17, D19, D88), `docs/architecture/project-structure.md`, `docs/architecture/project-techstack.md`, and `src/adapters/claude-code.ts` plus `test/adapters/claude-code.test.ts` as the pattern to follow.

### Bullet 0: fixtures and adapter
- Write `scripts/record-codex-fixtures.ts` (the pattern is the milestone 3 recorder in `git log`/`scripts/`). It runs the installed Codex CLI (`codex exec --json`, this machine has 0.163.0) in a throwaway temp repo for: a short task that edits a file, a resume of that session (`codex exec resume <id>`), and a read-only run that attempts a write. Use tiny prompts. Save raw output under `test/fixtures/codex/` with the version and cost/duration noted. Run it once. If Codex is not logged in or a run fails, stop that part, say so in the report, and do not invent fixture data. A rate-limit sample is optional: use it only if one occurs; never try to trigger one.
- Implement `src/adapters/codex.ts` (`CodexAdapter implements AgentAdapter`): `detect` (version, headless true), `buildSpawn` (`codex exec --json -s <sandbox>`, working directory, prompt on stdin, CREW env as Claude does), `buildResume` (`codex exec resume <id>`), `parseOutput` (chunked JSONL → `AgentEvent`, capture session id, tolerate partial lines), `isRateLimit`. Sandbox mapping per D88: read-only → `read-only`; standard/orchestrator → `workspace-write`; full → `danger-full-access` only when the profile says `full`. Network follows `allowNetwork`. Document that `allowCommands`/`denyCommands` are not enforceable per command on Codex.
- Contract tests `test/adapters/codex.test.ts` against the recorded fixtures: spawn args per permission profile, event parsing including split chunks, session id capture, resume args, rate-limit detection if a sample exists (otherwise a clearly labelled synthetic one, like `rate-limit-synthetic.jsonl`).

### Bullet 1: wiring
- Register the adapter wherever Claude Code and fake are registered (`src/adapters/index.ts`, Runner/Dispatcher lookup by `cliType`), and let `crew init` detect Codex and report it; `cliType: codex` must be accepted in config/team and by agent creation. Update `docs/commands.md` if help text changes (generated; do not hand-edit).
- Through the pipeline harness, prove a Codex-shaped agent goes through dispatch, `crew ask`/`answer` with resume, rate-limit pause/backoff, stop-all and timeout exactly like Claude Code agents. Use the fake adapter wrapped to emit Codex-shaped events if a real process is unnecessary. Completion has no Stop hook: confirm the existing "run ended without `crew done`" fallback applies and test it.
- Keep it simple. Do not start Pull mode.

## Docs (same commits)
`docs/architecture/project-structure.md`, `docs/architecture/project-techstack.md` (Codex adapter, minimum version), PRD permission section if it overstates Codex command controls, `milestone-7.md` §9 (implementation notes, limitations), `plan/phase1/handoff.md`.

## How to deliver
1. Commit on `feat/milestone-7-breadth` (bullet commits, then docs). Never touch `main`.
2. Write the final report to **`plan/phase1/reports/m7-bullet-0-1.md`**: what changed, files, real command output of `rm -r dist && npm test` (clean build), the fixture recording output and cost, limitations, anything not verified, anything you want the reviewer to decide. Commit it, then `git push origin feat/milestone-7-breadth`.
3. If the push fails, say so at the top of the report, still commit, and stop. Never force-push, never print or store credentials.
4. In chat, only say the report is pushed and give the commit hash.
