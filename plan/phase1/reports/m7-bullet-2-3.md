# Milestone 7 session 2: bullets 2 and 3

## Scope and delivery

Implemented Pull join/next/heartbeat and the existing task completion path on
`feat/milestone-7-breadth`. Started from accepted session 1 plus task-prompt commit
`15a9624`; `git pull` reported no upstream, so `git pull origin
feat/milestone-7-breadth` completed successfully (already up to date).

Bullet 2 commit: `3ac8121` — Pull join, polling and shared provisioning.
Bullet 3 commit: `c3e5b87` — completion, review and interruption parity.
Own-diff follow-up: `ef0f722` — revalidate Pull submissions after request waits.
Legacy-test correction: `1e28706` — replace the obsolete join stub assertion with an auth check.
This report and final documentation are committed separately after verification.

Bullets 4–6 remain **not started**. No stale scanner/requeue, Antigravity adapter,
connect prompt/UI, smoke script, UI changes, paid agents, migrations or dependencies.

## What changed

- `POST /api/agents/join` authenticates only a Pull token, returns identity, role,
  configured rules, persona/system prompt, permissions, workDir and project memory,
  and records connection/activity. Connection uses lastHeartbeatAt alongside the
  existing idle/busy/stopped scheduling status; response includes connected: true.
- Own-agent next/heartbeat endpoints reject other agent IDs, spawn tokens, human
  secrets/cookies and missing/invalid credentials. Every authenticated Pull API
  call refreshes lastHeartbeatAt using the injected clock. No background heartbeat.
- Next serializes provisioning with normal spawn dispatch, shares workspace/global
  capacity and Scheduler worktree/setup/branch transitions, and uses Runner's shared
  prompt/permission builder. It creates an ordinary run with null pid/sessionId and
  no adapter invocation or process/runtime timer. Repeated same-agent requests replay
  the same active assignment; concurrent identities cannot claim one unassigned task.
- Idle wait is capped at 85 seconds, with 250 ms checks and abort-listener cleanup.
  Empty responses carry retryIn and call-again instructions; blocked tasks carry
  waiting instructions and retryIn. CLI next resolves identity via token-only join.
- Join accepts --token or CREW_AGENT_TOKEN; CLI saves/echoes neither. Subsequent calls
  use environment credentials. Next instructs setting CREW_TASK_ID/CREW_RUN_ID and
  changing to workDir, and returns effective permissions with the full prompt.
- Pull update writes progress to the normal run log. Ask ends a pid-less run as
  asked; human answer moves the task back to doing without spawning/resuming a
  child. Next carries full Q&A; other calls print a bounded answer reminder from
  X-Crew-Instruction. Stop/cancel notifications use that header, including errors.
- Done closes the run before entering the unchanged verification pipeline and
  explicitly instructs clearing context, rejoining and polling. Failed gates and
  review changes arrive as protected feedback on next and use the existing retries.
- Review context is shared by spawn and Pull Reviewers; a designated Pull Reviewer
  waits for next rather than being spawned. Its changes/approval use the existing
  endpoint and retry/merge path. Pull Orchestrator phase completion uses existing
  phase/gate behavior and cleanup. No new workflow or verification bypass.
- Pull task/phase/review mutations require the active X-Crew-Run-Id (CLI sets it
  from CREW_RUN_ID). Old IDs after stop/resume and duplicate done are refused.
  Done/ask/review revalidate inside Scheduler's transaction; update rechecks after
  request-body parsing.
- Stop-all closes Pull rows as stopped and keeps their doing task/worktree; resume
  plus next creates a new pid-less attempt without charging a retry. Cancel closes
  the row as cancelled, removes its worktree, and refuses late task writes. No
  process kill for Pull runs. Human status lists them with PID n/a, logs works,
  and the startup reaper ignores unfinished pid-less Pull rows.

## Files

Production:
`src/cli/commands/pull.ts`, `src/cli/declarations.ts`, `src/cli/client.ts`,
`src/cli/commands/done.ts`, `src/cli/commands/memory.ts`,
`src/server/api/app.ts`, `src/server/scheduler/dispatcher.ts`,
`src/server/runner/index.ts`, `src/server/runner/reaper.ts`,
`src/server/verify/index.ts`, `src/server/workflow/index.ts`.

Tests: `test/harness/pull.test.ts` (16 cases), and the updated historical join
assertion in `test/harness/agent-commands.test.ts`; real SQLite/server/git and real CLI
child processes. The reviewed-merge case runs a fake terminal agent process that
launches real join/next/update/remember/done CLI children; the Reviewer uses the
existing fake adapter. No real paid tool is invoked.

Docs: generated `docs/commands.md`; `docs/architecture/project-structure.md`;
PRD API/transport notes; `plan/phase1/milestone-7.md` §9; START_HERE and handoff;
this report. Architecture techstack and README were checked: no dependency/tool
version/platform/preview quick-start change requiring edits. No files under ui/.

## Verification

Final clean build: `rm -r dist && npm test` exited **0**. All **55 files /
378 tests** passed in **506.21s**, including typecheck, a freshly rebuilt CLI and
all 16 Pull cases. No code/test changes were made during this repeat.

Exact captured stdout/stderr:

