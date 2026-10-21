"use client";
import { useCallback, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { CrewTask, TaskDetail, CrewMessage } from "@/lib/gates-types";
import { useResource } from "@/lib/gates-resource";
import { openQuestion } from "@/lib/inbox-logic";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorNotice, Notice, TextField } from "@/components/gates/controls";

type Question = { task: CrewTask; question: CrewMessage; agentName: string };
export function Inbox() {
  const load = useCallback(async (signal: AbortSignal) => {
    const { tasks } = await api<{ tasks: CrewTask[] }>("/api/tasks", {
      signal,
    });
    const { agents } = await api<{ agents: { id: string; name: string }[] }>(
      "/api/agents",
      { signal },
    );
    const items: Question[] = [];
    // Sequential detail reads keep connection capacity available for other tabs/SSE.
    for (const task of tasks.filter((task) => task.status === "blocked")) {
      const detail = await api<TaskDetail>(
        `/api/tasks/${encodeURIComponent(task.id)}`,
        { signal },
      );
      const question = openQuestion(detail.task.status, detail.messages);
      if (question)
        items.push({
          task: { ...task, ...detail.task },
          question,
          agentName:
            agents.find((agent) => agent.id === question.fromAgentId)?.name ??
            question.fromAgentId ??
            task.assigneeAgentName ??
            "Unassigned agent",
        });
    }
    return items;
  }, []);
  const { data, error, loading, refresh } = useResource(load);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <Badge variant="secondary">
          {data?.filter((item) => !hidden[item.question.id]).length ?? 0} open
        </Badge>
        <Button variant="outline" onClick={refresh}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Agent questions waiting for you. Refreshes every 15 seconds.
      </p>
      <ErrorNotice message={error} />
      {loading && <Notice>Loading questions…</Notice>}
      {data?.filter((item) => !hidden[item.question.id]).length === 0 && (
        <Notice>No open questions.</Notice>
      )}
      {data?.map((item) => (
        <QuestionCard
          key={item.question.id}
          item={item}
          hidden={!!hidden[item.question.id]}
          hide={(value) =>
            setHidden((old) => ({ ...old, [item.question.id]: value }))
          }
          refresh={refresh}
        />
      ))}
    </div>
  );
}
function QuestionCard({
  item,
  hidden,
  hide,
  refresh,
}: {
  item: Question;
  hidden: boolean;
  hide: (value: boolean) => void;
  refresh: () => void;
}) {
  const [answer, setAnswer] = useState(""),
    [error, setError] = useState("");
  const busy = useRef(false);
  async function submit() {
    if (busy.current || !answer.trim()) return;
    busy.current = true;
    setError("");
    hide(true);
    try {
      await api(`/api/tasks/${encodeURIComponent(item.task.id)}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer }),
      });
      refresh();
    } catch (err) {
      hide(false);
      setError(err instanceof Error ? err.message : String(err));
      refresh();
    } finally {
      busy.current = false;
    }
  }
  return hidden ? null : (
    <Card>
      <CardHeader>
        <CardTitle>{item.task.title}</CardTitle>
        <CardDescription>
          {item.task.id} · {item.agentName}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="whitespace-pre-wrap">{item.question.body}</p>
        <TextField
          label="Answer"
          value={answer}
          onChange={setAnswer}
          multiline
        />
        <ErrorNotice message={error} />
        <Button onClick={() => void submit()} disabled={!answer.trim()}>
          Send answer
        </Button>
      </CardContent>
    </Card>
  );
}
