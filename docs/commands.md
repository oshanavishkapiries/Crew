# Crew Commands Reference

> **Note:** This document is generated from command declarations in `src/cli/declarations.ts`.
> A test enforces that this file never drifts from the CLI definitions (PRD Decision D3).

## Human Commands

Commands used by developers to manage workspaces, start the server, inspect agents, and approve workflow gates.

### `crew start`

Loads each workspace crew.config.ts before starting the local server on 127.0.0.1. Fix config errors and run start again; the file replaces stored settings on every start.

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

Registers the git repository, a grill board, six built-in roles and a four-agent Claude Code team. Creates a commented crew.config.ts without overwriting an existing file; safe to run twice. Review and commit the config: an untracked crew.config.ts pauses merging on the default checkout.

**Examples:**

Initialize crew configuration:

```bash
crew init
```

---

### `crew status`

Prints a summary of active agents, tasks, and budget usage, including merge pause warnings and the hint to commit an untracked crew.config.ts.

**Examples:**

View current project status:

```bash
crew status
```

---

### `crew stop-all`

Stops agents, verification and merge work, and pauses scheduling until resume.

**Examples:**

Stop all running processes and dispatching:

```bash
crew stop-all
```

---

### `crew resume`

Resumes dispatch, verification and the merge queue, and restores stopped agents to idle.

**Examples:**

Resume dispatching after stop-all:

```bash
crew resume
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

### `crew results`

Displays the pass/fail status of all verification steps and output of failed steps.

**Arguments:**

- `task` (required): Task ID or slug

**Examples:**

View verification results for task-1:

```bash
crew results task-1
```

---

### `crew queue`

Lists queued and active merge items in order, conflict sub-tasks, failures and checkout pause warnings.

**Examples:**

Inspect pending merges:

```bash
crew queue
```

---

### `crew retry`

Restarts an escalated task with retries reset to zero and an optional feedback note. Requires the human secret.

**Arguments:**

- `task` (required): Task ID

**Options:**

- `--note <text>`: Feedback for the next author run

**Examples:**

Retry an escalated task:

```bash
crew retry task-1
```

Retry with feedback:

```bash
crew retry task-1 --note "The environment is repaired"
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

Inspect and curate all three layers. Humans supply --workspace for list/add. Promotion explicitly copies role memory into project memory with provenance.

**Arguments:**

- `action` (required): Action: list, add, edit, delete, promote
- `key` (optional): Memory ID for edit, delete or promote

**Options:**

- `--workspace <id>`: Workspace ID (required for human list/add)
- `--layer <layer>`: project, role or task (add defaults to project)
- `--role <id>`: Role ID for role memory
- `--task <id>`: Task ID for task memory
- `--title <text>`: Entry title for add/edit
- `--body <text>`: Entry body for add/edit

**Examples:**

List project memory items:

```bash
crew memory list --workspace <id> --layer project
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

---

### `crew review`

Submits a review verdict (approve or changes) for the task currently under review.

**Arguments:**

- `action` (required): Verdict action: approve or changes

**Options:**

- `-f, --feedback <feedback>`: Feedback or details of requested changes

**Examples:**

Approve reviewed changes:

```bash
crew review approve
```

Request changes with feedback:

```bash
crew review changes --feedback "Add unit tests for error cases"
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

Creates a work ticket with criteria and blockers. Requires a live Orchestrator phase run or the human secret; humans supply --board and --phase. Failed validation consumes no phase quota.

**Arguments:**

- `action` (required): Action to perform: create

**Options:**

- `--board <id>`: Board ID (required for humans; inferred for the Orchestrator)
- `--phase <phase>`: Expected current phase (required for humans)
- `--assignee <agent>`: Optional agent ID or exact name in this workspace
- `--title <title>`: Task title
- `--description <desc>`: Task description
- `--criteria <criteria>`: Acceptance criteria
- `--blocked-by <ids>`: Comma-separated list of blocking task IDs
- `--role <role>`: Target role for task

**Examples:**

Create a task ticket:

```bash
crew ticket create --board board-1 --phase tickets --title "Build auth API" --role backend --criteria "JWT auth with refresh tokens"
```

---

### `crew assign`

Assigns a todo or ready work ticket to an agent ID/name or staffed role. A role clears the explicit assignee for automatic dispatch. Requires a live Orchestrator phase run or human secret.

**Arguments:**

- `agent` (required): Agent ID or role name
- `task` (required): Task ID

**Examples:**

Assign task-1 to backend agent:

```bash
crew assign backend-agent task-1
```

