import { asc, eq, sql } from 'drizzle-orm';
import { execa } from 'execa';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import type { ProjectConfig } from '../project-config.js';

type Task = typeof schema.tasks.$inferSelect;
type Agent = typeof schema.agents.$inferSelect;
export interface ReviewContext { diff: string; baseBranch: string; results: string; }
export interface PromptOptions {
  task: Task;
  agent: Agent;
  kind?: 'work' | 'review';
  /** Additional instructions, including phase-specific instructions. Never replaces core context. */
  instructions?: string;
  fallback?: boolean;
  reviewContext?: ReviewContext;
}
interface Entry { text: string; section: string; age: number; relevance: number; }
const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu)?.filter(word => word.length > 2) ?? []);

/** D62: all process prompts use this builder, including resumes and fresh-process fallbacks. */
export async function buildPrompt(db: CrewDatabase, options: PromptOptions): Promise<string> {
  const { task, agent } = options;
  const board = db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get();
  const workspace = board ? db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, board.workspaceId)).get() : undefined;
  const config = (workspace?.config ?? {}) as ProjectConfig;
  const role = db.db.select().from(schema.roles).where(eq(schema.roles.id, agent.roleId)).get();
  const messages = db.db.select().from(schema.messages).where(eq(schema.messages.taskId, task.id))
    .orderBy(asc(schema.messages.createdAt), sql`rowid`).all();
  const feedback = messages.filter(message => message.type === 'feedback');
  const current = feedback.at(-1);
  const review = options.kind === 'review';
  const budget = (config.memoryBudgetTokens ?? 8000) * 4;
  const persona = [
    config.roles?.[role?.name ?? '']?.defaultPrompt || role?.defaultPrompt || '',
    agent.systemPrompt,
    agent.personality ? `Persona: ${agent.personality}` : '',
  ].filter(Boolean);
  const taskContext = [
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    task.acceptanceCriteria ? `Acceptance Criteria: ${task.acceptanceCriteria}` : '',
    current ? `Latest verification feedback:\n${current.body}` : '',
    current && !review && task.kind === 'work' ? 'Please address the feedback above, fix the problems, commit your changes, and call crew done again.' : '',
    review ? 'Review the changes against the acceptance criteria. When done, call crew review approve or crew review changes --feedback "<what to change>".' : '',
    options.instructions || '',
  ].filter(Boolean);

  const qa = messages.filter(message => message.type === 'question' || message.type === 'answer');
  if (qa.length) taskContext.push(`Questions and Answers:\n${qa.map(message => `${message.type === 'question' ? 'Question' : 'Answer'}: ${message.body}`).join('\n')}`);
  if (options.reviewContext?.diff) {
    const { diff, baseBranch } = options.reviewContext;
    const cap = Math.max(1, Math.min(16000, Math.floor(budget / 2)));
    const notice = diff.length > cap ? `\n[truncated; run git diff ${baseBranch}...HEAD for the rest]` : '';
    taskContext.push(`Git diff against ${baseBranch}:\n\`\`\`diff\n${diff.slice(0, cap)}\n\`\`\`${notice}`);
  }
  const earlier = feedback.slice(0, -1);
  if (earlier.length) {
    const history = `Earlier failure attempts:\n${earlier.map((message, index) => `- Attempt ${index + 1}: ${message.body}`).join('\n')}`;
    taskContext.push([...persona, ...taskContext, history].join('\n\n').length <= budget ? history : '[Earlier failure attempts omitted: protected context exceeds the remaining prompt budget.]');
  }

  // Read-only Git context. Never stage files just to discover untracked changes.
  const workDir = task.worktreePath || workspace?.repoPath;
  const git = async (args: string[]) => {
    if (!workDir) return '';
    try { return (await execa('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: workDir, reject: false })).stdout.trim(); }
    catch { return ''; }
  };
  const changedFiles = await git(['diff', '--name-only', `${workspace?.defaultBranch || 'main'}...HEAD`]);
  const status = await git(['status', '--short']);
  const taskWords = words(`${task.title} ${task.description} ${changedFiles} ${status}`);
  const entries: Entry[] = [];
  const add = (section: string, text: string, age: Date | number = 0) => {
    const overlap = [...words(text)].filter(word => taskWords.has(word)).length;
    entries.push({ section, text, age: typeof age === 'number' ? age : age.getTime(), relevance: overlap });
  };
  if (workspace) {
    for (const entry of db.db.select().from(schema.memory).where(eq(schema.memory.workspaceId, workspace.id)).all()) {
      if (entry.layer === 'role' && entry.roleId !== agent.roleId) continue;
      if (entry.layer === 'task' && entry.taskId !== task.id) continue;
      if (!['project', 'role', 'task'].includes(entry.layer)) continue;
      add(`${entry.layer[0].toUpperCase()}${entry.layer.slice(1)} memory`, `${entry.title}\n${entry.body}\nSource: ${entry.source ?? 'unknown'}`, entry.createdAt);
    }
  }
  if (task.parentTaskId) {
    const parent = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, task.parentTaskId)).get();
    if (parent?.boardId === task.boardId) add('Task context', `Parent task: ${parent.title}\n${parent.description}`, parent.createdAt);
  }
  for (const dependency of db.db.select().from(schema.taskDependencies).where(eq(schema.taskDependencies.taskId, task.id)).all()) {
    const blocker = db.db.select().from(schema.tasks).where(eq(schema.tasks.id, dependency.blockedByTaskId)).get();
    if (!blocker || blocker.boardId !== task.boardId || blocker.status !== 'merged') continue;
    const results = db.db.select().from(schema.messages).where(eq(schema.messages.taskId, blocker.id)).all().filter(message => message.type === 'result');
    add('Task context', `Finished blocker: ${blocker.title}\n${results.map(message => message.body).join('\n')}`, blocker.updatedAt);
  }
  for (const message of messages) {
    if (['feedback', 'question', 'answer'].includes(message.type)) continue;
    const label = message.type === 'question' ? 'Question' : message.type === 'answer' ? 'Answer' : message.type === 'feedback' ? 'Earlier failure attempt' : message.type;
    add(message.type === 'question' || message.type === 'answer' ? 'Questions and Answers' : 'Task context', `${label}: ${message.body}`, message.createdAt);
  }
  if (changedFiles || status) add('Relevant files', [changedFiles, status].filter(Boolean).join('\n'), task.updatedAt);
  if (options.fallback) {
    const diffStat = await git(['diff', '--stat', 'HEAD']);
    if (diffStat || status) add('Worktree git diff --stat summary', diffStat || status, task.updatedAt);
  }
  if (options.reviewContext) {
    const { results } = options.reviewContext;
    if (results) add('Earlier verification results', results, task.updatedAt);
  }
  const order = ['Project memory', 'Role memory', 'Task memory'];
  entries.sort((a, b) => (order.indexOf(a.section) < 0 ? 3 : order.indexOf(a.section)) - (order.indexOf(b.section) < 0 ? 3 : order.indexOf(b.section)));
  const renderEntries = (projectOrRole: boolean) => entries.filter(entry => ['Project memory', 'Role memory'].includes(entry.section) === projectOrRole).map(entry => `${entry.section}:\n${entry.text}`);
  const render = () => [...persona, ...renderEntries(true), ...taskContext, ...renderEntries(false)].join('\n\n');
  let prompt = render();
  // Remove the least relevant first, oldest first on ties. Protected context may exceed the budget.
  const removalOrder = [...entries].sort((a, b) => a.relevance - b.relevance || a.age - b.age);
  for (const entry of removalOrder) {
    if (prompt.length <= budget) break;
    entries.splice(entries.indexOf(entry), 1);
    prompt = render();
  }
  return prompt;
}
