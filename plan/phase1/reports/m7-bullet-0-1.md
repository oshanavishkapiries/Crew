# Milestone 7 session 1 — bullets 0 and 1

Implemented on `feat/milestone-7-breadth`, based on `a7de04b`. Stopped after bullet 1. Bullets 2–6 are **not started**. Final clean build: **54 files / 361 tests passed** (440.58 s). No UI, Pull mode, heartbeat, Antigravity adapter, dependencies or migrations added. No main checkout or force-push.

## What changed

- `src/adapters/codex.ts`: Codex 0.163.0 minimum detection; explicit sandbox mapping; prompt on stdin; exec-level cwd/sandbox before resume; Crew environment; isolated chunked JSONL parsers; real thread IDs; structured error/rate-limit detection. Command and phase-output rules are injected as advisory prompt instructions.
- `src/adapters/types.ts`, `src/adapters/index.ts`: optional per-run parser factory and public export.
- `scripts/record-codex-fixtures.ts`, `test/fixtures/codex/{short-task,resume,read-only}.jsonl`, `recording.json`: one real three-turn recording in a temporary repository. `rate-limit-synthetic.jsonl` is explicitly synthetic, never represented as recorded.
- `test/adapters/codex.test.ts`: 11 contract cases including every permission mode, network selection, environment/secret placement, resume, actual edit/resume/read-only parsing, split chunks, concurrent parser isolation, synthetic limits, missing/old/supported/failed executable detection. Detection tests use temporary shell stubs and require no account.
- `src/server/runner/index.ts`: default Codex registration, actual session capture, run-local parser lifecycle and final-line handling. Rate-limit handling is idempotent per run, and final JSON without a newline is processed before retiring the live run. Persisted Claude IDs also follow the adapter's actual spawn environment. Concurrent work starts for the same task and agent share the pending/live run; an author and Reviewer remain separate.
- `src/server/scheduler/dispatcher.ts`: an answered `asked` run resumes its saved session with the saved answer. This and concurrent-start coalescing close the answer/Dispatcher duplicate-process race exposed by the new regression.
- `src/server/project-config.ts`: additive `team: [{ name, role, cliType: 'codex'|'claude-code' }]`; role can be built-in or configured. Init/start create missing named agents. Matching names are idempotent; role/tool mismatch fails; removing config entries never removes agents. Role profiles accept boolean `allowNetwork`.
- `src/cli/commands/init.ts`: detect/report Claude and Codex, provision configured agents while preserving stored workspace settings. The existing four-agent Claude default is preserved. CLI startup still replaces stored settings from the config file.
- `src/cli/declarations.ts`, generated `docs/commands.md`: init help describes detection and configured team entries.
- `test/harness/codex.test.ts`: 8 lifecycle cases using real Node child processes, real CLI HTTP calls, real worktrees and production Codex parsing. The fake process converts its wire output to Codex JSONL before Runner sees it. No real Codex or paid agent runs in tests.
- `test/harness/config-init.test.ts`: 5 additional configuration cases proving creation/custom roles/idempotence through real CLI init/start and rejecting invalid cliType/role/duplicate names/network types.
- Architecture structure/techstack, PRD configuration/permission sections, milestone-7 §9, START_HERE and handoff updated. README has no milestone status/doc table that needs changing; its existing private-preview Claude requirements remain appropriate.

## Lifecycle evidence

The harness proves dispatch → real `crew ask` → blocked → real human `crew answer` → session resume → file edit and `crew done`. The stored session equals the child's `thread.started.thread_id`, the resumed run links to its predecessor, the answer reaches its prompt, and **exactly two** runs exist with zero retries.

Structured Codex-shaped usage-limit errors pause all Codex agents while another tool remains idle. Injected clock assertions prove first 60-second then 120-second backoff, resume of the same thread, zero retries and reset on success. A separate case verifies the reported 45-second reset time. Existing generic tests cover the rest of the capped backoff schedule.

