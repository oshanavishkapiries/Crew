# Milestone 6: shared rules for both tracks

Read `plan/phase1/agent-prompts/m5-bullet-5.md` "Lessons" and "Known gotchas" once; they still apply (no dead ends, test the races, keep it simple, verify every report claim, `rm -r dist && npm test` before each commit, never sleep in tests, no `rm -rf`, docs updated in the same commit per AGENTS.md).

Read first: AGENTS.md, `plan/phase1/START_HERE.md`, `plan/phase1/milestone-6.md` (your spec), PRD Decision Log D2, D13, D25, D80, D81 and the "Local security" and API contract sections, `docs/architecture/project-structure.md`, `docs/architecture/project-techstack.md`.

Two agents work in parallel from `feat/milestone-6-board` (run `git pull` first). Each makes its own branch off it, as named in its prompt. File ownership (do not edit the other track's files; if you need a change there, describe it in your report):
- **Track A (server):** `src/**`, `test/**`, `drizzle/**`, `docs/commands.md`, `tsup.config.*`.
- **Track B (UI):** `ui/**`, root `package.json` scripts `build:ui`/`prepack` only, `scripts/build-ui.*`, `.gitignore` entries for `ui/out` and `ui/.next`.
- Docs (`project-structure.md`, `project-techstack.md`, `milestone-6.md` status and §9, `handoff.md`) are edited by Track A only; Track B writes its doc notes into its report and `milestone-6.md` §9 under a heading "Track B" (Track A uses "Track A"), so the merges do not conflict.

Contract both tracks rely on (milestone-6.md §4.1, D82):
- `crew start` prints `http://127.0.0.1:<port>/#key=<login key>`. The page POSTs `{ key }` to `POST /api/session`; 204 plus `Set-Cookie: crew_session` (HttpOnly, SameSite=Strict) on success, 401 on a wrong, used or expired key. `GET /api/session` returns 204 when the cookie is valid, 401 otherwise. `DELETE /api/session` logs out.
- Requests using the cookie that change state must send `X-Crew-Board: 1`. SSE and GET need only the cookie.
- New read endpoints: `GET /api/boards`, `GET /api/agents`, `GET /api/agents/:id`, `GET /api/roles`, `PATCH /api/agents/:id` (persona fields only).
- Static Board at `/` from `dist/ui` with `index.html` fallback; when missing, a short page says to run `npm run build:ui`.
- Until Track A lands, Track B develops against `next dev` with `rewrites` to a real running `crew start` (use a throwaway repo and `CREW_HOME`); a Track B page may use a clearly marked mock only for endpoints not merged yet, with a TODO listing them.

Delivery (the reviewer cannot see your chat):
1. Commit per bullet (`feat(m6): ...`, ending with the Co-Authored-By line your tooling requires). Never touch `main`. Never force-push. Never print or store credentials.
2. Write your report to `plan/phase1/reports/<your-branch-slug>.md` (format below), commit it and `git push origin <your branch>`. If the push fails, say so at the top of the report, commit it and stop.
3. In chat, only say that the report is pushed and give the commit hash.

Report format: Summary (2–4 sentences); Branch and commits; Done criteria (milestone-6.md §1, checked with evidence); Test results (`rm -r dist && npm test` summary lines pasted; for Track B also `npm run build:ui` output); Failure paths and races tested; Deviations / proposals (add them to milestone-6.md §9, do not edit the PRD Decision Log); Docs updated; Known issues and unverified things. Report only what you ran.
