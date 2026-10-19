import { handleAnswer } from './commands/answer.js';
import { handleAsk } from './commands/ask.js';
import { handleCancel } from './commands/cancel.js';
import { handleDiff } from './commands/diff.js';
import { handleDone } from './commands/done.js';
import { handleLogs } from './commands/logs.js';
import { handleResume } from './commands/resume.js';
import { handleReview } from './commands/review.js';
import { handleStart } from './commands/start.js';
import { handleStatus } from './commands/status.js';
import { handleStopAll } from './commands/stop-all.js';
import { handleTasks } from './commands/tasks.js';
import { handleUpdate } from './commands/update.js';
import { handleWorktree } from './commands/worktree.js';
import type { CommandDefinition } from './types.js';

export const COMMANDS: CommandDefinition[] = [
  // Setup & Human commands
  {
    name: 'start',
    category: 'human',
    summary: 'Start the Crew server and web Task Board',
    description: 'Launches the local Crew server and web Task Board on 127.0.0.1.',
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
    description: 'Creates a crew.config.ts with sensible defaults for verify commands, roles, and limits.',
    examples: [
      { description: 'Initialize crew configuration', command: 'crew init' },
    ],
  },
  {
    name: 'status',
    category: 'human',
    summary: 'Show status of agents, tasks, and budget',
    description: 'Prints a summary of active agents, tasks, and budget usage in the terminal.',
    examples: [
      { description: 'View current project status', command: 'crew status' },
    ],
    action: handleStatus,
  },
  {
    name: 'stop-all',
    category: 'human',
    summary: 'Emergency stop switch for all running agents',
    description: 'Immediately halts all running agents and pauses task dispatching.',
    examples: [
      { description: 'Stop all running processes and dispatching', command: 'crew stop-all' },
    ],
    action: handleStopAll,
  },
  {
    name: 'resume',
    category: 'human',
    summary: 'Resume task dispatch after stop-all',
    description: 'Resumes paused task dispatching and restores stopped agents to idle.',
    examples: [
      { description: 'Resume dispatching after stop-all', command: 'crew resume' },
    ],
    action: handleResume,
  },
  {
    name: 'tasks',
    category: 'human',
    summary: 'List tasks and their current states',
    description: 'Lists tasks in the workspace along with their status, assigned agent, and retries.',
    examples: [
      { description: 'List all tasks', command: 'crew tasks' },
    ],
    action: handleTasks,
  },
  {
    name: 'logs',
    category: 'human',
    summary: 'Follow live agent logs for a task',
    description: 'Streams structured events and output logs for the specified task.',
    args: [
      { name: 'task', description: 'Task ID or slug', required: true },
    ],
    options: [
      { flags: '-f, --follow', description: 'Follow log output in real time' },
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
    summary: 'Approve a phase output or review gate',
    description: 'Approves a draft phase output or review gate from the terminal.',
    args: [
      { name: 'target', description: 'Phase name or Task ID to approve', required: true },
    ],
    examples: [
      { description: 'Approve the spec phase', command: 'crew approve spec' },
    ],
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
    description: 'Inspect, curate, or promote project and role memory.',
    args: [
      { name: 'action', description: 'Action to perform: list, get, set, promote', required: true },
      { name: 'key', description: 'Memory key or ID', required: false },
    ],
    examples: [
      { description: 'List project memory items', command: 'crew memory list' },
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
    category: 'agent',
    summary: 'Join workspace and receive agent context',
    description: 'Connects agent using its token and receives role, persona, rules, workdir, and project memory.',
    options: [
      { flags: '-t, --token <token>', description: 'Agent authentication token' },
    ],
    examples: [
      { description: 'Connect agent with token', command: 'crew join --token $CREW_AGENT_TOKEN' },
    ],
  },
  {
    name: 'next',
    category: 'agent',
    summary: 'Poll for next assigned task (Pull mode)',
    description: 'Fetches the next dispatchable task for this agent, with optional long-poll wait.',
    options: [
      { flags: '-w, --wait <seconds>', description: 'Long-poll wait duration in seconds', defaultValue: 90 },
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

  // Orchestrator commands
  {
    name: 'phase',
    category: 'orchestrator',
    summary: 'Inspect current phase or complete it',
    description: 'Checks current orchestrator phase instructions or submits phase output.',
    options: [
      { flags: '--done', description: 'Mark current phase as done' },
      { flags: '--output <file>', description: 'Path to phase output markdown file' },
    ],
    examples: [
      { description: 'Check phase instructions', command: 'crew phase' },
      { description: 'Submit spec phase output', command: 'crew phase --done --output spec.md' },
    ],
  },
  {
    name: 'ticket',
    category: 'orchestrator',
    summary: 'Create a task ticket',
    description: 'Creates a task ticket with title, description, dependencies, and acceptance criteria.',
    args: [
      { name: 'action', description: 'Action to perform: create', required: true },
    ],
    options: [
      { flags: '--title <title>', description: 'Task title' },
      { flags: '--description <desc>', description: 'Task description' },
      { flags: '--criteria <criteria>', description: 'Acceptance criteria' },
      { flags: '--blocked-by <ids>', description: 'Comma-separated list of blocking task IDs' },
      { flags: '--role <role>', description: 'Target role for task' },
    ],
    examples: [
      {
        description: 'Create a task ticket',
        command: 'crew ticket create --title "Build auth API" --role backend --criteria "JWT auth with refresh tokens"',
      },
    ],
  },
  {
    name: 'assign',
    category: 'orchestrator',
    summary: 'Assign a task to an agent or role',
    description: 'Assigns a created task to a specific agent or role for execution.',
    args: [
      { name: 'agent', description: 'Agent ID or role name', required: true },
      { name: 'task', description: 'Task ID', required: true },
    ],
    examples: [
      { description: 'Assign task-1 to backend agent', command: 'crew assign backend-agent task-1' },
    ],
  },
];
