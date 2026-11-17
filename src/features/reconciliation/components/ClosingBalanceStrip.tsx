"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import type { ClosingBalanceCheck } from "@/lib/reconciliation/session/closingBalance";
import { formatMinorUnits } from "../lib/format";

/**
 * Whether the account closes where the statement says it does: the bank's
 * printed closing balance against Actual's balance on the same date, now and
 * once the reviewed writes are applied.
 *
 * Shown only for a statement that printed a closing balance, so the figure is
 * always the bank's own — never an estimate, and never a window's sum.
 * Status is said in words as well as colour.
 */
export function ClosingBalanceStrip({
  check,
  isLoading,
  failed,
  pendingLabel,
}: {
  check: ClosingBalanceCheck | null;
  isLoading: boolean;
  failed: boolean;
  /** How the after-Apply figure is described on this screen, e.g. "After Apply". */
  pendingLabel: string;
}) {
  if (failed) {
    return (
      <p className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground" role="status">
        Could not read the account balance from Actual, so the statement&apos;s closing balance was not compared.
      </p>
    );
  }
  if (isLoading || !check) {
    return isLoading ? (
      <p className="border-b border-border/60 px-4 py-2 text-xs text-muted-foreground" role="status">
        Reading the account balance…
      </p>
    ) : null;
  }

  const { statement, actualNow, afterApply, difference, reconciles } = check;
  const Icon = reconciles ? CircleCheck : TriangleAlert;
  return (
    <section
      aria-label="Closing balance check"
      className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border/60 px-4 py-2 text-xs"
    >
      <span className={reconciles ? "flex items-center gap-1.5 font-medium text-emerald-600 dark:text-emerald-400" : "flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400"}>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {reconciles
          ? `Closes at the statement's balance on ${statement.asOf}`
          : `Differs from the statement's balance on ${statement.asOf} by ${formatMinorUnits(Math.abs(difference))}`}
      </span>
      <span className="tabular-nums text-muted-foreground">
        Statement {formatMinorUnits(statement.amount)}
        {statement.source === "last-row" ? " (last row's balance)" : ""}
      </span>
      <span className="tabular-nums text-muted-foreground">Actual now {formatMinorUnits(actualNow)}</span>
      {afterApply !== actualNow && (
        <span className="tabular-nums text-muted-foreground">{pendingLabel} {formatMinorUnits(afterApply)}</span>
      )}
      {statement.polarityDetected && (
        <span className="text-muted-foreground">
          The sign comes from the detected account type ({statement.polarity === "liability" ? "money owed" : "money held"}).
        </span>
      )}
    </section>
  );
}
