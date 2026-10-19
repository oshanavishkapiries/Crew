# Handoff: Crew Phase 1 — PRD done, next is tickets

## Where things stand

- Repo: `/home/oshan/Projects/Crew`. It's greenfield, with no application code yet.
- Everything is on `main`. There's no remote push yet. The docs commits add:
  - `docs/Crew Design Doc.md`: the original product design.
  - `plan/phase1/prd.md`: the Phase 1 PRD for the **whole first release** (milestones 1–8). **This is the source of truth now.** Read it first, especially the Decision Log at the top (D1–D19).
  - `docs/architecture/project-structure.md` and `docs/architecture/project-techstack.md`: the planned folder layout and tech stack.
  - `AGENTS.md` (imported by `CLAUDE.md`): agent rules, including which doc to update for each kind of change.

## How the PRD was made (context not in the files)

- Written with the `to-spec` skill, but saved as a local file rather than published to a tracker, because the repo has no issue tracker set up. The `ready-for-agent` label step was skipped for the same reason.
- A grilling session followed. The user answered D1–D4 directly, then accepted all of Claude's remaining recommendations in advance (D5–D18, tagged "Claude-decided" in the PRD). D19 came later from the user: core safety features move to milestone 2 so the private preview is safe.
- D5 changes the design doc: structured JSON event streams instead of a PTY, and `node-pty` is dropped from spawn mode. The design doc itself was **not** updated, so the PRD overrides it wherever they disagree.

## Facts checked (2026-10-18)

- Local tools: Node v24.18.0, Claude Code 2.1.300, codex-cli 0.163.0.
- Claude Code has `-p`, `--output-format stream-json`, `--session-id <uuid>`, `--resume`, `--allowedTools`, `--disallowedTools` and `--permission-mode`. Codex has `exec --json`, `-s/--sandbox`, `-C/--cd` and `exec resume [SESSION_ID] [PROMPT]`.
- The PRD's "Open questions" section lists what is still unverified.

## Suggested next steps

1. Follow `AGENTS.md`: keep the architecture docs, the PRD and this handoff in sync with every change.
2. Break the PRD into tracer-bullet tickets following the milestone build order. Milestone 1 (core + fake adapter + commands reference) comes first. Ask the user where tickets should live: there's no tracker yet, so local files under `plan/phase1/` are the likely default.
3. Optionally, sync the design doc with D5 and D19, or add a note in it pointing to the PRD.

## User working preferences

- Grilling: one question at a time, in plain spoken sentences that read well through text-to-speech, always with a recommended answer. (Also saved to Claude memory.)
- The user is happy to delegate design decisions, but wants Claude's decisions clearly flagged.
- Wants a living commands reference doc from day one (see D3 in the PRD).

## Suggested skills

- `to-tickets`: break `plan/phase1/prd.md` into tickets with blocking edges.
- `grilling`: if the user wants to revisit any Claude-decided item (D5–D18), keeping one TTS-friendly question at a time.
- `to-spec`: only if the PRD needs a full re-synthesis; small changes are easier as direct edits.
- `code-review`: once implementation starts, to review branches against the PRD.
