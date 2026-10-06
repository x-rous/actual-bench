"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import type { UnscheduledPayment } from "@/lib/assets-debt/services/extraPaymentService";
import { recordExtraPayment, removeExtraPayment } from "../../lib/debtsApi";
import { formatAmount } from "../../lib/money";

/**
 * Payments into the loan account that are not scheduled repayments (owner decision 2026-10-05).
 * Each can be recorded as an extra payment: the Actual transaction is linked to the loan and the
 * extra payment is added to Terms & Schedule with its own date and amount (a new revision), after a
 * confirmation. Recorded ones say whether Terms & Schedule still has them, and when the transaction
 * was changed in Actual after it was recorded, offer to move the extra payment to match. Nothing is
 * written to Actual.
 */

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export function ExtraPayments({ debtId, payments, digits, scheduleDirty, onChanged }: { debtId: string; payments: UnscheduledPayment[]; digits: number; /** Unsaved changes on Terms & Schedule: recording would overwrite them, so it waits. */ scheduleDirty: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
    onChanged();
  };
  const record = useMutation({
    mutationFn: (p: UnscheduledPayment) => recordExtraPayment(debtId, { actualTransactionId: p.id, date: p.date, amountMinor: p.amountMinor }),
    onSuccess: (_detail, p) => { toast.success(p.changed ? "Terms & Schedule now has the extra payment as it is in Actual" : "Recorded as an extra payment in Terms & Schedule"); done(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const remove = useMutation({
    mutationFn: (p: UnscheduledPayment) => removeExtraPayment(debtId, p.id),
    onSuccess: () => { toast.success("Extra payment removed from Terms & Schedule"); done(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  if (!payments.length) return null;
  const money = (minor: number) => formatAmount(minor, digits);
  const askRecord = (p: UnscheduledPayment) => setConfirm({
    title: "Record as an extra payment?",
    message: `Terms & Schedule gets a one-off extra payment of ${money(p.amountMinor)} on ${shortDay(p.date)}, and this transaction is linked to the loan so it is never taken for a scheduled repayment. The loan is saved as a new revision. Nothing in Actual changes.`,
    destructiveLabel: "Record extra payment",
    destructive: false,
    onConfirm: () => record.mutate(p),
  });
  const askRemove = (p: UnscheduledPayment) => setConfirm({
    title: "Remove this extra payment?",
    message: `The link to this transaction is removed, and the extra payment of ${money(p.amountMinor)} on ${shortDay(p.date)} is taken out of Terms & Schedule (a new revision). Nothing in Actual changes.`,
    destructiveLabel: "Remove",
    onConfirm: () => remove.mutate(p),
  });
  const askUpdate = (p: UnscheduledPayment) => setConfirm({
    title: "Update the extra payment?",
    message: `Terms & Schedule has this extra payment as ${money(p.recordedAs!.amountMinor)} on ${shortDay(p.recordedAs!.date)}. It is changed to ${money(p.amountMinor)} on ${shortDay(p.date)}, as the transaction is now in Actual. The loan is saved as a new revision. Nothing in Actual changes.`,
    destructiveLabel: "Update Terms & Schedule",
    destructive: false,
    onConfirm: () => record.mutate(p),
  });
  const busy = record.isPending || remove.isPending;
  return (
    <section aria-labelledby="extra-payments" className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <h2 id="extra-payments" className="text-sm font-semibold">Payments not in the schedule</h2>
        <p className="text-xs text-muted-foreground">Money paid into, or taken out of, the loan account that the schedule does not explain, such as an extra payment.</p>
      </div>
      <ul className="flex flex-col divide-y divide-border/60">
        {payments.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-xs">
            <span className="w-20 tabular-nums">{shortDay(p.date)}</span>
            <span className="w-28 text-right font-semibold tabular-nums">{p.direction === "out" ? `-${money(p.amountMinor)}` : money(p.amountMinor)}</span>
            <span className="min-w-40 flex-1 truncate text-muted-foreground">{[p.payeeName, p.notes].filter(Boolean).join(" · ")}</span>
            {p.direction === "out" ? (
              <span className="text-amber-700 dark:text-amber-300">Taken out of the loan account: this adds to what you owe. If it is a transfer entered the wrong way round, fix it in Actual.</span>
            ) : !p.recorded ? (
              <Button type="button" size="sm" className="h-7" disabled={busy || scheduleDirty} title={scheduleDirty ? "Save or discard your changes on Terms & Schedule first" : undefined} onClick={() => askRecord(p)}>Record as extra payment</Button>
            ) : p.changed ? (
              <>
                <span className="text-amber-700 dark:text-amber-300">Changed in Actual. Terms & Schedule still has {money(p.recordedAs!.amountMinor)} on {shortDay(p.recordedAs!.date)}</span>
                <Button type="button" size="sm" className="h-7" disabled={busy || scheduleDirty} title={scheduleDirty ? "Save or discard your changes on Terms & Schedule first" : undefined} onClick={() => askUpdate(p)}>Update Terms & Schedule</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy || scheduleDirty} onClick={() => askRemove(p)}>Remove</Button>
              </>
            ) : p.inSchedule ? (
              <>
                <span className="text-emerald-700 dark:text-emerald-300">✓ Extra payment in Terms & Schedule</span>
                <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy || scheduleDirty} onClick={() => askRemove(p)}>Remove</Button>
              </>
            ) : (
              <>
                <span className="text-amber-700 dark:text-amber-300">Recorded, but Terms & Schedule has no extra payment with this date and amount</span>
                <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy || scheduleDirty} onClick={() => record.mutate(p)}>Add it again</Button>
                <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy || scheduleDirty} onClick={() => askRemove(p)}>Remove</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </section>
  );
}
