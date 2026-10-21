"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import type { BoardsResponse } from "@/lib/types";
import type {
  CrewTask,
  CrewMessage,
  PhaseSnapshot,
  TaskDetail,
} from "@/lib/gates-types";
import {
  hasEdits,
  submissionGuard,
  validateTickets,
  type TicketDraft,
} from "@/lib/gates-logic";
import { useResource } from "@/lib/gates-resource";
import { useBoardEvents } from "@/lib/sse";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Choice, ErrorNotice, Notice, TextField } from "./controls";
import { TicketCards } from "./ticket-cards";
import { MarkdownPreview } from "./markdown-preview";

export function PhaseScreen() {
  const router = useRouter();
  const query = useSearchParams();
  const boardId = query.get("board") ?? "";
  const load = useCallback(
    (signal: AbortSignal) => api<BoardsResponse>("/api/boards", { signal }),
    [],
  );
  const { data, error, refresh } = useResource(load);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Phase gates</h1>
      <ErrorNotice message={error} />
      <Choice
        label="Board"
        value={boardId}
        options={
          data?.boards.map((b) => ({
            id: b.id,
            name: `${b.workspace.name} · ${b.id}`,
          })) ?? []
        }
        onChange={(id) => {
          router.push(`/phase?board=${encodeURIComponent(id)}`);
        }}
      />
      {boardId ? (
        <BoardPhase key={boardId} boardId={boardId} />
      ) : (
        <Notice>
          Select a board to review its current phase.{" "}
          <Button variant="outline" onClick={refresh}>
            Refresh boards
          </Button>
        </Notice>
      )}
    </div>
  );
}
function BoardPhase({ boardId }: { boardId: string }) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const state = await api<PhaseSnapshot>(
        `/api/boards/${encodeURIComponent(boardId)}/phase`,
        { signal },
      );
      const { tasks } = await api<{ tasks: CrewTask[] }>("/api/tasks", {
        signal,
      });
      const boardTasks = tasks.filter((t) => t.boardId === boardId);
      const tickets: TicketDraft[] = [];
      const blockers: TicketDraft[] = [];
      const feedback: CrewMessage[] = [];
      for (const task of boardTasks.filter(
        (t) =>
          t.kind === "phase" ||
          (state.board.currentPhase === "tickets" && t.kind === "work"),
      )) {
        const detail = await api<TaskDetail>(
          `/api/tasks/${encodeURIComponent(task.id)}`,
          { signal },
        );
        if (task.kind === "phase")
          feedback.push(
            ...detail.messages.filter((message) => message.type === "feedback"),
          );
        else if (detail.task.status !== "cancelled") {
          const target =
            detail.task.creationPhase === state.board.currentPhase &&
            detail.task.status !== "merged"
              ? tickets
              : blockers;
          if (target === blockers && detail.task.status === "escalated")
            continue;
          target.push({
            id: task.id,
            role: detail.task.roleId ?? "",
            assignee: detail.task.assigneeAgentId ?? "",
            title: detail.task.title,
            description: detail.task.description,
            acceptanceCriteria: detail.task.acceptanceCriteria,
            blockedByIds: detail.dependencies.map(
              (edge) => edge.blockedByTaskId,
            ),
          });
        }
      }
      return { state, tickets, blockers, feedback };
    },
    [boardId],
  );
  const { data, error, loading, refresh } = useResource(load);
  const connection = useBoardEvents(boardId, refresh);
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Badge variant="secondary">
          {data?.state.board.currentPhase ?? "Loading phase"}
        </Badge>
        <Badge variant="outline">{connection}</Badge>
        <Button variant="outline" onClick={refresh}>
          Refresh phase
        </Button>
      </div>
      <ErrorNotice message={error || actionError} />
      {notice && <Notice>{notice}</Notice>}
      {loading && <Notice>Loading phase…</Notice>}
      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{data.state.workspace.name}</CardTitle>
              <CardDescription>{data.state.instructions}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.state.problem && <Notice>{data.state.problem}</Notice>}
              {data.state.task && (
                <p>
                  Phase task: {data.state.task.title} · {data.state.task.status}
                </p>
              )}
              {data.state.task &&
                ["escalated", "cancelled"].includes(data.state.task.status) && (
                  <Notice>
                    Phase run needs recovery. Run{" "}
                    <code>crew retry {data.state.task.id}</code> in your
                    terminal, then refresh.
                  </Notice>
                )}
              {!data.state.draft && (
                <Notice>
                  No draft is awaiting approval. This phase is read-only until a
                  new gate is ready.
                </Notice>
              )}
            </CardContent>
          </Card>
          {data.state.draft && (
            <GateEditor
              key={data.state.draft.id}
              state={data.state}
              tickets={data.tickets}
              blockers={data.blockers}
              refresh={refresh}
              onError={setActionError}
              onSuccess={setNotice}
            />
          )}
          <Card>
            <CardHeader>
              <CardTitle>Rejection notes and phase feedback</CardTitle>
              <CardDescription>
                Notes preserved on phase tasks, including prior attempts.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.feedback.length ? (
                data.feedback.map((message) => (
                  <div key={message.id} className="space-y-1 border-b pb-3">
                    <p className="whitespace-pre-wrap">{message.body}</p>
                    <p className="text-xs text-muted-foreground">
                      {message.taskId} · {message.createdAt}
                    </p>
                  </div>
                ))
              ) : (
                <p>No rejection notes or feedback.</p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
function GateEditor({
  state,
  tickets: originalTickets,
  blockers,
  refresh,
  onError,
  onSuccess,
}: {
  state: PhaseSnapshot;
  tickets: TicketDraft[];
  blockers: TicketDraft[];
  refresh: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const draft = state.draft!;
  const [text, setText] = useState(draft.body);
  const tickets = originalTickets;
  const [ticketChanges, setTicketChanges] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [decided, setDecided] = useState(false);
  const guard = useRef(submissionGuard());
  const ticketPhase = state.board.currentPhase === "tickets";

  const changed = hasEdits(draft.body, text);
  const validation = ticketPhase
    ? validateTickets(tickets, {
        blockers,
        limit: state.workspace.config?.maxTicketsPerPhase,
      })
    : [];
  async function decide(mode: "approve" | "edit" | "reject") {
    if (mode === "reject" && !note.trim()) {
      onError("A rejection note is required.");
      return;
    }
    if (mode !== "reject" && validation.length) {
      onError(validation.join("\n"));
      return;
    }
    if (mode !== "reject" && ticketChanges) {
      onError(
        "Save or discard ticket edits before approving.",
      );
      return;
    }
    if (mode === "edit" && (!changed || !text.trim())) return;
    if (decided || !guard.current.enter()) return;
    setBusy(true);
    onError("");
    onSuccess("");
    try {
      await api(
        `/api/boards/${encodeURIComponent(state.board.id)}/phase/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            draftId: draft.id,
            ...(mode === "edit" ? { edit: text } : {}),
            ...(mode === "reject" ? { reject: true, note } : {}),
          }),
        },
      );
      setDecided(true);
      onSuccess(
        mode === "reject"
          ? "Draft rejected. Your note is on the next phase attempt."
          : "Draft approved.",
      );
      refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      if (err instanceof ApiError && [400, 404, 409, 422].includes(err.status))
        refresh();
    } finally {
      guard.current.leave();
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review {draft.phase} draft</CardTitle>
        <CardDescription>
          Draft {draft.id}. Approval applies to this exact draft; stale
          decisions are rejected by the server.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <TextField
          label="Draft output (markdown)"
          value={text}
          onChange={setText}
          multiline
          disabled={busy || decided}
        />
        <MarkdownPreview text={text} />
        {ticketPhase && (
          <>
            <TicketCards tickets={tickets} blockers={blockers} boardId={state.board.id}
              disabled={busy || decided} refresh={refresh} onDirty={setTicketChanges} />
            <ErrorNotice message={validation.join("\n")} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              busy || decided || changed || ticketChanges || !!validation.length
            }
            onClick={() => void decide("approve")}
          >
            Approve
          </Button>
          <Button
            variant="secondary"
            disabled={
              busy ||
              decided ||
              !changed ||
              !text.trim() ||
              ticketChanges ||
              !!validation.length
            }
            onClick={() => void decide("edit")}
          >
            Approve with edits
          </Button>
          {changed && (
            <Button
              variant="outline"
              disabled={busy || decided}
              onClick={() => setText(draft.body)}
            >
              Discard output edits
            </Button>
          )}
        </div>
        <TextField
          label="Rejection note (required to reject)"
          value={note}
          onChange={setNote}
          multiline
          disabled={busy || decided}
        />
        <Button
          variant="destructive"
          disabled={busy || decided || !note.trim()}
          onClick={() => void decide("reject")}
        >
          {busy ? "Submitting…" : "Reject draft"}
        </Button>
      </CardContent>
    </Card>
  );
}
