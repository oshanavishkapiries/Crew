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

Requires Node 22+, git and Claude Code. From a git repository you want the team to work on:

```sh
npx crew init     # registers the repo, writes crew.config.ts, creates the team
npx crew start    # starts the server and prints the Board login URL
```

Open the printed `http://127.0.0.1:<port>/#key=...` link. It is single use; if you lose it, run `npx crew open` for a fresh one. The Board shows the task board, live agent logs, the questions inbox, phase gates, the team and memory. Everything on the Board also works from the CLI (`crew status`, `crew approve`, `crew answer`, `crew stop-all`, see `docs/commands.md`).