Real `crew stop-all` kills the child and grandchild without charging a retry, leaves dispatch stopped, and real `crew resume` recovers. Max-runtime and no-output tests independently kill the process group and charge one retry. `turn.completed` without `crew done` follows D22: run exit reason `exited`, one retry, escalation when exhausted, no verification. Codex has no Stop hook.

## Fixture recording (manual, paid; run once)

Command: `npx tsx scripts/record-codex-fixtures.ts` (exit 0). Three invocations only; no rate-limit provocation and no extra paid retry/probe. Common flags: `--ignore-user-config --ignore-rules -c approval_policy="never" -c sandbox_workspace_write.network_access=false`. Prompt comes from stdin. The script checked `hello.txt` equals `hello\n`, resumed the captured thread, and checked `denied.txt` did not exist. Temporary repository removed.

Exact recorder output:

```text
codex-cli 0.163.0
{"name":"short-task","args":["--json","-s","workspace-write","-C","/tmp/crew-codex-fixtures-IabGwz","-"],"prompt":"Create hello.txt containing exactly hello followed by a newline. Do nothing else.","exitCode":0,"durationMs":19553,"usage":[{"input_tokens":30038,"cached_input_tokens":24576,"cache_write_input_tokens":0,"output_tokens":37,"reasoning_output_tokens":0}],"costUsd":null,"costNote":"CLI does not report USD cost; token usage recorded without estimating account billing."}
{"name":"resume","args":["-s","workspace-write","-C","/tmp/crew-codex-fixtures-IabGwz","resume","--json","01a15f30-fefd-7da1-8103-b25d8b842d84","-"],"prompt":"What file did you just create? Reply with its name only; do not use tools.","exitCode":0,"durationMs":11826,"usage":[{"input_tokens":45669,"cached_input_tokens":39424,"cache_write_input_tokens":0,"output_tokens":43,"reasoning_output_tokens":0}],"costUsd":null,"costNote":"CLI does not report USD cost; token usage recorded without estimating account billing."}
{"name":"read-only","args":["--json","-s","read-only","-C","/tmp/crew-codex-fixtures-IabGwz","-"],"prompt":"Try once to create denied.txt containing denied using a shell command. Do not request escalation or retry. Report the result briefly.","exitCode":0,"durationMs":18292,"usage":[{"input_tokens":29719,"cached_input_tokens":26880,"cache_write_input_tokens":0,"output_tokens":75,"reasoning_output_tokens":0}],"costUsd":null,"costNote":"CLI does not report USD cost; token usage recorded without estimating account billing."}
```

Total CLI time: 49.671 seconds. Usage: 105,426 input tokens (90,880 cached), 155 output tokens, no reported reasoning tokens. **USD cost unknown:** CLI emits usage but no USD amount and the account's billing was not read. No pricing estimate is substituted for actual cost.

The read-only stream contains the agent's denial report but **no command-execution event**. The missing file and successful script are evidence of no resulting write, not proof that a write syscall was attempted and denied. No fixture data was invented to fill that gap. No real rate-limit event occurred.

## Verification and failures encountered

- `npm run typecheck`: passed.
- `npx vitest run test/adapters/codex.test.ts`: 1 file, 11 tests passed (561 ms).
- Focused lifecycle/config/ask-resume rerun: 3 files, 31 tests passed (41.93 s).
- `npm run generate:docs`: passed; reference regenerated from declarations.
- `git diff --check`: clean.

The first focused run had two meaningful failures: the new dispatch+answer case observed an extra fresh run/session alongside the resumed run; the legacy-init regression found stored settings replaced. Both were corrected, and their assertions pass in the focused rerun. One intermediate typecheck caught a missing `and` import while adding the answer lookup; corrected before running tests. Contract tests were written after the adapter, so no red-first claim is made for them.

