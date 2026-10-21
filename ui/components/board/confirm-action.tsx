'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
export function ConfirmAction({ label, description, onConfirm, destructive = false, disabled = false }: { label: string; description: string; onConfirm: () => Promise<void>; destructive?: boolean; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <Dialog open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(''); } }}>
    <DialogTrigger asChild><Button variant={destructive ? 'destructive' : 'outline'} disabled={disabled}>{label}</Button></DialogTrigger>
    <DialogContent><DialogHeader><DialogTitle>{label}?</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Go back</Button><Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await onConfirm(); setOpen(false); } catch (error) { setError(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
      }}>{busy ? 'Working…' : `Confirm ${label.toLowerCase()}`}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
