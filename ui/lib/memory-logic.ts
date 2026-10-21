export function memoryScope(
  layer: string,
  roleId: string,
  taskId: string,
): { roleId?: string; taskId?: string } {
  if (layer === "project") return {};
  if (layer === "role") {
    if (!roleId) throw new Error("Select a role.");
    return { roleId };
  }
  if (layer === "task") {
    if (!taskId) throw new Error("Select a task.");
    return { taskId };
  }
  throw new Error("Unknown memory layer.");
}
export function canPromote(entry: {
  layer: string;
  promotedAt: string | null;
}) {
  return entry.layer === "role" && !entry.promotedAt;
}
