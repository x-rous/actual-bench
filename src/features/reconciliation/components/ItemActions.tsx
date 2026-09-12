"use client";

import { Ban, Check, Pencil, Plus, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REASON } from "@/lib/reconciliation/session/build";
import { canStageDelete, canStageField } from "@/lib/reconciliation/session/staging";
import type {
  ActualTransactionSnapshot,
  ReconciliationDisposition,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { formatMinorUnits } from "../lib/format";

/**
 * What the user can do about the selected row.
 *
 * Only actions that apply to the current state are offered (feature spec §46),
 * and an action a guardrail forbids is shown **disabled with its reason** rather
 * than hidden — a missing button reads as a bug, an explained one reads as a
 * decision.
 *
 * Every action stages. Nothing here writes to the budget.
 */

export type ItemActionsProps = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transactions: ActualTransactionSnapshot[];
  onDisposition: (disposition: ReconciliationDisposition) => void;
  /** null means "none of these" — every candidate is released. */
  onUseCandidate: (transactionId: string | null) => void;
  onCorrectAmount: (transactionId: string, amount: number) => void;
};

function GuardedButton({
  allowed,
  reason,
  children,
  ...props
}: {
  allowed: boolean;
  reason?: string;
  children: React.ReactNode;
} & React.ComponentProps<typeof Button>) {
  return (
    <div className="flex flex-col gap-0.5">
      <Button {...props} disabled={!allowed || props.disabled}>
        {children}
      </Button>
      {!allowed && reason && (
        <p className="text-[11px] text-muted-foreground">{reason}</p>
      )}
    </div>
  );
}

