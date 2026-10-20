import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { CrewDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';

export class MemoryError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
export class MemoryStore {
  constructor(private readonly db: CrewDatabase) {}
  get(id: string) {
    const entry = this.db.db.select().from(schema.memory).where(eq(schema.memory.id, id)).get();
    if (!entry) throw new MemoryError(`Memory ${id} does not exist.`, 404);
    return entry;
  }
  workspace(id: unknown): string {
    if (typeof id !== 'string' || !this.db.db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get()) throw new MemoryError('A valid workspaceId is required.');
    return id;
  }
  add(input: Record<string, unknown>, source: string) {
    const workspaceId = this.workspace(input.workspaceId);
    if (!['project', 'role', 'task'].includes(String(input.layer))) throw new MemoryError('layer must be project, role or task.');
    if (typeof input.title !== 'string' || !input.title.trim() || typeof input.body !== 'string' || !input.body.trim()) throw new MemoryError('Non-empty title and body are required.');
    const layer = input.layer as string;
    let roleId: string | null = null, taskId: string | null = null;
    if (layer === 'role') {
      if (typeof input.roleId !== 'string') throw new MemoryError('Role memory requires roleId.');
      const role = this.db.db.select().from(schema.roles).where(eq(schema.roles.id, input.roleId)).get();
      const staffed = this.db.db.select().from(schema.agents).all().some(a => a.workspaceId === workspaceId && a.roleId === input.roleId);
      if (!role || !(role.isBuiltin || role.id === `configured-${workspaceId}-${role.name}` || staffed)) throw new MemoryError('Role must belong to this workspace.');
      roleId = role.id;
    } else if (input.roleId != null) throw new MemoryError('Only role memory accepts roleId.');
    if (layer === 'task') {
      const task = typeof input.taskId === 'string' ? this.db.db.select().from(schema.tasks).where(eq(schema.tasks.id, input.taskId)).get() : undefined;
      const board = task ? this.db.db.select().from(schema.boards).where(eq(schema.boards.id, task.boardId)).get() : undefined;
      if (!task || board?.workspaceId !== workspaceId) throw new MemoryError('Task must belong to this workspace.');
      taskId = task.id;
    } else if (input.taskId != null) throw new MemoryError('Only task memory accepts taskId.');
    const entry = { id: randomUUID(), workspaceId, layer, roleId, taskId, title: input.title, body: input.body, source, promotedAt: null, createdAt: new Date() };
    this.db.db.insert(schema.memory).values(entry).run();
    return this.get(entry.id);
  }
  edit(id: string, input: Record<string, unknown>) {
    this.get(id);
    const values: { title?: string; body?: string } = {};
    for (const key of ['title', 'body'] as const) if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !input[key].trim()) throw new MemoryError(`${key} must be non-empty text.`);
      values[key] = input[key];
    }
    if (!Object.keys(values).length) throw new MemoryError('Supply title or body to edit.');
    this.db.db.update(schema.memory).set(values).where(eq(schema.memory.id, id)).run();
    return this.get(id);
  }
  delete(id: string) { this.get(id); this.db.db.delete(schema.memory).where(eq(schema.memory.id, id)).run(); }
  promote(id: string) {
    return this.db.db.transaction(() => {
      const original = this.get(id);
      if (original.layer !== 'role' || original.promotedAt) throw new MemoryError('Only an unpromoted role entry can be promoted.', 409);
      const promotedAt = new Date();
      const copy = { ...original, id: randomUUID(), layer: 'project', roleId: null, taskId: null, source: `promotion:${id}:${original.source ?? 'unknown'}`, promotedAt, createdAt: promotedAt };
      this.db.db.insert(schema.memory).values(copy).run();
      this.db.db.update(schema.memory).set({ promotedAt }).where(eq(schema.memory.id, id)).run();
      return this.get(copy.id);
    });
  }
}
