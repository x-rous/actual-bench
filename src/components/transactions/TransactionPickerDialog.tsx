"use client";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { money, TransactionPickerPanel, type TransactionPickerPanelProps } from "./TransactionPickerPanel";
import type { PickedTransaction } from "./transactionPickerQuery";

export type { PickerColumn, PickerFilterKey } from "./TransactionPickerPanel";
export type TransactionPickerProps = Omit<TransactionPickerPanelProps, "onSelectionChange"> & {
  title: string; description?: ReactNode;
  confirmLabel: string;
  /** Extra control beside the selection summary, for example a "Link as" select. */
  footerSlot?: ReactNode | ((picked: PickedTransaction[]) => ReactNode);
  confirmDisabled?: boolean;
  onClose: () => void;
  /** Resolve to close; throw to keep the dialog open with the message shown. */
  onConfirm: (rows: PickedTransaction[]) => Promise<void> | void;
};

/** The generic transaction picker in a dialog: the panel, a selection summary and Cancel / confirm. */
export function TransactionPickerDialog({ title, description, confirmLabel, footerSlot, confirmDisabled, onClose, onConfirm, ...panel }: TransactionPickerProps) {
  const [picked, setPicked] = useState<PickedTransaction[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const total = picked.reduce((s, r) => s + r.amountMinor, 0);
  async function confirm() {
    setBusy(true); setError("");
    try { await onConfirm(picked); onClose(); } catch (e) { setError(e instanceof Error ? e.message : "Selection failed"); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="flex h-[min(56rem,94dvh)] flex-col gap-3 overflow-hidden sm:max-w-[min(94vw,90rem)]">
    <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description ?? "Select whole existing Actual transactions. Their category, payee, amount, Notes and date are never changed."}</DialogDescription></DialogHeader>
    <TransactionPickerPanel {...panel} onSelectionChange={setPicked} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter className="items-center gap-3 sm:justify-between"><div className="flex min-w-0 flex-wrap items-center gap-3"><span role="status" className="text-xs">{picked.length} selected{picked.length > 0 && <> · total <span className="font-medium tabular-nums">{money(total)}</span></>}</span>{typeof footerSlot === "function" ? footerSlot(picked) : footerSlot}</div>
      <div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || confirmDisabled || picked.length === 0} onClick={() => void confirm()}>{busy ? "Working…" : confirmLabel}</Button></div></DialogFooter>
  </DialogContent></Dialog>;
}
