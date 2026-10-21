"use client";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { hasEdits, ticketFields, type TicketDraft } from "@/lib/gates-logic";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { TextField, ErrorNotice, Notice } from "./controls";

export function TicketCards({ tickets, blockers, boardId, disabled, refresh, onDirty }: {
  tickets: TicketDraft[]; blockers: TicketDraft[]; boardId: string; disabled: boolean;
  refresh: () => void; onDirty: (dirty: boolean) => void;
}) {
  const dirty = useRef(new Set<string>());
  function changed(id: string, value: boolean) {
    if (value) dirty.current.add(id); else dirty.current.delete(id);
    onDirty(dirty.current.size > 0);
  }
  return <div className="space-y-4">
    <Notice>Save each ticket before approving. Removing a ticket cancels it; remove its blocker references from dependent tickets too.</Notice>
    {tickets.map((ticket, index) => <TicketCard key={ticket.id} original={ticket} index={index + 1}
      choices={[...blockers, ...tickets]} disabled={disabled} refresh={refresh} onDirty={v => changed(ticket.id, v)} />)}
    <TicketCard key="new" index={0} boardId={boardId} choices={[...blockers, ...tickets]} disabled={disabled}
      refresh={refresh} onDirty={v => changed("new", v)} />
  </div>;
}
function TicketCard({ original, index, choices, disabled, refresh, onDirty, boardId }: {
  original?: TicketDraft; index: number; choices: TicketDraft[]; disabled: boolean;
  refresh: () => void; onDirty: (v: boolean) => void; boardId?: string;
}) {
  const blank: TicketDraft = { id: "", title: "", description: "", acceptanceCriteria: "", blockedByIds: [], role: "", assignee: "" };
  const [value, setValue] = useState(original ?? blank);
  const [saved, setSaved] = useState(original ?? blank);
  const [seen, setSeen] = useState(JSON.stringify(original));
  if (JSON.stringify(original) !== seen) {
    setSeen(JSON.stringify(original));
    if (!hasEdits(value, saved) && original) { setValue(original); setSaved(original); }
  }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const guard = useRef(false);
  const edited = hasEdits(value, saved);
  const blockerChoices = [...choices, ...value.blockedByIds.filter(id => !choices.some(t => t.id === id))
    .map(id => ({ id, title: `Unavailable blocker ${id}` }))];
  const label = index ? `Ticket ${index}` : "New ticket";
  function update(fields: Partial<TicketDraft>) {
    const next = { ...value, ...fields }; setValue(next); onDirty(hasEdits(next, saved)); setNotice("");
  }
  async function mutate(remove = false) {
    if (guard.current || disabled) return;
    guard.current = true; setBusy(true); setError(""); onDirty(true);
    try {
      if (remove) {
        await api(`/api/tasks/${encodeURIComponent(value.id)}/cancel`, { method: "POST" });
        setRemoved(true); setConfirm(false);
      } else {
        const fields = ticketFields(value);
        await api(original ? `/api/tasks/${encodeURIComponent(value.id)}` : "/api/tasks", {
          method: original ? "PATCH" : "POST", body: JSON.stringify(original ? fields : { ...fields, boardId, phase: "tickets" }),
        });
        const next = original ? value : blank;
        setSaved(next); setValue(next); setNotice(original ? "Ticket saved." : "Ticket added.");
      }
      onDirty(false); refresh();
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); onDirty(edited); }
    finally { guard.current = false; setBusy(false); }
  }
  if (removed) return <Notice>{label} removed.</Notice>;
  return <Card><CardHeader><CardTitle>{label}</CardTitle><CardDescription>{original?.id ?? "Add a work ticket at this gate"}</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      <ErrorNotice message={error} />{notice && <Notice>{notice}</Notice>}
      <TextField label={`${label} title`} value={value.title} onChange={v => update({ title: v })} disabled={busy || disabled} />
      <TextField label={`${label} description`} value={value.description} onChange={v => update({ description: v })} disabled={busy || disabled} multiline />
      <TextField label={`${label} acceptance criteria`} value={value.acceptanceCriteria} onChange={v => update({ acceptanceCriteria: v })} disabled={busy || disabled} multiline />
      <TextField label={`${label} role (ID or name)`} value={value.role ?? ""} onChange={v => update({ role: v })} disabled={busy || disabled} />
      <TextField label={`${label} assignee (optional ID or name)`} value={value.assignee ?? ""} onChange={v => update({ assignee: v })} disabled={busy || disabled} />
      <div className="space-y-2" role="group" aria-label={`${label} blockers`}><p className="text-sm font-medium">Blockers</p>
        {blockerChoices.filter(t => t.id !== value.id).map(t => <Label key={t.id} className="flex gap-2">
          <Switch aria-label={`${label} blocked by ${t.title}`} checked={value.blockedByIds.includes(t.id)} disabled={busy || disabled}
            onCheckedChange={checked => update({ blockedByIds: checked ? [...value.blockedByIds, t.id] : value.blockedByIds.filter(id => id !== t.id) })} />
          {t.title} · {t.id}</Label>)}
      </div>
      <div className="flex gap-2"><Button disabled={busy || disabled || !edited || !value.title.trim() || !value.role} onClick={() => void mutate()}>{original ? "Save ticket" : "Add ticket"}</Button>
        {edited && <Button variant="outline" disabled={busy || disabled} onClick={() => { setValue(saved); onDirty(false); }}>Discard ticket edits</Button>}
        {original && <Button variant="destructive" disabled={busy || disabled} onClick={() => setConfirm(true)}>Remove ticket</Button>}
      </div>
      <Dialog open={confirm} onOpenChange={setConfirm}><DialogContent><DialogHeader><DialogTitle>Remove ticket?</DialogTitle><DialogDescription>This cancels {value.title}. Dependent tickets must have this blocker removed before approval.</DialogDescription></DialogHeader><ErrorNotice message={error} /><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirm(false)}>Keep ticket</Button><Button variant="destructive" disabled={busy || disabled} onClick={() => void mutate(true)}>Confirm remove</Button></DialogFooter></DialogContent></Dialog>
    </CardContent></Card>;
}
