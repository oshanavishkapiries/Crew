# Milestone 8 run guide (you drive, with the Board)

Throwaway project: `mdlint`, a tiny Markdown-lint CLI. Plan: [milestone-8.md](milestone-8.md). Record what you see; the report goes to `reports/m8-run.md`.

## 0. Before you start

1. Log in to Claude Code and confirm:
   ```bash
   claude auth status    # loggedIn must be true
   codex login status    # should say "Logged in"
   ```
2. Build and link Crew from this repo (once, on `main`):
   ```bash
   cd ~/Projects/Crew && git checkout main && npm install && npm run build && npm run build:ui && npm link
   crew --help           # proves the command is on your PATH
   ```

## 1. Create the throwaway project

```bash
mkdir -p ~/Projects/crew-m8-mdlint && cd ~/Projects/crew-m8-mdlint
git init -b main
printf '{\n  "name": "mdlint",\n  "version": "0.0.0",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n' > package.json
printf 'node_modules\n' > .gitignore
git add -A && git commit -m "Initial commit"
```

## 2. Initialize Crew with a mixed team

```bash
crew init
```

Open `crew.config.ts` and add the Codex members to `team` (keep the four default Claude agents):

```ts
team: [
  { name: 'Codex developer', role: 'backend', cliType: 'codex' },
  { name: 'Codex reviewer', role: 'reviewer', cliType: 'codex' },
],
```

Keep the per-run Claude budget limit set (about 1.00 USD) if the config has such a field. Then commit the config, because an untracked config pauses merging:

```bash
git add crew.config.ts && git commit -m "Configure Crew"
```

## 3. Start the server and open the Board

```bash
crew start        # prints http://127.0.0.1:4000/#key=... ; leave this terminal running
```

Open the printed link in your browser. The key link works once. If the page says you are logged out, run `crew open` in a second terminal for a fresh link.

In the Board, check the **Team** page: you should see the Claude agents and the two Codex agents, all with mode spawn.

## 4. Grill (Inbox)

The Orchestrator (Claude Code) starts the grill phase and asks one question at a time. Watch **Inbox** for questions and answer them there (or `crew answer` in a second terminal). Give it this idea when asked:

> A Node CLI `mdlint <files...>` that checks Markdown files for broken relative links, skipped heading levels and trailing spaces. Prints one line per problem, exits 1 when any problem is found. Phase 1 is the checks; phase 2 adds `--json` output and a README. No dependencies, use `node --test`.

Check: are the questions sensible, one at a time? Then approve the grill output at the gate on the Board (or `crew approve`).

## 5. Spec and tickets gates

1. Read the spec draft at the gate. Approve it, or reject with a note to test the reject flow once.
2. Read the tickets draft. You want about 6 to 10 tickets with dependencies and acceptance criteria. Approve.

## 6. Watch the work

On the Board, open a running task: **Log** tab shows live agent output, **Diff** shows the changes. Check:
- Both Claude and Codex agents get tasks (Team page shows who is running).
- A task goes: doing → verifying → review → merge-queue → merged.
- At least one Codex-authored task is reviewed by a Claude Reviewer and one Claude-authored task by the Codex reviewer. This is the important gap from milestone 7.
- Answer any agent questions in Inbox.

## 7. Try the failure paths (each once)

1. **Stop and resume:** press stop-all on the Board (or `crew stop-all`), see runs stop and dispatch pause, then resume (`crew resume`).
2. **Verification failure:** let it happen naturally, or `crew retry <task>` on a failed task. Watch retries count.
3. **Conflict:** if two tasks touch the same file, a conflict task appears; let an agent resolve it.

Never try to provoke a provider rate limit.

## 8. Optional: a Pull agent

Add to `crew.config.ts` `team`, commit, restart `crew start`:

```ts
{ name: 'Terminal developer', role: 'backend', cliType: 'antigravity', mode: 'pull' },
```

Then `crew connect 'Terminal developer'` (or Team → Connect prompt) and paste the private prompt into a terminal agent. Do not share or save that prompt.

## 9. Finish and check

1. Approve the phase gate(s) until the board is `done`.
2. Verify the result:
   ```bash
   cd ~/Projects/crew-m8-mdlint && git log --oneline && npm test
   printf '# A\n\n### B  \n[x](missing.md)\n' > /tmp/t.md && node ./bin/mdlint.js /tmp/t.md; echo "exit $?"
   ```
   (Use the actual entry file name from the repo if it differs.)
3. Check the **Memory** page: do the role learnings look useful?

## 10. Send me your notes

Tell me: what worked, anything confusing or broken (with the Board page or command), approximate cost, and which of these happened: Claude-to-Codex review, Codex-to-Claude review, stop/resume, retry, conflict, Pull agent. I will write `reports/m8-run.md` and file fixes.

## If something goes wrong

- `crew status` shows the board state and recovery hints.
- `crew logs --list` and `crew logs --run <id>` show past runs.
- `crew stop-all` stops everything safely. Ctrl+C in the `crew start` terminal shuts the server down.
