# Milestone 6 Track A report

## Summary

Bullet 0 implements static Board hosting, browser sessions and `crew open`, human Board reads/persona editing, additive task detail fields and global Board events. The server works without a UI build and tests use a tiny fake export. No UI work, dependency changes or migrations are included; the rest of milestone 6 remains for the UI track and subsequent bullets.

## Branch and commits

- Branch: `feat/m6-server`, from `feat/milestone-6-board` at `4a3a40d`.
- Implementation commit: `f0c061b91c562d2387ef9dca536af2989096355b` — `feat(m6): bullet 0 - server prerequisites`.
- This report is committed separately on the same branch.
- Work finished in the isolated `/tmp/Crew-m6-server` worktree after the concurrent UI track switched the original shared checkout to its branch. Track B's files were excluded.

## Done criteria (milestone-6.md §1)

- [x] Assigned bullet 0: nine real harness/CLI tests in `test/harness/board-server.test.ts` cover static hosting, sessions, CLI recovery, resource shapes, persona validation, task details and SSE.
- [ ] Real Board served by `crew start` with no second process: hosting is implemented and tested with a fake `dist/ui`; the real UI and packaging belong to Track B.
- [ ] Stories 107–116 in a real browser: not built or manually exercised by this track.
- [ ] shadcn/ui components and theme tokens: UI ownership; no `ui/` files touched.
- [x] Human endpoints and both SSE streams accept HttpOnly sessions: cookie flags, CSRF checks, logout, wrong Host, agent rejection and restart invalidation are tested.
- [x] Clean server suite works without building the UI: 323 tests passed in 50 files after typecheck and rebuild (660.58s). The separate real `build:ui` criterion remains Track B's work.
- [ ] User's manual browser checklist: not run.

## Test results

Final pre-implementation-commit command: `rm -r dist && npm test`.

Typecheck and tsup build passed, with no UI folder/build required:

```text
 Test Files  50 passed (50)
      Tests  323 passed (323)
   Start at  17:56:25
   Duration  660.58s (tests 96%, import 4%)
```

Pre-report-commit command: `rm -r dist && npm test`; typecheck and rebuild passed again:

```text
 Test Files  50 passed (50)
      Tests  323 passed (323)
   Start at  18:08:35
   Duration  510.00s (tests 96%, import 4%)
```

Focused verification after the route-resolution fix: `npm run typecheck && npx vitest run test/harness/board-server.test.ts`; typecheck passed and:

```text
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Start at  17:55:55
   Duration  13.32s (tests 91%, import 7%, transform 2%)
```

Development failures, preserved here rather than omitted:

- The initial seven prerequisite tests failed before implementation because the endpoints/static host were absent.
- Typecheck caught untyped JSON responses, incorrect execa child-process event APIs and an incorrect fake-adapter step name; these were corrected before the passing focused run.
- One test initially used fetch to forge Host; the existing server test showed that fetch sends its URL Host. The new test now sends an actual forged Host with `node:http` and receives 403.
- Independent review found that Next's exported `route.html` / `route/index.html` needed resolution before the root fallback. The focused static regression failed with `Fake Board` instead of `Fake Team`; both export layouts now have coverage.
- The first full development run observed that exported-route regression before its fix: `Test Files 1 failed | 49 passed (50)`; `Tests 1 failed | 321 passed (322)`; duration `632.99s`. This is superseded by the final clean run above.

The reviewer's source recheck found no remaining material findings. No real UI build, paid agent smoke, macOS browser launch or manual browser session was run.

## Failure paths and races tested

- Concurrent exchange of the same key succeeds once (204/401); wrong/malformed/reused keys and invalid cookies fail. Login failures include `crew open` recovery guidance.
- No credentials return 401; valid cookie GET succeeds; cookie stop-all, persona PATCH and logout without `X-Crew-Board: 1` are rejected, and valid retries succeed. A forged Host gets 403 even with a valid cookie.
- Agent-only and mixed human/agent credentials get 403 on sessions, key minting, persona edits and the new reads. `crew open` rejects agent environments.
- Logout revokes the cookie. Restart rejects both an old cookie and an unused old key; real `crew open` reads the new server.json despite stale environment URL/secret values and produces a usable login.
- `crew open` supports a successful browser executable stub and a missing browser executable; failure still prints a usable fragment URL with paste guidance. Missing discovery says to start Crew, malformed discovery identifies the file read error, and unreachable discovery says to start and retry.
- Invalid persona edits return field guidance; a corrected edit succeeds. Missing agents return 404 and editing one says to refresh the team list.
- Missing export gives build guidance; creating the fake export recovers it. An export missing its index returns 503 with rebuild guidance, and restoring the index recovers it. Unknown API routes and missing assets remain 404. Encoded traversal and external symlinks are rejected; malformed paths return 400.
- Cookie-authenticated Board SSE delivers local, global rate-limit and stop/resume events once, and excludes another concrete board's events. Cookie-authenticated run SSE connects successfully. No sleeps were added to tests.
- Task detail contains seeded messages, runs, verification results, dependencies and a persisted integration commit; a real fake-adapter git commit is also returned from the active worktree.

## Deviations / proposals

Recorded in `milestone-6.md` §9, **Track A**:

- Added CLI-only `POST /api/session/key`, authenticated by the human secret, so `crew open` can mint a fresh key without persisting it. Cookie callers cannot mint keys. This adds the transport required by the specified recovery command.
- Static routing resolves Next's two exported-page layouts before the requested client-route index fallback. Hash-based immutable caching is conservative: non-HTML `_next/static` filenames with hexadecimal hashes only.
- New reads/persona editing are Board-only as allowed by §4.1 / proposed D84. `crew open` is the only new CLI command.
- No root build hook was needed for the server. Track B owns `build:ui` / `prepack`; those changes were visible in the original shared checkout and were left with that track. The isolated server branch intentionally has no UI build script.
- No PRD Decision Log edits, new dependencies, schema migrations or task-state transitions.

## Docs updated

- `docs/commands.md`: regenerated with `npm run generate:docs` from the new `open` declaration.
- `docs/architecture/project-structure.md`: server prerequisite status, new API/CLI files and harness coverage.
- `docs/architecture/project-techstack.md`: static hosting, cookie auth and platform browser launchers; no new dependencies.
- `plan/phase1/milestone-6.md`: bullet 0 status and §9 Track A API shapes, SSE names/payloads, recovery and limitations.
- `plan/phase1/START_HERE.md`: updated current status and next work.
- `plan/phase1/handoff.md`: completed server scope, integration notes and remaining work.
- `plan/phase1/prd.md` was checked against the assigned contract and left unchanged per the track prompt. `README.md` has no status/doc table requiring a change.

## Known issues and unverified things

- No real UI build or browser smoke; stories/screens and packaging remain unfinished. The fallback's `npm run build:ui` instruction becomes executable when Track B's root hook is merged.
- Existing SSE connections authenticate at connection time and are not forcibly closed by logout; the client must close EventSource on logout. New requests reject the revoked cookie.
- Task commits expose current worktree history and the persisted integration commit. Pre-integration author commits are not retained as a complete history after worktree cleanup.
- Unused keys last until server restart; there is no additional time-based TTL. Session registries live only in memory. No test credentials or real login values are included in this report.
- Default macOS `open` / Linux or WSL `xdg-open` integration is not manually verified; automated tests use executable stubs. Failed launch has a tested manual-paste recovery.
- `npm install` reported four moderate vulnerabilities and existing install-script approval warnings. No audit fix or dependency upgrade was attempted in this server-only task.