```text
> crew@0.1.0 test
> npm run typecheck && vitest run


> crew@0.1.0 typecheck
> tsc -p test/tsconfig.json


 RUN  v5.0.5 /home/oshan/Projects/Crew


 Test Files  55 passed (55)
      Tests  378 passed (378)
   Start at  00:21:43
   Duration  506.21s (tests 96%, import 4%)
```

Earlier targeted results:

```text
npx vitest run test/harness/pull.test.ts
Test Files 1 passed (1)
Tests 11 passed (11)
Start at 00:05:19
Duration 21.48s

npx vitest run test/harness/pull.test.ts test/harness/verify-review.test.ts test/harness/phases.test.ts
Test Files 3 passed (3)
Tests 43 passed (43)
Start at 00:08:03
Duration 69.49s

npx vitest run test/harness/pull.test.ts
Test Files 1 passed (1)
Tests 15 passed (15)
Start at 00:10:17
Duration 31.64s
```

The last duplicate-done regression was then added and passed in both full suites.
`npm run generate:docs` succeeded; commands reference is generated, not edited by
hand. Typecheck passed before each implementation commit. Own-diff re-read covered
the full production/test diff, followed by the small revalidation change and a fresh
read of that diff. No implementation edits were made during the first full suite; the obsolete test
was corrected after it completed. No code/test edits were made during the final
clean repeat.

## Failures and fixes

- Initial typecheck caught unknown fetch JSON in the CLI; typed request responses
  fixed it. Later test typecheck caught inferred header-object types and an invalid
  fake script step; explicit header typing and the existing review/approve step fixed them.
- Initial six-case Pull run: five passed, one failed because the new test expected
  401 for an agent reading the human Team endpoint. Existing correct behavior is
  403, and the test expectation was corrected without changing that auth policy.
- First completion run: nine passed, two failed. The reviewed task escalated because
  the test used unsupported review_approve rather than the existing review step.
  Fixing that script produced the expected reviewed merge. The stop-notice check
  exposed X-Crew-Instruction being lost on HTTPException responses; applying the
  header after the route/error handler fixed delivery to the CLI on failures.
- Diff review found the request-body/transition wait between an initial run check
  and submission. Pull run identity is now checked again at the mutation boundary;
  the added concurrent-done test asserts one accepted result and one rejection.
- First full clean suite: 54 files passed, one failed; 377 tests passed, one failed
  (513.71s). All new Pull cases passed. The lone failure was the historical
  agent-commands test expecting join to print "not implemented". It now asserts
  exit 1, CREW_AGENT_TOKEN guidance and absence of the old stub message. This is
  the implemented command's credential failure, not a relaxed auth check.
- No failing test was hidden or skipped; final full-suite outcome is recorded above. The repeat passed all tests.

## Limits, unverified behavior and reviewer decisions

- Scope stops after bullet 3. There is no stale scanner/requeue/reconnect policy
  implementation (bullet 4), Team/Board status/connect work (5), or paid/manual
  milestone 7 smoke (6). No real external AI terminal, macOS or browser flow was
  exercised. The root suite covers fake processes and recorded adapters only.
- Pull agents must already have mode=pull records/tokens. Creating/configuring Pull
  team members and the connect prompt are not added to init/config/UI in this session.
- Crew does not own or sandbox a terminal agent. Returned permissions and no-push,
  credential-read and worktree rules are instructions for it to follow. Stop/cancel
  cannot stop arbitrary terminal file edits; the agent learns on its next Crew call
  and retired run IDs cannot mutate task endpoints. Role remember remains usable
  while stopped/cancelled, with a notification; it does not submit task work.
- Serialization is in one Dispatcher/server, not cross-server coordination. Two
  terminals sharing one token are one identity and receive the same active run;
  no independent terminal lease is claimed. No persistent answer-delivery cursor:
  bounded reminders can repeat, and next carries the full saved Q&A.
- The 85-second cap applies to idle waiting. Existing worktree setup and
  provisioning, including a pass ahead in the shared queue, can exceed it; next can replay the assignment after a lost
  response. Long-poll expiry/abort behavior beyond the short harness cases and an
  actual 85-second tool invocation are not separately tested.
- A Pull Reviewer can wait for a human-driven terminal indefinitely in this session;
  there is no stale scanner for it. Human stop/cancel still interrupt its pid-less
  run through the existing paths. No new infrastructure/policy was invented here.
- An unrelated whitespace-only edit appeared in src/server/scheduler/tickets.ts
  during verification. It was not made or staged by this implementation and is
  excluded from the delivery.
- No product decision requiring a new Decision Log entry was introduced. Existing
  D89/D91/D92 are implemented; the run-ID transport and narrow windows are stated
  in the PRD API section and milestone §9 for review.

Existing narrow review window: verdict results are written before the existing
asynchronous Scheduler transition. Interruption while worktree preparation awaits
can leave a result row even when the final status transition is refused. Pull run
revalidation protects the transition, not rollback of that earlier result write.
This session does not redesign the shared review endpoint transaction boundary.


## Final delivery checks

`git diff --check` and the staged diff check passed. The complete owned diff was
re-read, including the legacy-test correction and final docs. No ui/ file,
dependency, migration or unrelated tickets.ts formatting change is staged.
The branch is feat/milestone-7-breadth; all implementation/test/docs/report changes
are committed and the authorized next action is a normal push of this branch.
