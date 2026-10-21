import { handleJoin, handleNext } from './commands/pull.js';
import { handleApprove } from './commands/approve.js';
import { handlePhase } from './commands/phase.js';
import { handleMemory, handleRemember } from './commands/memory.js';
import { handleAssign, handleTicket } from './commands/ticket.js';
import { handleInit } from './commands/init.js';
import { handleAnswer } from './commands/answer.js';
import { handleAsk } from './commands/ask.js';
import { handleCancel } from './commands/cancel.js';
import { handleDiff } from './commands/diff.js';
import { handleDone } from './commands/done.js';
import { handleHook } from './commands/hook.js';
import { handleLogs } from './commands/logs.js';
import { handleQueue } from './commands/queue.js';
import { handleRetry } from './commands/retry.js';
import { handleResults } from './commands/results.js';
import { handleResume } from './commands/resume.js';
import { handleReview } from './commands/review.js';
import { handleOpen } from './commands/open.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';
import { handleStopAll } from './commands/stop-all.js';
import { handleTasks } from './commands/tasks.js';
import { handleUpdate } from './commands/update.js';
import { handleWorktree } from './commands/worktree.js';
import type { CommandDefinition } from './types.js';

export const COMMANDS: CommandDefinition[] = [
  {
    name: 'open',
    category: 'human',
    summary: 'Open the Task Board with a fresh one-time login URL',
    description: 'Reads server.json and opens the Board in your browser. Run this again if a login key was used or the browser lost its session. If opening fails, paste the printed URL into a browser.',
    action: handleOpen,
  },
  // Setup & Human commands
  {
    name: 'start',
    category: 'human',
    summary: 'Start the Crew server and web Task Board',
    description: 'Loads each workspace crew.config.ts before starting the local server on 127.0.0.1. Fix config errors and run start again; the file replaces stored settings on every start.',
    options: [
      { flags: '-p, --port <number>', description: 'Port to bind server to', defaultValue: 4000 },
      { flags: '-h, --host <host>', description: 'Host to bind server to', defaultValue: '127.0.0.1' },
    ],
    examples: [
      { description: 'Start the server with default port (4000)', command: 'crew start' },
      { description: 'Start the server on port 4001', command: 'crew start --port 4001' },
    ],
    action: handleStart,
  },
  {
    name: 'init',
    category: 'human',
    summary: 'Initialize Crew in the current repository',
    description: 'Registers the git repository, a grill board, six built-in roles and a four-agent Claude Code team. Detects Claude Code and Codex; optional config.team entries add named spawn agents with cliType claude-code or codex. Creates a commented crew.config.ts without overwriting an existing file; safe to run twice. Review and commit the config: an untracked crew.config.ts pauses merging on the default checkout.',
    action: handleInit,
    examples: [
      { description: 'Initialize crew configuration', command: 'crew init' },
    ],
  },
  {
    name: 'status',
    category: 'human',
    summary: 'Show board phases, gates, agents and tasks',
    description: 'Shows each board phase, pending draft and exact approval command, phase task state, recovery hints and dispatch ticket counts. Also lists agents, live runs, rate limits and merge pause warnings.',
    examples: [
      { description: 'View current project status', command: 'crew status' },
    ],
    action: handleStatus,
  },
  {
    name: 'stop-all',
    category: 'human',
    summary: 'Emergency stop switch for all running agents',
    description: 'Stops agents, verification and merge work, and pauses scheduling until resume.',
    examples: [
      { description: 'Stop all running processes and dispatching', command: 'crew stop-all' },
    ],
    action: handleStopAll,
  },
  {
    name: 'resume',
    category: 'human',
    summary: 'Resume task dispatch after stop-all',
    description: 'Resumes dispatch, verification and the merge queue, and restores stopped agents to idle.',
    examples: [
      { description: 'Resume dispatching after stop-all', command: 'crew resume' },
    ],
    action: handleResume,
  },
  {
    name: 'tasks',
    category: 'human',
    summary: 'List tasks and their current states',
    description: 'Lists tasks across registered boards with status, assigned agent and retries. Filters combine with AND. Roles and assignees accept an ID or a unique exact name; boards accept an ID. A valid combination with no matches prints No tasks found.',
    options: [
      { flags: '--status <status>', description: 'Task state: todo, ready, doing, verifying, review, merge-queue, merged, blocked, escalated, cancelled' },
      { flags: '--role <role>', description: 'Role ID or unique exact role name' },
      { flags: '--board <id>', description: 'Board ID (shown by crew status)' },
      { flags: '--assignee <agent>', description: 'Agent ID or unique exact agent name (shown by crew status)' },
    ],
    examples: [
      { description: 'List all tasks', command: 'crew tasks' },
      { description: 'Find ready backend tasks on a board', command: 'crew tasks --status ready --role backend --board board-1' },
    ],
    action: handleTasks,
  },
  {
    name: 'logs',
    category: 'human',
    summary: 'Follow live agent logs for a task',
    description: 'Reads the latest run by default, or selects an earlier run with --run. Reads a bounded tail (default 256 KiB, maximum 2048 KiB), reports truncation and missing files, and follows a selected live run with --follow.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
    ],
    options: [
      { flags: '-f, --follow', description: 'Follow log output in real time' },
      { flags: '--list', description: 'List this task’s run IDs, times, adapter, agent and exit results' },
      { flags: '--run <id>', description: 'Run ID belonging to this task (default: latest)' },
      { flags: '--tail <kb>', description: 'Tail size in KiB, from 1 to 2048 (default: 256)' },
    ],
    examples: [
      { description: 'View logs for task-1', command: 'crew logs task-1' },
      { description: 'Follow live logs for task-1', command: 'crew logs task-1 --follow' },
    ],
    action: handleLogs,
  },
  {
    name: 'diff',
    category: 'human',
    summary: 'View git diff for a task',
    description: 'Displays the current git diff of the task worktree against the base branch.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
    ],
    examples: [
      { description: 'View diff for task-1', command: 'crew diff task-1' },
    ],
    action: handleDiff,
  },
  {
    name: 'results',
    category: 'human',
    summary: 'Print verification results for a task',
    description: 'Displays the pass/fail status of all verification steps and output of failed steps.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
    ],
    examples: [
      { description: 'View verification results for task-1', command: 'crew results task-1' },
    ],
    action: handleResults,
  },
  {
    name: 'queue',
    category: 'human',
    summary: 'Show the merge queue and pause warnings',
    description: 'Lists queued and active merge items in order, conflict sub-tasks, failures and checkout pause warnings.',
    examples: [{ description: 'Inspect pending merges', command: 'crew queue' }],
    action: handleQueue,
  },
  {
    name: 'retry',
    category: 'human',
    summary: 'Retry an escalated task or cancelled phase',
    description: 'Restarts an escalated task with retries reset to zero and an optional feedback note. A cancelled phase gets a replacement task in the same phase; cancelled work stays terminal. Requires the human secret.',
    args: [{ name: 'task', description: 'Task ID', required: true }],
    options: [{ flags: '--note <text>', description: 'Feedback for the next author run' }],
    examples: [
      { description: 'Retry an escalated task', command: 'crew retry task-1' },
      { description: 'Retry with feedback', command: 'crew retry task-1 --note "The environment is repaired"' },
    ],
    action: handleRetry,
  },
  {
    name: 'cancel',
    category: 'human',
    summary: 'Cancel a task',
    description: 'Cancels the specified task from any non-terminal state.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
    ],
    examples: [
      { description: 'Cancel task-1', command: 'crew cancel task-1' },
    ],
    action: handleCancel,
  },
  {
    name: 'approve',
    category: 'human',
    summary: 'Approve or reject a draft phase output',
    description: 'Approves the current draft once. Edits store file contents; rejection starts a fresh phase run with the required note. Use --draft to pin the expected gate.',
    options: [
      { flags: '--board <id>', description: 'Board ID (required)' },
      { flags: '--draft <id>', description: 'Expected draft ID; otherwise read the current gate' },
      { flags: '--edit <file>', description: 'Replace the draft with the text in this file' },
      { flags: '--reject', description: 'Reject this draft and rerun the phase' },
      { flags: '--note <text>', description: 'Feedback for rejection (required with --reject)' },
    ],
    action: handleApprove,
    examples: [{ description: 'Approve a gate', command: 'crew approve --board <id> --draft <id>' }],
  },
  {
    name: 'answer',
    category: 'human',
    summary: 'Answer a blocked agent question',
    description: 'Responds to an agent question posted via crew ask, resuming the agent session.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
      { name: 'response', description: 'Answer text to send to the agent', required: true },
    ],
    examples: [
      { description: 'Answer question for task-1', command: 'crew answer task-1 "Use ESM modules"' },
    ],
    action: handleAnswer,
  },
  {
    name: 'memory',
    category: 'human',
    summary: 'View and edit memory',
    description: 'Inspect and curate all three layers. Humans supply --workspace for list/add. Promotion explicitly copies role memory into project memory with provenance.',
    args: [
      { name: 'action', description: 'Action: list, add, edit, delete, promote', required: true },
      { name: 'key', description: 'Memory ID for edit, delete or promote', required: false },
    ],
    options: [
      { flags: '--workspace <id>', description: 'Workspace ID (required for human list/add)' },
      { flags: '--layer <layer>', description: 'project, role or task (add defaults to project)' },
      { flags: '--role <id>', description: 'Role ID for role memory' },
      { flags: '--task <id>', description: 'Task ID for task memory' },
      { flags: '--title <text>', description: 'Entry title for add/edit' },
      { flags: '--body <text>', description: 'Entry body for add/edit' },
    ],
    action: handleMemory,
    examples: [
      { description: 'List project memory items', command: 'crew memory list --workspace <id> --layer project' },
    ],
  },
  {
    name: 'worktree',
    category: 'human',
    summary: 'Manage task worktrees',
    description: 'Manage task worktrees, including cleaning up abandoned worktrees.',
    args: [
      { name: 'subcommand', description: 'Worktree action, e.g. gc', required: true },
    ],
    examples: [
      { description: 'Garbage collect inactive task worktrees', command: 'crew worktree gc' },
    ],
    action: handleWorktree,
  },

  // Agent commands
  {
    name: 'join',
    action: handleJoin,
    category: 'agent',
    summary: 'Join workspace and receive agent context',
    description: 'Connects a Pull agent using --token or CREW_AGENT_TOKEN and returns role, persona, rules, workDir and project memory. Set CREW_SERVER_URL for a nondefault server. Tokens are never echoed or saved; keep CREW_AGENT_TOKEN in the terminal environment for subsequent calls.',
    options: [
      { flags: '-t, --token <token>', description: 'Agent authentication token' },
    ],
    examples: [
      { description: 'Connect agent with token', command: 'crew join --token $CREW_AGENT_TOKEN' },
    ],
  },
  {
    name: 'next',
    action: handleNext,
    category: 'agent',
    summary: 'Poll for next assigned task (Pull mode)',
    description: 'Requires CREW_AGENT_TOKEN. Returns the assigned worktree, task/run IDs and full prompt without spawning a process. Set CREW_TASK_ID and CREW_RUN_ID and change to workDir before working. Wait is capped at 85 seconds. No task returns retryIn and instructions to call again.',
    options: [
      { flags: '-w, --wait <seconds>', description: 'Long-poll wait in seconds (nonnegative, capped at 85)', defaultValue: 90 },
    ],
    examples: [
      { description: 'Wait up to 90s for a task', command: 'crew next --wait 90' },
    ],
  },
  {
    name: 'update',
    category: 'agent',
    summary: 'Report progress on the current task',
    description: 'Posts a progress update message visible on the Board and in the terminal.',
    args: [
      { name: 'message', description: 'Progress update message', required: true },
    ],
    examples: [
      { description: 'Report progress', command: 'crew update "Refactored database schema"' },
    ],
    action: handleUpdate,
  },
  {
    name: 'ask',
    category: 'agent',
    summary: 'Ask a question and block task until answered',
    description: 'Posts a clarifying question to the Board/terminal and pauses process until answered.',
    args: [
      { name: 'question', description: 'Question to ask', required: true },
    ],
    examples: [
      { description: 'Ask question', command: 'crew ask "Should we use PostgreSQL or SQLite for tests?"' },
    ],
    action: handleAsk,
  },
  {
    name: 'remember',
    category: 'agent',
    summary: 'Save a learning to role memory',
    description: 'Stores an insight or learning in role memory so future agents of this role retain it.',
    args: [
      { name: 'learning', description: 'Insight or guideline to remember', required: true },
    ],
    action: handleRemember,
    examples: [
      { description: 'Save learning', command: 'crew remember "Always use transactions for multi-table updates"' },
    ],
  },
  {
    name: 'done',
    category: 'agent',
    summary: 'Submit current task for verification',
    description: 'Marks work as complete and triggers the verification pipeline (diff, commands, review).',
    options: [
      { flags: '-r, --result <summary>', description: 'Summary of the completed work' },
    ],
    examples: [
      { description: 'Submit task completion', command: 'crew done --result "Implemented user authentication"' },
    ],
    action: handleDone,
  },
  {
    name: 'review',
    category: 'agent',
    summary: 'Submit a review verdict for the current task',
    description: 'Submits a review verdict (approve or changes) for the task currently under review.',
    args: [
      { name: 'action', description: 'Verdict action: approve or changes', required: true },
    ],
    options: [
      { flags: '-f, --feedback <feedback>', description: 'Feedback or details of requested changes' },
    ],
    examples: [
      { description: 'Approve reviewed changes', command: 'crew review approve' },
      { description: 'Request changes with feedback', command: 'crew review changes --feedback "Add unit tests for error cases"' },
    ],
    action: handleReview,
  },
  {
    name: 'hook',
    category: 'agent',
    summary: 'Internal hook handler',
    description: 'Internal lifecycle hook called by agent tools (e.g. Claude Code Stop hook).',
    args: [
      { name: 'event', description: 'Hook event name (e.g. stop)', required: true },
    ],
    examples: [
      { description: 'Stop hook invocation', command: 'crew hook stop' },
    ],
    action: handleHook,
    hidden: true,
  },

  // Orchestrator commands
  {
    name: 'phase',
    category: 'orchestrator',
    summary: 'Inspect current phase or complete it',
    description: 'Shows instructions and scoped memory for the live Orchestrator phase task. Use done --output with a non-empty Markdown file to store a draft and stop at the human gate. Crew supplies CREW_TASK_ID and CREW_AGENT_TOKEN; humans inspect gates with crew status and decide them with crew approve.',
    args: [{ name: 'action', description: 'done to submit the phase output', required: false }],
    action: handlePhase,
    options: [
      { flags: '--output <file>', description: 'Path to phase output markdown file' },
    ],
    examples: [
      { description: 'Check phase instructions', command: 'crew phase' },
      { description: 'Submit spec phase output', command: 'crew phase done --output phase-output.md' },
    ],
  },
  {
    name: 'ticket',
    category: 'orchestrator',
    summary: 'Create or edit a task ticket',
    description: 'Creates a work ticket with criteria and blockers. Requires a live Orchestrator phase run or the human secret; humans supply --board and --phase. Failed validation consumes no phase quota. Human-only edit updates pending, unstarted tickets at a tickets gate or during dispatch, including replacement blockers; use --assignee "" or --blocked-by "" to clear them.',
    action: handleTicket,
    args: [
      { name: 'action', description: 'Action to perform: create or edit', required: true },
      { name: 'task', description: 'Task ID (required for edit)', required: false },
    ],
    options: [
      { flags: '--board <id>', description: 'Board ID for create (required for humans; inferred for the Orchestrator)' },
      { flags: '--phase <phase>', description: 'Expected current phase for create (required for humans)' },
      { flags: '--assignee <agent>', description: 'Optional agent ID or exact name in this workspace' },
      { flags: '--title <title>', description: 'Task title' },
      { flags: '--description <desc>', description: 'Task description' },
      { flags: '--criteria <criteria>', description: 'Acceptance criteria' },
      { flags: '--blocked-by <ids>', description: 'Comma-separated list of blocking task IDs' },
      { flags: '--role <role>', description: 'Target role for task' },
    ],
    examples: [
      {
        description: 'Create a task ticket',
        command: 'crew ticket create --board board-1 --phase tickets --title "Build auth API" --role backend --criteria "JWT auth with refresh tokens"',
      },
    ],
  },
  {
    name: 'assign',
    category: 'orchestrator',
    summary: 'Assign a task to an agent or role',
    description: 'Assigns a todo or ready work ticket to an agent ID/name or staffed role. A role clears the explicit assignee for automatic dispatch. Requires a live Orchestrator phase run or human secret.',
    action: handleAssign,
    args: [
      { name: 'agent', description: 'Agent ID or role name', required: true },
      { name: 'task', description: 'Task ID', required: true },
    ],
    examples: [
      { description: 'Assign task-1 to backend agent', command: 'crew assign backend-agent task-1' },
    ],
  },
];
