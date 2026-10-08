"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmState } from "@/components/ui/confirm-dialog";
import type { UnscheduledPayment } from "@/lib/assets-debt/services/extraPaymentService";
import { recordExtraPayment, removeExtraPayment } from "../../lib/debtsApi";
import { formatAmount } from "../../lib/money";

/** New extras require confirmation; confirmed entries follow Actual with a new revision. */

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export function ExtraPayments({ debtId, payments, digits, scheduleDirty, readOnly = false, onChanged }: { debtId: string; payments: UnscheduledPayment[]; digits: number; /** Unsaved changes on Terms & Schedule: recording would overwrite them, so it waits. */ scheduleDirty: boolean; readOnly?: boolean; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debt", debtId] });
    void queryClient.invalidateQueries({ queryKey: ["assets-debt", "debts"] });
    onChanged();
  };
  const record = useMutation({
    mutationFn: (p: UnscheduledPayment) => {
      if (readOnly || scheduleDirty) throw new Error("Finish the current operation and save or discard terms edits first.");
      return recordExtraPayment(debtId, { actualTransactionId: p.id, date: p.date, amountMinor: p.amountMinor });
    },
    onSuccess: () => { toast.success("Counted as an extra payment in Terms & Schedule"); done(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  const remove = useMutation({
    mutationFn: (p: UnscheduledPayment) => {
      if (readOnly || (p.recorded && scheduleDirty)) throw new Error("Finish the current operation and save or discard terms edits first.");
      return removeExtraPayment(debtId, p.id, p.date);
    },
    onSuccess: () => { toast.success("Not counted as an extra payment"); done(); },
    onError: (error) => toast.error(error instanceof Error ? error.message : String(error)),
  });
  if (!payments.length) return null;
  const money = (minor: number) => formatAmount(minor, digits);
  const askRemove = (p: UnscheduledPayment) => setConfirm({
    title: "Not an extra payment?",
    message: `${money(p.amountMinor)} on ${shortDay(p.date)} stops counting as an extra payment${p.recorded ? " and is taken out of Terms & Schedule (a new revision)" : ""}, and Bench will not count it again on its own. Nothing in Actual changes.`,
    destructiveLabel: "Not an extra payment",
    onConfirm: () => remove.mutate(p),
  });
  const askRecord = (p: UnscheduledPayment) => setConfirm({
    title: "Record this extra payment?",
    message: `Count ${money(p.amountMinor)} on ${shortDay(p.date)} as an extra principal repayment? This saves a new loan revision and updates the forecast. Nothing in Actual changes.`,
    destructive: false, destructiveLabel: "Record extra payment", onConfirm: () => record.mutate(p),
  });
  const busy = readOnly || record.isPending || remove.isPending;
  const saveFirst = scheduleDirty ? "Save or discard your changes on Terms & Schedule first" : undefined;
  // Waiting for Terms & Schedule: a new one not recorded yet, or one changed in Actual not followed yet.
  const pendingNote = scheduleDirty ? "Save or discard your edits before recording this payment." : "Confirm this payment to include it in the forecast.";
  const chip = (tone: "ok" | "muted" | "warn", text: string, title?: string) => (
    <span title={title} className={tone === "ok" ? "rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : tone === "warn" ? "rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"}>{text}</span>
  );
  return (
    <section aria-labelledby="extra-payments" className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="extra-payments" className="text-sm font-semibold" title="Money paid into, or taken out of, the loan account that the schedule does not explain, such as an extra payment.">Payments not in the schedule</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{payments.length}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr className="border-b border-border"><th scope="col" className="py-1.5 pr-3 font-normal">Date</th><th scope="col" className="py-1.5 pr-3 font-normal">From</th><th scope="col" className="py-1.5 pr-3 text-right font-normal">Amount</th><th scope="col" className="py-1.5 pr-3 font-normal">Status</th><th scope="col" className="py-1.5 font-normal"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {payments.map((p) => {
              const notCounted = p.dismissed || (p.recorded && !p.inSchedule && !p.changed);
              return (
                <tr key={p.id} className="border-b border-border/60 last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{shortDay(p.date)}</td>
                  <td className="max-w-80 truncate py-2 pr-3 text-muted-foreground">{[p.payeeName, p.notes].filter(Boolean).join(" · ")}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold tabular-nums">{p.direction === "out" ? `-${money(p.amountMinor)}` : money(p.amountMinor)}</td>
                  <td className="py-2 pr-3">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {p.direction === "out"
                        ? chip("warn", "Taken out", "Taken out of the loan account: this adds to what you owe. If it is a transfer entered the wrong way round, fix it in Actual.")
                        : p.paysOff
                          ? chip("warn", "Pays the loan off", "At least what the loan owed that day, so it pays the loan off rather than being an extra payment. It is not the full payoff (the principal plus the interest to that day); check the amount in Actual.")
                          : notCounted
                            ? chip("muted", p.dismissed ? "Not counted" : "Not counted: taken out of Terms & Schedule")
                            : chip(p.recorded ? "ok" : "muted", p.recorded ? "Extra payment" : "Needs confirmation")}
                      {!notCounted && p.direction !== "out" && !p.paysOff && (!p.recorded || p.changed) ? <span className="text-[11px] text-muted-foreground">{p.changed ? `Changed in Actual. ${pendingNote}` : pendingNote}</span> : null}
                    </span>
                  </td>
                  <td className="py-2 text-right">
                    {p.direction === "out" || p.paysOff ? null : notCounted ? (
                      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy || scheduleDirty} title={saveFirst} onClick={() => askRecord(p)}>Count it</Button>
                    ) : !p.recorded ? (
                      <div className="flex justify-end gap-1"><Button type="button" size="sm" variant="outline" className="h-7" disabled={busy || scheduleDirty} title={saveFirst} onClick={() => askRecord(p)}>Record extra payment</Button><Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy} onClick={() => askRemove(p)}>Not an extra payment</Button></div>
                    ) : (
                      <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busy || (p.recorded && scheduleDirty)} title={p.recorded ? saveFirst : undefined} onClick={() => askRemove(p)}>Not an extra payment</Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)} state={confirm} />
    </section>
  );
}
