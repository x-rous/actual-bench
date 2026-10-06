"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PaymentOption } from "@/lib/assets-debt/services/proposalService";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../lib/money";

/**
 * "This is the payment" (owner decision 2026-10-07): the user names which of the loan's payments is
 * a due date's repayment. The loan's payments are listed nearest the due date first, each saying
 * which due date it is paired with now. Bench keeps the choice and lines everything else up around
 * it; nothing in Actual changes until a change is applied.
 */

const shortDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const distance = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`));

export function ChoosePayment({ dueDate, options, chosenId, digits, busy, onChoose, onClear, onClose }: {
  dueDate: string | null;
  options: PaymentOption[];
  /** The payment already chosen for this due date, if any. */
  chosenId: string | null;
  digits: number;
  busy: boolean;
  onChoose: (paymentId: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const sorted = dueDate ? [...options].sort((a, b) => distance(a.date, dueDate) - distance(b.date, dueDate)).slice(0, 12) : [];
  const current = picked ?? chosenId ?? sorted.find((o) => o.pairedTo === dueDate)?.id ?? null;
  return (
    <Dialog open={dueDate !== null} onOpenChange={(open) => { if (!open) { setPicked(null); onClose(); } }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Which payment is the repayment due {dueDate ? shortDay(dueDate) : ""}?</DialogTitle>
          <DialogDescription>Bench keeps your choice and lines the other payments up around it. Nothing in Actual changes until you apply the change it proposes.</DialogDescription>
        </DialogHeader>
        {sorted.length ? (
          <ul role="radiogroup" aria-label="Payments" className="flex flex-col divide-y divide-border/60 rounded border border-border">
            {sorted.map((o) => {
              const on = current === o.id;
              return (
                <li key={o.id}>
                  <button type="button" role="radio" aria-checked={on} onClick={() => setPicked(o.id)} className={cn("flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-left text-xs hover:bg-muted/50", on && "bg-blue-50 dark:bg-blue-950/30")}>
                    <span className={cn("inline-block size-3 shrink-0 rounded-full border", on ? "border-blue-600 bg-blue-600" : "border-border")} aria-hidden="true" />
                    <span className="w-24 tabular-nums">{shortDay(o.date)}</span>
                    <span className="w-28 text-right font-semibold tabular-nums">{formatAmount(o.amountMinor, digits)}</span>
                    <span className="min-w-32 flex-1 truncate text-muted-foreground">{[o.payeeName, o.notes].filter(Boolean).join(" · ")}</span>
                    <span className="text-muted-foreground">{o.pairedTo === dueDate ? "Paired with this due date now" : o.pairedTo ? `Paired with ${shortDay(o.pairedTo)} now` : "Not paired (extra)"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No payments to this loan were found in what Bench read. If the repayment was not a transfer into the loan account, set up repayment matching in Link to Actual.</p>
        )}
        <DialogFooter className="gap-2">
          {chosenId ? <Button type="button" variant="ghost" disabled={busy} onClick={() => { setPicked(null); onClear(); }}>Forget my choice</Button> : null}
          <Button type="button" variant="outline" onClick={() => { setPicked(null); onClose(); }}>Cancel</Button>
          <Button type="button" disabled={busy || !current || current === chosenId} onClick={() => { if (current) onChoose(current); setPicked(null); }}>This is the payment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