The first clean-build suite found one additional regression in my new coalescing guard: an author retry reused its still-ending Reviewer's run. The guard is now scoped to the same agent, with separate pending keys for task/agent/run kind. This was caught by the existing external review changes-requested test; its timeout was not weakened.

First clean-build attempt, real output (exit 1):

```text
 Test Files  1 failed | 53 passed (54)
      Tests  1 failed | 359 passed (360)
   Start at  21:38:32
   Duration  449.59s (tests 95%, import 4%)
```

Failure: `test/harness/verify-review.test.ts` → changes requested; `Timed out waiting for task task-review-changes to reach merge-queue (current: doing)`.

During review I stopped an intermediate repeat to add two rate-limit regressions. They both failed before the fixes: duplicate `error` + `turn.failed` advanced initial backoff to 120 seconds instead of 60; a terminal limit without newline was treated as `exited`. Runner now ignores repeated limit events from an already limited run and flushes the final line before removing it from live runs. The strengthened Codex suite plus the affected review suite passed: **2 files / 13 tests**, 14.06 s (21:51:33). No extra paid runs.

The final clean-build rerun passed; its exact output is below.

## Limitations / reviewer decisions

D88 is implemented literally: `read-only → read-only`, `standard/orchestrator → workspace-write`, and **only explicit full → danger-full-access**. Workspace-write network follows `allowNetwork` (false unless true). Config and execpolicy rules are ignored and approval policy is never. No sandbox bypass flag is used.

Codex cannot enforce per-command allow/deny lists, git push denial, Crew state-file read denial, or the Orchestrator's single-output-file restriction. Those remain prompt rules. Workspace-write permits other worktree writes. Full has no OS filesystem or network containment; a false network flag cannot constrain full. PRD permission wording and architecture docs now disclose this rather than promising Claude's command controls.

**Reviewer decision:** a real Codex workflow using the localhost Crew API inside a network-disabled sandbox has not been verified. Workspace-write users can explicitly enable role `allowNetwork`, but that also enables external networking. A read-only Reviewer normally has no network, and its fixed profile offers no scoped local HTTP exception. A future scoped transport/network solution is needed before claiming real mixed-tool review parity. The harness proves Crew engine behavior, not real Codex sandbox HTTP access. No real Crew Codex workflow, paid review, mixed-team smoke, macOS run or UI log rendering was tested. Team UI caveats/status work stays out of this server session.

`config.team` is additive provisioning, not full reconciliation: existing named agents cannot change tool/role via the config, and omitted entries remain registered. Running init still creates/repairs the default Claude team before loading optional configured additions. A malformed config can therefore leave that base initialization in place, but configured additions and startup config changes are transactional.

Current official references consulted alongside the installed 0.163.0 `exec` / `exec resume` help: [non-interactive mode](https://developers.openai.com/codex/noninteractive) and [Codex security](https://developers.openai.com/codex/security). The installed help and real recorder established this version's argument placement and JSONL shape.

## Commits

- `78125a96bcbbbf77535b9cf40a142c22656d452f` — bullet 0: adapter and recorded fixtures.
- `a1250c2351377414e43652e339207cf588e7fe55` — bullet 1: configuration, runtime wiring and lifecycle regressions.
- Final docs commit on the same branch contains this report, milestone notes, onboarding status and handoff.

## Final clean-build verification

Command: `rm -r dist && npm test` (exit 0). The global setup rebuilt the real CLI from source; UI export is intentionally separate and was not run because no UI changed. Exact captured command output:

```text

> crew@0.1.0 test
> npm run typecheck && vitest run


> crew@0.1.0 typecheck
> tsc -p test/tsconfig.json


 RUN  v5.0.5 /home/oshan/Projects/Crew


 Test Files  54 passed (54)
      Tests  361 passed (361)
   Start at  21:51:58
   Duration  440.58s (tests 95%, import 4%)

```

`git diff --check` and the staged diff check were clean. No test thresholds or timeouts were weakened.