export function ItemActions({
  item,
  statementRow,
  transactions,
  onDisposition,
  onUseCandidate,
  onCorrectAmount,
}: ItemActionsProps) {
  const hasStatementRow = item.statementRowIds.length > 0;
  const hasTransaction = item.actualTransactionIds.length > 0;
  const deleteVerdict = canStageDelete(item);
  const amountVerdict = canStageField(item, "amount");

  const decided = item.disposition !== "unresolved";
  const primary = transactions[0];
  const isDuplicate = item.reasonCode === REASON.likelyDuplicate;

  /*
   * Closest amount first.
   *
   * These rows are the same merchant on the same day, so the amount is the only
   * thing that separates them — it is why each one states its distance from the
   * statement. Leaving them in match order made the reader do the comparison the
   * list had already done.
   *
   * Ordering only. Nothing is pre-selected and nothing is matched: the amounts
   * disagree, which is precisely why the choice is the user's.
   */
  const ordered = statementRow
    ? [...transactions].sort(
        (a, b) =>
          Math.abs(a.amount - statementRow.amount) - Math.abs(b.amount - statementRow.amount)
      )
    : transactions;

  return (
    <section className="flex flex-col gap-3 border-t border-border/50 pt-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide">Decide</h4>

      {/* Choosing between competing candidates comes first: everything else
          depends on which transaction this row is actually about. */}
      {transactions.length > 1 && item.disposition === "unresolved" && (
        <div className="flex flex-col gap-1.5">
          {isDuplicate ? (
            <p className="text-[11px] text-muted-foreground">
              This looks like the same transaction recorded more than once. Keep one; the rest
              become their own rows, to keep or delete.
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              Which one is this row? The rest stay available to the other rows. Nothing is lost.
            </p>
          )}
          {ordered.map((transaction) => (
            <Button
              key={transaction.id}
              variant="outline"
              size="sm"
              className="h-auto w-full items-start justify-start whitespace-normal py-2 text-left"
              onClick={() => onUseCandidate(transaction.id)}
            >
              <Check className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" />
              {/* Shown in full rather than truncated: this is the moment the
                  user is choosing between transactions, so the text they are
                  choosing on must be readable. */}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-xs">
                <span className="flex justify-between gap-2">
                  <span className="tabular-nums text-muted-foreground">{transaction.date}</span>
                  <span className="tabular-nums">
                    {formatMinorUnits(transaction.amount)}
                    {/* How far this candidate is from the statement, stated
                        rather than left to be worked out across a column of
                        near-identical figures. It is the evidence that
                        separates them: the rest of the row is the same
                        merchant on the same day. */}
                    {statementRow && transaction.amount !== statementRow.amount && (
                      <span className="ml-1 text-[11px] text-amber-600 dark:text-amber-400">
                        {transaction.amount > statementRow.amount ? "+" : "−"}
                        {formatMinorUnits(Math.abs(transaction.amount - statementRow.amount))}
                      </span>
                    )}
                  </span>
                </span>
                <span className="break-words font-medium">
                  {transaction.payeeName ?? "No payee"}
                </span>
                {transaction.notes && (
                  <span className="break-words text-muted-foreground">{transaction.notes}</span>
                )}
                {transaction.categoryName && (
                  <span className="text-muted-foreground">{transaction.categoryName}</span>
                )}
              </span>
            </Button>
          ))}

          {hasStatementRow && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start text-xs"
              onClick={() => onUseCandidate(null)}
            >
              None of these - this row is not in Actual
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {hasStatementRow && !hasTransaction && (
          <Button
            size="sm"
            variant={item.disposition === "create" ? "default" : "outline"}
            onClick={() => onDisposition("create")}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create in Actual
          </Button>
        )}

        {hasTransaction && !hasStatementRow && (
          <Button
            size="sm"
            variant={item.disposition === "keep" ? "default" : "outline"}
            onClick={() => onDisposition("keep")}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Keep
          </Button>
        )}

        {hasTransaction && (
          <GuardedButton
            size="sm"
            variant={item.disposition === "delete" ? "destructive" : "outline"}
            allowed={deleteVerdict.allowed}
            reason={deleteVerdict.allowed ? undefined : deleteVerdict.reason}
            onClick={() => onDisposition("delete")}
          >
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete from Actual
          </GuardedButton>
        )}

        {/* Correcting an amount keeps the transaction and everything on it; it
            is offered only when the statement actually disagrees — and only once
            there is one transaction it could mean. `primary` is the *leading*
            candidate, so offering this on a row with several would quietly
            rewrite the amount of a transaction the user has not chosen. Pick
            first, then correct. */}
        {primary && transactions.length === 1 && statementRow && primary.amount !== statementRow.amount && (
          <GuardedButton
            size="sm"
            variant={item.disposition === "correct-amount" ? "default" : "outline"}
            allowed={amountVerdict.allowed}
            reason={amountVerdict.allowed ? undefined : amountVerdict.reason}
            onClick={() => onCorrectAmount(primary.id, statementRow.amount)}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            Set amount to {formatMinorUnits(statementRow.amount)}
          </GuardedButton>
        )}

        <Button
          size="sm"
          variant={item.disposition === "ignored" ? "default" : "ghost"}
          onClick={() => onDisposition("ignored")}
        >
          <Ban className="mr-1 h-3.5 w-3.5" />
          Ignore
        </Button>

        {decided && (
          <Button size="sm" variant="ghost" onClick={() => onDisposition("unresolved")}>
            <Undo2 className="mr-1 h-3.5 w-3.5" />
            Undo
          </Button>
        )}
      </div>

      {/*
        Rules run when a transaction is created, so a payee or category chosen
        here can be changed by the budget's own rules on the way in. Said where
        the choice is made rather than only at the end, when it is too late to
        matter.
      */}
      {item.disposition === "create" && (
        <p className="text-[11px] text-muted-foreground">
          Actual&apos;s rules run on transactions as they are created, so the payee or category may
          end up different from what you set here.
        </p>
      )}

      {item.reasonCode === REASON.merchantCluster && (
        <p className="text-[11px] text-muted-foreground">
          Several rows and transactions here share this merchant and date. Pick this row&apos;s one
          above; each choice makes the next easier.
        </p>
      )}
    </section>
  );
}
