"use client";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CrewAgent, CrewRole, TeamStatus } from "@/lib/team-types";
import type { CrewTask } from "@/lib/gates-types";
import { useResource } from "@/lib/gates-resource";
import { submissionGuard, hasEdits } from "@/lib/gates-logic";
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
import {
  Choice,
  ErrorNotice,
  Notice,
  TextField,
} from "@/components/gates/controls";

export function Team() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [agents, roles, status, tasks] = await Promise.all([
      api<{ agents: CrewAgent[] }>("/api/agents", { signal }),
      api<{ roles: CrewRole[] }>("/api/roles", { signal }),
      api<TeamStatus>("/api/status", { signal }),
      api<{ tasks: CrewTask[] }>("/api/tasks", { signal }),
    ]);
    return { ...agents, ...roles, status, ...tasks };
  }, []);
  const { data, error, loading, refresh } = useResource(load);
  const [workspace, setWorkspace] = useState("all");
  const [editing, setEditing] = useState<CrewAgent>();
  const agents =
    data?.agents.filter(
      (a) => workspace === "all" || a.workspaceId === workspace,
    ) ?? [];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Team</h1>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
        {data?.status.stopped && (
          <Badge variant="secondary">Dispatch stopped</Badge>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Server status and live runs. Refreshes every 15 seconds. Persona changes
        apply to future runs.
      </p>
      <ErrorNotice message={error} />
      {loading && <Notice>Loading team…</Notice>}
      {data && (
        <>
          <Choice
            label="Workspace"
            value={workspace}
            onChange={setWorkspace}
            options={[
              { id: "all", name: "All workspaces" },
              ...[...new Set(data.agents.map((a) => a.workspaceId))].map(
                (id) => ({ id, name: id }),
              ),
            ]}
          />
          {!agents.length && (
            <Notice>
              No agents in this workspace. Run <code>crew init</code> to staff
              the team.
            </Notice>
          )}
          <div className="grid gap-4 lg:grid-cols-2">
            {agents.map((agent) => {
              const runs = data.status.liveRuns.filter(
                (run) => run.agentId === agent.id,
              );
              const status =
                data.status.agents.find((item) => item.id === agent.id)
                  ?.status ?? agent.status;
              const limited = data.status.rateLimits.some(
                (limit) => limit.cliType === agent.cliType,
              );
              return (
                <Card key={agent.id}>
                  <CardHeader>
                    <CardTitle>{agent.name}</CardTitle>
                    <CardDescription>
                      {data.roles.find((role) => role.id === agent.roleId)
                        ?.name ?? agent.roleId}{" "}
                      · {agent.cliType} · {agent.mode}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="secondary">{status}</Badge>
                      {runs.length > 0 && (
                        <Badge variant="outline">running</Badge>
                      )}
                      {limited && status !== "rate-limited" && (
                        <Badge variant="outline">rate-limited</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {agent.id} · {agent.workspaceId}
                    </p>
                    {runs.length ? (
                      runs.map((run) => (
                        <p key={run.id}>
                          Current task:{" "}
                          {data.tasks.find((task) => task.id === run.taskId)
                            ?.title ?? run.taskId}{" "}
                          <span className="text-sm text-muted-foreground">
                            ({run.taskId})
                          </span>
                        </p>
                      ))
                    ) : (
                      <p>No live task.</p>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Last heartbeat: {agent.lastHeartbeatAt ?? "Not reported"}
                    </p>
                    <Button variant="outline" onClick={() => setEditing(agent)}>
                      Edit persona
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Edit persona</DialogTitle>
            <DialogDescription>
              Name, system prompt and personality. Active runs retain their
              current prompt.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <PersonaEditor
              key={editing.id}
              agent={editing}
              onSaved={() => {
                setEditing(undefined);
                refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function PersonaEditor({
  agent,
  onSaved,
}: {
  agent: CrewAgent;
  onSaved: () => void;
}) {
  const original = {
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    personality: agent.personality,
  };
  const [values, setValues] = useState(original),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const guard = useRef(submissionGuard());
  async function save() {
    if (
      !values.name.trim() ||
      !hasEdits(original, values) ||
      !guard.current.enter()
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/agents/${encodeURIComponent(agent.id)}`, {
        method: "PATCH",
        body: JSON.stringify(values),
      });
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
      {(["name", "systemPrompt", "personality"] as const).map((field) => (
        <TextField
          key={field}
          label={
            {
              name: "Name",
              systemPrompt: "System prompt",
              personality: "Personality",
            }[field]
          }
          value={values[field]}
          onChange={(value) => setValues((old) => ({ ...old, [field]: value }))}
          multiline={field !== "name"}
          disabled={busy}
          error={
            field === "name" && !values.name.trim()
              ? "Name must be nonblank."
              : error.toLowerCase().includes(field.toLowerCase())
                ? error
                : undefined
          }
        />
      ))}
      <ErrorNotice message={error} />
      <Button
        disabled={busy || !values.name.trim() || !hasEdits(original, values)}
        onClick={() => void save()}
      >
        {busy ? "Saving…" : "Save persona"}
      </Button>
    </div>
  );
}
