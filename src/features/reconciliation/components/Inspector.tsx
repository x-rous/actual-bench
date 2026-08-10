"use client";

import { Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { confidenceLabelText, describeReason, formatMinorUnits } from "../lib/format";

/**
 * The selected-row inspector (UX §9, feature spec §46).
 *
 * Read-only in this milestone. It answers "why does Actual Bench think these
 * match?", shows both sides side by side, and states which guardrails apply —
 * the editing surface arrives with the staged-resolution milestone.
 */

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-xs break-words">{value || "—"}</dd>
    </div>
  );
}

export type InspectorProps = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transactions: ActualTransactionSnapshot[];
  onClose: () => void;
};

export function Inspector({ item, statementRow, transactions, onClose }: InspectorProps) {
  const primary = transactions[0];
  const reasons = item.match?.reasons ?? [];

  return (
    <aside
      aria-label="Match details"
      className="flex w-80 shrink-0 flex-col gap-4 overflow-auto border-l border-border/50 p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold">Match details</h3>
        <Button variant="ghost" size="icon" aria-label="Close match details" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {item.match && (
        <section className="flex flex-col gap-1">
          <p className="text-sm font-medium">
            {item.match.confidence != null && item.match.label !== "exact"
              ? `${item.match.confidence}% ${confidenceLabelText(item.match.label)}`
              : confidenceLabelText(item.match.label)}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {/* Users must be able to tell a Bench suggestion from a manual link
                — and, later, from Actual's own native verdict. */}
            {item.match.evidenceSource === "manual"
              ? "You matched these manually"
              : "Suggested by Actual Bench"}
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {reasons.map((reason, index) => (
              <li key={`${reason.kind}-${index}`}>{describeReason(reason)}</li>
            ))}
          </ul>
        </section>
      )}

      {statementRow && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide">Bank</h4>
          <Field label="Date" value={statementRow.postedDate} />
          <Field label="Description" value={statementRow.description} />
          <Field label="Amount" value={formatMinorUnits(statementRow.amount)} />
          <Field label="Reference" value={statementRow.reference ?? null} />
        </section>
      )}

      {primary && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide">Actual</h4>
          <Field label="Date" value={primary.date} />
          <Field label="Payee" value={primary.payeeName} />
          {/* The bank's raw text is shown separately from the curated payee —
              the statement never silently replaces user data. */}
          <Field label="Imported payee" value={primary.importedPayee} />
          <Field label="Amount" value={formatMinorUnits(primary.amount)} />
          <Field label="Category" value={primary.categoryName} />
          <Field label="Notes" value={primary.notes} />
        </section>
      )}

      {transactions.length > 1 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide">
            Other candidates ({transactions.length - 1})
          </h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {transactions.slice(1).map((transaction) => (
              <li key={transaction.id}>
                {transaction.date} · {transaction.payeeName ?? "No payee"} ·{" "}
                {formatMinorUnits(transaction.amount)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(item.guards.protectedReconciled ||
        item.guards.splitParent ||
        item.guards.transfer !== "no") && (
        <section className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5">
          <h4 className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Protected
          </h4>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {item.guards.protectedReconciled && (
              <li>
                This transaction is reconciled in Actual. Actual Bench will not change or delete it.
              </li>
            )}
            {item.guards.splitParent && (
              <li>
                This is a split transaction. Its category lives on the split lines, so the category
                cannot be changed from here.
              </li>
            )}
            {item.guards.transfer === "yes" && (
              <li>
                This is one leg of a transfer. Deleting it would change the other account too, so it
                cannot be deleted from here.
              </li>
            )}
            {item.guards.transfer === "unknown" && (
              <li>
                This connection does not report transfers, so deletion needs explicit confirmation.
              </li>
            )}
          </ul>
        </section>
      )}
    </aside>
  );
}
