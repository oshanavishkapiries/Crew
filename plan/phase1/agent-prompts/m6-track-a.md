# Milestone 6, Track A: server prerequisites (bullet 0)

Branch: `feat/m6-server` (off `feat/milestone-6-board`). Read `m6-common.md` first; it is part of this task.

Build bullet 0 of `milestone-6.md` §4.1 and §5, and nothing else:
1. **Static serving** of `dist/ui` at `/` (index fallback for client routes, safe against path traversal, correct content types, immutable caching for hashed assets only). Fallback page when the folder is missing. `tsup`/build must not fail when `ui/` has no build; add a root script hook only if Track B has not (coordinate through the report, do not edit Track B files).
2. **Browser session (D82):** single-use login key generated at `crew start`, printed in the URL fragment form, kept in memory only; `POST/GET/DELETE /api/session`; cookie auth accepted next to `X-Crew-Secret` on human endpoints and SSE; state-changing requests with cookie auth require `X-Crew-Board: 1`; cookie invalid after restart. Add `crew open` (reads `server.json`, prints and opens the URL with a fresh key; if opening a browser fails, print the URL; regenerate `docs/commands.md`). Never log the key or the cookie, and keep `server.json` mode 0600.
3. **Read endpoints** `GET /api/boards`, `GET /api/agents`, `GET /api/agents/:id`, `GET /api/roles`, and `PATCH /api/agents/:id` (systemPrompt, personality, name only; validate; human only; agent tokens get 403).
4. **Events:** let a board stream also deliver board `*` events (rate limits, stop-all); confirm `/api/tasks/:id` returns messages, runs, verification results, dependencies and commits (add what is missing, additive only); list the SSE event names and payloads in `milestone-6.md` §9 "Track A" for Track B.
5. **Tests** through the real harness and CLI: the cookie auth matrix (no auth 401; wrong key 401; key reuse 401; cookie GET ok; cookie POST without `X-Crew-Board` rejected; with it ok; wrong Host 403; agent token cannot use session or PATCH), restart invalidates the cookie, `GET /` with and without a built `dist/ui` (create a tiny fake `dist/ui` in the test; do not build the real UI), path traversal attempt, the new endpoints' shapes, `crew open` output. Every new failure path needs a human recovery (what does the user see if the login key is used or the cookie is lost? `crew open` must fix it; test that).
6. Update `project-structure.md`, `project-techstack.md`, `milestone-6.md` status, `handoff.md`.

Do not build any UI. Stop after bullet 0.
