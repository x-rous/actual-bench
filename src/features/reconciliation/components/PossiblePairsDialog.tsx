"use client";

import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PossiblePair } from "@/lib/reconciliation/session/possiblePairs";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { statementText } from "@/lib/reconciliation/statement/text";
import { formatMinorUnits, formatShortDate } from "../lib/format";

/**
 * The last chance to notice a pair before the decisions about it are reviewed.
 *
 * The workbench already offers these, and someone working row by row will have
 * seen them. Someone who filtered to "Not in Actual", selected everything and
 * pressed Create never looked at an individual row at all — and that is the
 * fastest way to reconcile a long statement, so it is the path most likely to
 * write a duplicate.
 *
 * Two things it deliberately is not:
 *
 * - **Not blocking.** Continue is always there. Replacing a transaction whose
 *   amount cannot be corrected in place, clearing a genuine duplicate the
 *   statement also carries, and retrying a partial apply are all reasons to
 *   mean both halves.
 * - **Not a second opinion on everything.** Only pairs where something would
 *   actually be written reach here. Stopping someone over a pair that writes
 *   nothing is how a dialog becomes a thing people dismiss without reading.
 *
 * Laid out statement-left, Actual-right, matching the grid the user has been
 * reading — the same comparison in a different shape is a new thing to learn.
 */

export type PossiblePairsDialogProps = {
  open: boolean;
  pairs: PossiblePair[];
  items: Map<string, ReconciliationItem>;
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  onLink: (statementItemId: string, actualItemId: string) => void;
  /** Leave this pair alone; it is not asked about again this session. */
  onDismiss: (pair: PossiblePair) => void;
  onBackToRows: () => void;
  onContinue: () => void;
};

function Side({
  date,
  text,
  amount,
  secondary,
}: {
  date: string;
  text: string;
  amount: number;
  secondary?: string | null;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="tabular-nums text-muted-foreground">{formatShortDate(date)}</span>
        <span className="tabular-nums font-medium">{formatMinorUnits(amount)}</span>
      </span>
      <span className="break-words">{text || "No payee"}</span>
      {secondary && <span className="break-words text-muted-foreground">{secondary}</span>}
    </div>
  );
}

export function PossiblePairsDialog({
  open,
  pairs,
  items,
  statementRows,
  transactions,
  onLink,
  onDismiss,
  onBackToRows,
  onContinue,
}: PossiblePairsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onContinue()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {pairs.length === 0
              ? "Nothing left to check"
              : pairs.length === 1
              ? "One row looks like a transaction you already have"
              : `${pairs.length} rows look like transactions you already have`}
          </DialogTitle>
          <DialogDescription>
            {pairs.length === 0
              ? "Every pair here has been settled or left alone."
              : "Matching would not relate these, but they look like the same transactions. Applying as things stand would add them again and, where you are deleting the original, remove it."}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-[50vh] flex-col gap-2 overflow-auto">
          {pairs.map((pair) => {
            const statementItem = items.get(pair.statementItemId);
            const actualItem = items.get(pair.actualItemId);
            const row = statementRows.get(statementItem?.statementRowIds[0] ?? "");
            const transaction = transactions.get(actualItem?.actualTransactionIds[0] ?? "");
            if (!row || !transaction) return null;

            return (
              <li
                key={`${pair.statementItemId}-${pair.actualItemId}`}
                className="flex flex-col gap-1.5 rounded-md border border-border/60 p-2.5 text-xs"
              >
                <div className="flex gap-3">
                  <Side date={row.postedDate} text={statementText(row)} amount={row.amount} />
                  <span className="self-center text-muted-foreground" aria-hidden="true">
                    ↔
                  </span>
                  <Side
                    date={transaction.date}
                    text={transaction.payeeName ?? transaction.importedPayee ?? ""}
                    amount={transaction.amount}
                    secondary={transaction.notes}
                  />
                </div>

                {/* Why it is being asked about, in the terms the reader weighs. */}
                <p className="text-[11px] text-muted-foreground">
                  {pair.dayGap === 0 ? "Same day" : `${Math.abs(pair.dayGap)} day${Math.abs(pair.dayGap) === 1 ? "" : "s"} apart`}
                  {pair.amountDifference !== 0 &&
                    ` · ${formatMinorUnits(Math.abs(pair.amountDifference))} apart`}
                </p>

                <div className="flex flex-wrap gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onLink(pair.statementItemId, pair.actualItemId)}
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" />
                    These are the same transaction
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDismiss(pair)}>
                    Leave them
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>

        <DialogFooter>
          <Button variant="ghost" onClick={onBackToRows}>
            Back to the rows
          </Button>
          <Button onClick={onContinue}>Continue to review</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
