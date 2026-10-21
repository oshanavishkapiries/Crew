/** MemoryStore/API wire shape; source and scope are immutable after creation. */
export type MemoryLayer = "project" | "role" | "task";
export interface MemoryEntry {
  id: string;
  workspaceId: string;
  layer: MemoryLayer;
  roleId: string | null;
  taskId: string | null;
  title: string;
  body: string;
  source: string | null;
  promotedAt: string | null;
  createdAt: string;
}
