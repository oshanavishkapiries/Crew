# Crew Commands Reference

> **Note:** This document is generated from command declarations in `src/cli/declarations.ts`.
> A test enforces that this file never drifts from the CLI definitions (PRD Decision D3).

## Human Commands

Commands used by developers to manage workspaces, start the server, inspect agents, and approve workflow gates.

### `crew start`

Launches the local Crew server and web Task Board on 127.0.0.1.

**Options:**

- `-p, --port <number>`: Port to bind server to (default: `4000`)
- `-h, --host <host>`: Host to bind server to (default: `127.0.0.1`)

**Examples:**

Start the server with default port (4000):

```bash
crew start
```

Start the server on port 4001:

```bash
crew start --port 4001
```

---

### `crew init`

Creates a crew.config.ts with sensible defaults for verify commands, roles, and limits.

**Examples:**

Initialize crew configuration:

```bash
crew init
```

---

### `crew status`

Prints a summary of active agents, tasks, and budget usage in the terminal.

**Examples:**

View current project status:

```bash
crew status
```

---

### `crew stop-all`

Immediately halts all running agents and pauses task dispatching.

**Examples:**

Stop all running processes and dispatching:

```bash
crew stop-all
```

---

### `crew tasks`

Lists tasks in the workspace along with their status, assigned agent, and retries.

**Examples:**

List all tasks:

```bash
crew tasks
```

---

### `crew logs`

Streams structured events and output logs for the specified task.

**Arguments:**

- `task` (required): Task ID or slug

**Options:**

- `-f, --follow`: Follow log output in real time

**Examples:**

View logs for task-1:

```bash
crew logs task-1
```

Follow live logs for task-1:

```bash
crew logs task-1 --follow
```

---

### `crew diff`

Displays the current git diff of the task worktree against the base branch.

**Arguments:**

- `task` (required): Task ID or slug

**Examples:**

View diff for task-1:

```bash
crew diff task-1
```

---

### `crew cancel`

Cancels the specified task from any non-terminal state.

**Arguments:**

- `task` (required): Task ID or slug

**Examples:**

Cancel task-1:

```bash
crew cancel task-1
```

---

### `crew approve`

Approves a draft phase output or review gate from the terminal.

**Arguments:**

- `target` (required): Phase name or Task ID to approve

**Examples:**

Approve the spec phase:

```bash
crew approve spec
```

---

### `crew answer`

Responds to an agent question posted via crew ask, resuming the agent session.

**Arguments:**

- `task` (required): Task ID or slug
- `response` (required): Answer text to send to the agent

**Examples:**

Answer question for task-1:

```bash
crew answer task-1 "Use ESM modules"
```

---

### `crew memory`

Inspect, curate, or promote project and role memory.

**Arguments:**

- `action` (required): Action to perform: list, get, set, promote
- `key` (optional): Memory key or ID

**Examples:**

List project memory items:

```bash
crew memory list
```

---

### `crew worktree`

Manage task worktrees, including cleaning up abandoned worktrees.

**Arguments:**

- `subcommand` (required): Worktree action, e.g. gc

**Examples:**

Garbage collect inactive task worktrees:

```bash
crew worktree gc
```


## Agent Commands

Commands executed by AI agents in their worktrees to communicate progress, ask questions, and submit work.

### `crew join`

Connects agent using its token and receives role, persona, rules, workdir, and project memory.

**Options:**

- `-t, --token <token>`: Agent authentication token

**Examples:**

Connect agent with token:

```bash
crew join --token $CREW_AGENT_TOKEN
```

---

### `crew next`

Fetches the next dispatchable task for this agent, with optional long-poll wait.

**Options:**

- `-w, --wait <seconds>`: Long-poll wait duration in seconds (default: `90`)

**Examples:**

Wait up to 90s for a task:

```bash
crew next --wait 90
```

---

### `crew update`

Posts a progress update message visible on the Board and in the terminal.

**Arguments:**

- `message` (required): Progress update message

**Examples:**

Report progress:

```bash
crew update "Refactored database schema"
```

---

### `crew ask`

Posts a clarifying question to the Board/terminal and pauses process until answered.

**Arguments:**

- `question` (required): Question to ask

**Examples:**

Ask question:

```bash
crew ask "Should we use PostgreSQL or SQLite for tests?"
```

---

### `crew remember`

Stores an insight or learning in role memory so future agents of this role retain it.

**Arguments:**

- `learning` (required): Insight or guideline to remember

**Examples:**

Save learning:

```bash
crew remember "Always use transactions for multi-table updates"
```

---

### `crew done`

Marks work as complete and triggers the verification pipeline (diff, commands, review).

**Options:**

- `-r, --result <summary>`: Summary of the completed work

**Examples:**

Submit task completion:

```bash
crew done --result "Implemented user authentication"
```


## Orchestrator Commands

Commands used specifically by the Orchestrator agent to create tickets, manage phases, and assign tasks.

### `crew phase`

Checks current orchestrator phase instructions or submits phase output.

**Options:**

- `--done`: Mark current phase as done
- `--output <file>`: Path to phase output markdown file

**Examples:**

Check phase instructions:

```bash
crew phase
```

Submit spec phase output:

```bash
crew phase --done --output spec.md
```

---

### `crew ticket`

Creates a task ticket with title, description, dependencies, and acceptance criteria.

**Arguments:**

- `action` (required): Action to perform: create

**Options:**

- `--title <title>`: Task title
- `--description <desc>`: Task description
- `--criteria <criteria>`: Acceptance criteria
- `--blocked-by <ids>`: Comma-separated list of blocking task IDs
- `--role <role>`: Target role for task

**Examples:**

Create a task ticket:

```bash
crew ticket create --title "Build auth API" --role backend --criteria "JWT auth with refresh tokens"
```

---

### `crew assign`

Assigns a created task to a specific agent or role for execution.

**Arguments:**

- `agent` (required): Agent ID or role name
- `task` (required): Task ID

**Examples:**

Assign task-1 to backend agent:

```bash
crew assign backend-agent task-1
```

