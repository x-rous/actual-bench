"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { PostingView } from "@/lib/assets-debt/services/proposalService";
import { OVERRIDE_NO_REASON_MINOR } from "@/lib/assets-debt/overrides";
import { formatAmount } from "../../lib/money";
import { MoneyField, TextField } from "../fields";

/**
 * A proposed split's amounts, editable in place (RD-084 P1.6b T291 rev 2; FR-069d,
 * `ux-loan-workspace.md` §3.7). Principal and interest are both fields; changing one moves the
 * other, the payment stays fixed. Up to ±1 minor unit from Bench's value needs no reason; more
 * shows a reason field and needs it. "Apply with edit" records the edit (a new Review proposal
 * with both values) and applies it in one click; "Save edit" only records it. Nothing reaches
 * Actual except through the explicit apply.
 */

export function isEditableSplit(posting: PostingView | null): boolean {
  return !!posting && posting.status === "proposed" && posting.postingKind === "repayment-split" && posting.output.kind === "restructure" && posting.classification !== "blocked";
}

export function SplitAmounts({ posting, digits, busy, onApply, onSave, onDecline }: {
  posting: PostingView;
  digits: number;
  busy?: boolean;
  /** `edit` is null when the amounts are unchanged: a plain apply. */
  onApply: (edit: { interestMinor: number; reason: string | null } | null) => void;
  onSave: (interestMinor: number, reason: string | null) => void;
  onDecline: () => void;
}) {
  const output = posting.output.kind === "restructure" ? posting.output : null;
  const interestLine = output?.operations.find((c) => c.economicKind === "interest");
  const current = interestLine ? Math.abs(interestLine.amountMinor) : 0;
  const calculated = output?.override?.calculatedInterestMinor ?? current;
  const payment = output ? Math.abs(output.before.amountMinor) : 0;
  const fees = output ? output.operations.filter((c) => c.economicKind !== "principal" && c.economicKind !== "interest").reduce((sum, c) => sum + Math.abs(c.amountMinor), 0) : 0;
  const [interest, setInterest] = useState<number | null>(current);
  const [reason, setReason] = useState(output?.override?.reason ?? "");
  if (!output || !interestLine) return null;

  const principal = interest === null ? null : payment - fees - interest;
  const fromCalculated = interest === null ? 0 : interest - calculated;
  const needsReason = Math.abs(fromCalculated) > OVERRIDE_NO_REASON_MINOR;
  const edited = interest !== current;
  const reasonChanged = (reason.trim() || null) !== (output.override?.reason ?? null);
  const problem = interest === null ? "Enter both amounts." : principal !== null && principal <= 0 ? "Principal must stay above zero." : interest < 0 ? "Interest cannot be negative." : needsReason && !reason.trim() ? "Give a short reason for a change of more than one minor unit." : null;
  const edit = interest === null ? null : { interestMinor: interest, reason: reason.trim() || null };

  return (
    <section aria-label="Split amounts" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <MoneyField fixedDecimals label="Principal" valueMinor={principal} minorDigits={digits} onChange={(p) => setInterest(p === null ? null : payment - fees - p)} className="w-36" />
        <span aria-hidden="true" className="pb-2 text-muted-foreground">+</span>
        <MoneyField fixedDecimals label="Interest" valueMinor={interest} minorDigits={digits} onChange={setInterest} className="w-36" />
        {fees ? (
          <>
            <span aria-hidden="true" className="pb-2 text-muted-foreground">+</span>
            <div className="flex flex-col gap-1 pb-2"><span className="text-xs text-muted-foreground">Fees</span><span className="tabular-nums">{formatAmount(fees, digits)}</span></div>
          </>
        ) : null}
        <span aria-hidden="true" className="pb-2 text-muted-foreground">=</span>
        <div className="flex flex-col gap-1 pb-2"><span className="text-xs text-muted-foreground">Payment</span><span className="font-medium tabular-nums">{formatAmount(payment, digits)}</span></div>
        <p className="pb-2 text-xs text-muted-foreground">
          {interest !== calculated ? (
            <>
              Bench calculated interest of {formatAmount(calculated, digits)}.{" "}
              <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => { setInterest(calculated); setReason(""); }}>Reset to calculated</Button>
            </>
          ) : "Type either amount; the other follows. Up to one minor unit needs no reason."}
        </p>
      </div>
      {needsReason || output.override?.reason ? (
        <TextField label={needsReason ? "Reason (needed for a change over one minor unit)" : "Reason (optional)"} value={reason} onChange={setReason} placeholder="Lender statement shows a different interest" className="max-w-md" />
      ) : null}
      {problem && (edited || reasonChanged) ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || !!problem} onClick={() => onApply(edited || reasonChanged ? edit : null)}>
          {edited ? "Apply with edit" : "Apply this change"}
        </Button>
        {edited || reasonChanged ? (
          <Button type="button" size="sm" variant="outline" disabled={busy || !!problem} onClick={() => edit && onSave(edit.interestMinor, edit.reason)}>Save edit</Button>
        ) : null}
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDecline}>Not now</Button>
      </div>
    </section>
  );
}
