"use client";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { BoardsResponse } from "@/lib/types";
import type { CrewTask } from "@/lib/gates-types";
import type { CrewAgent, CrewRole } from "@/lib/team-types";
import type { MemoryEntry, MemoryLayer } from "@/lib/memory-types";
import { canPromote, memoryScope } from "@/lib/memory-logic";
import { hasEdits, submissionGuard } from "@/lib/gates-logic";
import { useResource } from "@/lib/gates-resource";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Choice,
  ErrorNotice,
  Notice,
  TextField,
} from "@/components/gates/controls";

export function Memory() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [boards, roles, agents, tasks] = await Promise.all([
      api<BoardsResponse>("/api/boards", { signal }),
      api<{ roles: CrewRole[] }>("/api/roles", { signal }),
      api<{ agents: CrewAgent[] }>("/api/agents", { signal }),
      api<{ tasks: CrewTask[] }>("/api/tasks", { signal }),
    ]);
    return { ...boards, ...roles, ...agents, ...tasks };
  }, []);
  const { data, error, loading, refresh } = useResource(load);
  const [workspace, setWorkspace] = useState("");
  const selected = workspace || data?.boards[0]?.workspaceId || "";
  const workspaces = [
    ...new Map(
      data?.boards.map((b) => [
        b.workspaceId,
        { id: b.workspaceId, name: b.workspace.name },
      ]) ?? [],
    ).values(),
  ];
  const roleOptions =
    data?.roles.filter(
      (role) =>
        role.isBuiltin ||
        role.id === `configured-${selected}-${role.name}` ||
        data.agents.some(
          (a) => a.workspaceId === selected && a.roleId === role.id,
        ),
    ) ?? [];
  const boardIds = new Set(
    data?.boards.filter((b) => b.workspaceId === selected).map((b) => b.id),
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Memory</h1>
        <Button variant="outline" onClick={refresh}>
          Refresh workspaces
        </Button>
      </div>
      <ErrorNotice message={error} />
      {loading && <Notice>Loading memory scopes…</Notice>}
      {data &&
        (workspaces.length ? (
          <>
            <Choice
              label="Workspace"
              value={selected}
              options={workspaces}
              onChange={setWorkspace}
            />
            <MemoryLayers
              key={selected}
              workspaceId={selected}
              roles={roleOptions}
              tasks={data.tasks.filter((t) => boardIds.has(t.boardId))}
            />
          </>
        ) : (
          <Notice>
            No workspaces. Run <code>crew init</code> in your project.
          </Notice>
        ))}
    </div>
  );
}
function MemoryLayers({
  workspaceId,
  roles,
  tasks,
}: {
  workspaceId: string;
  roles: CrewRole[];
  tasks: CrewTask[];
}) {
  const [layer, setLayer] = useState<MemoryLayer>("project");
  const [roleId, setRoleId] = useState("all"),
    [taskId, setTaskId] = useState("all");
  const [editor, setEditor] = useState<MemoryEntry | "new">();
  const [deleting, setDeleting] = useState<MemoryEntry>();
  const [actionError, setActionError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const guard = useRef(submissionGuard());
  const load = useCallback(
    (signal: AbortSignal) =>
      api<{ entries: MemoryEntry[] }>(
        `/api/memory?workspaceId=${encodeURIComponent(workspaceId)}`,
        { signal },
      ),
    [workspaceId],
  );
  const { data, error, loading, refresh } = useResource(load);
  const entries =
    data?.entries.filter(
      (e) =>
        e.layer === layer &&
        (layer !== "role" || roleId === "all" || e.roleId === roleId) &&
        (layer !== "task" || taskId === "all" || e.taskId === taskId),
    ) ?? [];
  async function mutate(entry: MemoryEntry, method: "PATCH" | "DELETE") {
    if (!guard.current.enter()) return;
    setBusy(true);
    setActionError("");
    setNotice("");
    try {
      await api(`/api/memory/${encodeURIComponent(entry.id)}`, {
        method,
        ...(method === "PATCH"
          ? { body: JSON.stringify({ promote: true }) }
          : {}),
      });
      setDeleting(undefined);
      setNotice(
        method === "PATCH"
          ? "Promoted to project memory. The original role learning is retained."
          : "Memory deleted.",
      );
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      refresh();
    } finally {
      guard.current.leave();
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <Tabs
        value={layer}
        onValueChange={(value) => {
          setLayer(value as MemoryLayer);
          setActionError("");
        }}
      >
        <TabsList aria-label="Memory layer">
          {(["project", "role", "task"] as const).map((value) => (
            <TabsTrigger key={value} value={value}>
              {value[0].toUpperCase() + value.slice(1)}
            </TabsTrigger>
          ))}
        </TabsList>
        {(["project", "role", "task"] as const).map((value) => (
          <TabsContent key={value} value={value}>
            <p className="text-sm text-muted-foreground">
              {value === "project"
                ? "Workspace knowledge, including approved specs and promoted learnings."
                : value === "role"
                  ? "Role learnings. An unpromoted learning can be copied to project memory."
                  : "Context tied to one task in this workspace."}
            </p>
          </TabsContent>
        ))}
      </Tabs>
      <div className="flex flex-wrap items-end gap-3">
        {layer === "role" && (
          <Choice
            label="Filter role"
            value={roleId}
            onChange={setRoleId}
            options={[{ id: "all", name: "All roles" }, ...roles]}
          />
        )}
        {layer === "task" && (
          <Choice
            label="Filter task"
            value={taskId}
            onChange={setTaskId}
            options={[
              { id: "all", name: "All tasks" },
              ...tasks.map((t) => ({ id: t.id, name: `${t.title} · ${t.id}` })),
            ]}
          />
        )}
        <Button
          onClick={() => {
            setActionError("");
            setEditor("new");
          }}
        >
          Add memory
        </Button>
        <Button variant="outline" onClick={refresh}>
          Refresh memory
        </Button>
      </div>
      <ErrorNotice message={error || actionError} />
      {notice && <Notice>{notice}</Notice>}
      {loading && <Notice>Loading memory…</Notice>}
      {!loading && !entries.length && (
        <Notice>No {layer} memory in this scope.</Notice>
      )}
      {entries.map((entry) => (
        <Card key={entry.id}>
          <CardHeader>
            <CardTitle>{entry.title}</CardTitle>
            <CardDescription>
              Source: {entry.source ?? "Unknown"} · {entry.createdAt}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap break-words">{entry.body}</p>
            <p className="text-sm text-muted-foreground">
              {entry.roleId
                ? `Role: ${roles.find((r) => r.id === entry.roleId)?.name ?? entry.roleId}`
                : entry.taskId
                  ? `Task: ${tasks.find((t) => t.id === entry.taskId)?.title ?? entry.taskId}`
                  : "Project scope"}{" "}
              · {entry.id}
            </p>
            {entry.promotedAt && (
              <Badge variant="outline">Promoted {entry.promotedAt}</Badge>
            )}
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setActionError("");
                  setEditor(entry);
                }}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setActionError("");
                  setDeleting(entry);
                }}
              >
                Delete
              </Button>
              {canPromote(entry) && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void mutate(entry, "PATCH")}
                >
                  Promote to project
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open) setEditor(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editor === "new" ? `Add ${layer} memory` : "Edit memory"}
            </DialogTitle>
            <DialogDescription>
              {editor === "new"
                ? "Created by you. Select the scope for this learning."
                : "Title and body can be edited. Source and scope stay attached to the original entry."}
            </DialogDescription>
          </DialogHeader>
          {editor && (
            <MemoryEditor
              key={editor === "new" ? `new-${layer}` : editor.id}
              entry={editor === "new" ? undefined : editor}
              workspaceId={workspaceId}
              layer={layer}
              roles={roles}
              tasks={tasks}
              initialRole={roleId === "all" ? "" : roleId}
              initialTask={taskId === "all" ? "" : taskId}
              onSaved={() => {
                setEditor(undefined);
                setNotice("Memory saved.");
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(undefined);
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Delete memory?</DialogTitle>
            <DialogDescription>
              Delete “{deleting?.title}”? This cannot be undone. A promoted
              copy, if any, is retained.
            </DialogDescription>
          </DialogHeader>
          <ErrorNotice message={actionError} />
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setDeleting(undefined)}
            >
              Keep memory
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (deleting) void mutate(deleting, "DELETE");
              }}
            >
              {busy ? "Deleting…" : "Confirm delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function MemoryEditor({
  entry,
  workspaceId,
  layer,
  roles,
  tasks,
  initialRole,
  initialTask,
  onSaved,
}: {
  entry?: MemoryEntry;
  workspaceId: string;
  layer: MemoryLayer;
  roles: CrewRole[];
  tasks: CrewTask[];
  initialRole: string;
  initialTask: string;
  onSaved: () => void;
}) {
  const original = { title: entry?.title ?? "", body: entry?.body ?? "" };
  const [values, setValues] = useState(original),
    [roleId, setRoleId] = useState(initialRole),
    [taskId, setTaskId] = useState(initialTask);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const guard = useRef(submissionGuard());
  const valid =
    !!values.title.trim() &&
    !!values.body.trim() &&
    (!!entry ||
      ((layer !== "role" || !!roleId) && (layer !== "task" || !!taskId)));
  async function save() {
    if (!valid || !guard.current.enter()) return;
    setBusy(true);
    setError("");
    try {
      const body = entry
        ? values
        : {
            ...values,
            workspaceId,
            layer,
            ...memoryScope(layer, roleId, taskId),
          };
      await api(
        `/api/memory${entry ? `/${encodeURIComponent(entry.id)}` : ""}`,
        { method: entry ? "PATCH" : "POST", body: JSON.stringify(body) },
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      guard.current.leave();
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      {!entry && layer === "role" && (
        <Choice
          label="Role"
          value={roleId}
          onChange={setRoleId}
          options={roles}
          disabled={busy}
        />
      )}
      {!entry && layer === "task" && (
        <Choice
          label="Task"
          value={taskId}
          onChange={setTaskId}
          options={tasks.map((t) => ({
            id: t.id,
            name: `${t.title} · ${t.id}`,
          }))}
          disabled={busy}
        />
      )}
      <TextField
        label="Title"
        value={values.title}
        onChange={(title) => setValues((old) => ({ ...old, title }))}
        disabled={busy}
      />
      <TextField
        label="Body"
        value={values.body}
        onChange={(body) => setValues((old) => ({ ...old, body }))}
        multiline
        disabled={busy}
      />
      <ErrorNotice message={error} />
      <Button
        disabled={busy || !valid || (!!entry && !hasEdits(original, values))}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save memory"}
      </Button>
    </div>
  );
}
