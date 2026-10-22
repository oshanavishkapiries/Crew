```text
 ██████╗██████╗ ███████╗██╗    ██╗
██╔════╝██╔══██╗██╔════╝██║    ██║
██║     ██████╔╝█████╗  ██║ █╗ ██║
██║     ██╔══██╗██╔══╝  ██║███╗██║
╚██████╗██║  ██║███████╗╚███╔███╔╝
 ╚═════╝╚═╝  ╚═╝╚══════╝ ╚══╝╚══╝ 
```

# Crew

Crew is a CLI tool that turns AI coding agents (Claude Code, Codex, Antigravity) into a tool-independent dev team with its own memory. It runs a local web Task Board, spawns agents, verifies their work and merges it into the main branch.

## Quick start (private preview)

Crew is not published to npm yet, so `npx crew` does not work. Until the preview package exists, run it from a clone. Requires Node 22+, git and authenticated Claude Code for the default team. Configured spawn agents can also use authenticated Codex.

```sh
git clone <this repo> && cd Crew
npm install
npm run build        # builds the CLI into dist/
npm run build:ui     # builds the Board into dist/ui (run after the CLI build)
npm link             # puts the `crew` command on your PATH
```

Then, from a git repository you want the team to work on:

```sh
crew init     # registers the repo, writes crew.config.ts, creates the team
git add crew.config.ts && git commit -m "Configure Crew"
crew start    # starts the server and prints the Board login URL
```

Open the printed `http://127.0.0.1:<port>/#key=...` link. It is single use; if you lose it, run `crew open` for a fresh one. The Board shows the task board, live agent logs, the questions inbox, phase gates, the team and memory. Everything on the Board also works from the CLI (`crew status`, `crew approve`, `crew answer`, `crew stop-all`, see `docs/commands.md`).

To add Codex or a terminal agent, add entries to `team` in `crew.config.ts`
before starting (existing names are additive; use a new name to change tool/mode):

```ts
team: [
  { name: 'Codex developer', role: 'backend', cliType: 'codex' },
  { name: 'Terminal developer', role: 'backend', cliType: 'antigravity', mode: 'pull' },
],
```

Run `crew connect 'Terminal developer'` (or Team → Connect prompt) and paste the
private prompt into that agent's terminal. It runs `crew join` and the `crew next`
loop; each new connect prompt invalidates the previous token. Antigravity runs
only in Pull mode. Crew cannot sandbox or kill an external terminal. Codex uses
workspace-write with network enabled for the local Crew API; command restrictions
and the Reviewer's no-edit rule are prompt rules. See [milestone 7](plan/phase1/milestone-7.md)
for limits and the manual paid `npm run smoke:m7` command. Milestone 8's mixed-team
end-to-end run is still required before public release.
