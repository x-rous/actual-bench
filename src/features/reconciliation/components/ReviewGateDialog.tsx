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
 * Everything worth saying on the way from deciding to reviewing, said once.
 *
 * The workbench already offers these, and someone working row by row will have
 * seen them. Someone who filtered to "Not in Actual", selected everything and
 * pressed Create never looked at an individual row at all — and that is the
 * fastest way to reconcile a long statement, so it is the path most likely to
 * write a duplicate.
 *
 * Two things are worth raising at this point and they arrive on the same click,
 * so they share one dialog. Two in sequence would be worse than either, and the
 * second would be dismissed on the momentum of dismissing the first.
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

export type ReviewGateDialogProps = {
  open: boolean;
  pairs: PossiblePair[];
  /**
   * Rows with no decision, split by side.
   *
   * Separated because they do not weigh the same. A statement row left undecided
   * is a transaction that happened and will not be recorded; an Actual row left
   * undecided is one the statement never mentioned, and leaving it alone is a
   * perfectly good answer. "8 bank transactions will not be added" is a reason
   * to go back; "12 rows undecided" is not.
   */
  undecided: { statement: number; actual: number };
  items: Map<string, ReconciliationItem>;
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  onLink: (statementItemId: string, actualItemId: string) => void;
  /** Leave this pair alone; it is not asked about again this session. */
  onDismiss: (pair: PossiblePair) => void;
  onBackToRows: () => void;
  onContinue: () => void;
};

/**
 * The headline, which is a loss only when a statement row is involved.
 *
 * Built as a string rather than assembled in JSX. Mixing text and expressions
 * across lines leaves the spacing to JSX's whitespace rules, and an earlier
 * version of this rendered "8 of your bank transactionswon't be added" - a
 * missing space nobody would see reviewing the diff, which is exactly the kind
 * of thing a sentence held in one place cannot do.
 */
function undecidedHeadline({ statement, actual }: { statement: number; actual: number }): string {
  if (statement > 0) {
    return statement === 1
      ? "1 of your bank transactions won't be added."
      : `${statement} of your bank transactions won't be added.`;
  }
  return actual === 1
    ? "1 row still has no decision."
    : `${actual} rows still have no decision.`;
}

/** What follows from it, and what does not need following up. */
function undecidedDetail({ statement, actual }: { statement: number; actual: number }): string {
  const parts: string[] = [];

  if (statement > 0) {
    parts.push(`Applying now leaves ${statement === 1 ? "it" : "them"} out of your budget.`);
  }
  if (actual > 0) {
    const lead = statement > 0 ? "The other" : "These";
    const subject = actual === 1 ? "row is a transaction" : "rows are transactions";
    parts.push(
      `${lead} ${actual} ${subject} Actual already has that your statement didn't mention - leaving ${
        actual === 1 ? "it" : "those"
      } alone is fine.`
    );
  }

  parts.push("You can come back to this session any time to finish.");
  return parts.join(" ");
}

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

export function ReviewGateDialog({
  open,
  pairs,
  undecided,
  items,
  statementRows,
  transactions,
  onLink,
  onDismiss,
  onBackToRows,
  onContinue,
}: ReviewGateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onContinue()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Before you review</DialogTitle>
          <DialogDescription>
            {pairs.length > 0
              ? "Matching would not relate these, but they look like the same transactions. Applying as things stand would add them again and, where you are deleting the original, remove it."
              : "Some rows still have no decision."}
          </DialogDescription>
        </DialogHeader>

        <ul className="flex max-h-[45vh] flex-col gap-2 overflow-auto empty:hidden">
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

        {(undecided.statement > 0 || undecided.actual > 0) && (
          /*
           * The consequence first, in the words someone would use themselves.
           *
           * A count of undecided rows is not a reason to go back; "eight of your
           * bank transactions will not be added" is. The two sides are named
           * apart because only one of them is a loss - a transaction Actual
           * already holds that the statement never mentioned is fine left alone,
           * and lumping it into one figure makes the whole number look worse
           * than it is.
           */
          <section className="rounded-md border border-border/60 px-3 py-2.5 text-sm">
            <p className="font-medium">{undecidedHeadline(undecided)}</p>
            <p className="mt-1 text-muted-foreground">{undecidedDetail(undecided)}</p>
          </section>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onBackToRows}>
            Back to the rows
          </Button>
          <Button onClick={onContinue}>Review anyway</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
