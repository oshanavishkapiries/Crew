# Agent Rules

Rules for every AI agent (Claude Code, Codex or any other) working on the Crew repository.

## Read first

- `plan/phase1/START_HERE.md`: onboarding. Context, current state and how to start implementing.
- `plan/phase1/prd.md`: what we're building and why. Its Decision Log (D1–D37) overrides `docs/Crew Design Doc.md` wherever they disagree.
- `docs/architecture/project-structure.md`: where code goes.
- `docs/architecture/project-techstack.md`: what we build with.

## Always keep the docs up to date

Docs are part of the change, not a follow-up. When your change touches something below, update the matching doc **in the same commit**:

| If you change… | Update |
| --- | --- |
| Folders: add, remove, rename, or change what a folder is for | `docs/architecture/project-structure.md` |
| Dependencies, tools, versions, supported platforms or AI tool adapters | `docs/architecture/project-techstack.md` |
| CLI commands, arguments, flags or help text | Regenerate `docs/commands.md` from the command declarations (D3); never edit generated parts by hand |
| A product or design decision, or anything that contradicts the PRD | `plan/phase1/prd.md`: add or update the entry in the Decision Log and fix the affected sections |
| Work status at the end of a session | `plan/phase1/handoff.md` |
| Project status, onboarding steps or the reading order | `plan/phase1/START_HERE.md` (and `README.md` if its status or doc table changes) |

Before you finish, check every doc above against your diff. If a doc no longer matches the code, the work isn't done.

## Working rules

- Don't commit or push unless the user asks. If you're on `main`, create a branch first.
- Follow the testing approach in the PRD: test external behaviour through the pipeline harness and adapter contract tests.
