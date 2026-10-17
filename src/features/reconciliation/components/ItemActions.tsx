"use client";

import { Ban, Check, Pencil, Plus, Trash2, Undo2, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
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
  evidenceFor?: (transactionId: string) => string[];
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

/** Candidate choices stay in the scrolling body while decision buttons stay visible. */
export function ItemCandidates({
  item, statementRow, transactions, onUseCandidate, evidenceFor,
}: Pick<ItemActionsProps, "item" | "statementRow" | "transactions" | "onUseCandidate" | "evidenceFor">) {
  if (transactions.length <= 1 || item.disposition !== "unresolved") return null;
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

  return <section aria-label="Possible matches" className="rounded-lg border border-border/60 bg-background p-3">
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
      {ordered.map((transaction) => {
        const evidence = evidenceFor?.(transaction.id) ?? [];
        return <Button
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
              {transaction.payeeName ?? transaction.importedPayee ?? "No payee"}
            </span>
            {transaction.notes && (
              <span className="break-words text-muted-foreground">{transaction.notes}</span>
            )}
            {evidence.length > 0 && <span className="text-[11px] text-muted-foreground">{evidence.join(" · ")}</span>}
            {transaction.categoryName && (
              <span className="text-muted-foreground">{transaction.categoryName}</span>
            )}
          </span>
        </Button>;
      })}

    </div>
  </section>;
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
  /**
   * The figures disagree and there is exactly one transaction it could be about.
   *
   * The same test that gates "Use the statement's ..." below, hoisted so the
   * two buttons cannot drift apart: they are one either/or, and a row that
   * offers to take the statement's amount must be the same row whose accept
   * button says it is keeping Actual's.
   */
  const amountsDisagree = Boolean(
    primary && transactions.length === 1 && statementRow && primary.amount !== statementRow.amount
  );
  /**
   * The figures disagree and nothing here can fix them.
   *
   * Reconciled rows, split parents and transfer legs all refuse an amount
   * change, for reasons that are about Actual rather than about this pairing.
   * That is the *only* case where confirming a match without taking the
   * statement's amount is honest: everywhere else accepting the pair now
   * corrects it, because a match that leaves the account disagreeing with the
   * bank is not a match.
   */
  const differenceIsStuck = amountsDisagree && !amountVerdict.allowed;
  const hasCandidateChoices = transactions.length > 1 && item.disposition === "unresolved";
  const hasPrimaryActions = (hasCandidateChoices && hasStatementRow) || (hasStatementRow && !hasTransaction) || (hasTransaction && !hasStatementRow) ||
    (hasStatementRow && item.actualTransactionIds.length === 1 && transactions.length === 1 &&
      (item.disposition !== "matched" || amountsDisagree));

  return (
    <section aria-label="Actions" className="space-y-2">

      {hasPrimaryActions && <div className="flex flex-wrap gap-1.5">
        {hasCandidateChoices && hasStatementRow && (
          <Button size="sm" variant="outline" onClick={() => onUseCandidate(null)}>None of these</Button>
        )}
        {/*
          Accepting the pairing, which had no control at all.
          
          A row with one transaction and a review reason - "same merchant, date
          and amount", say - offered only Delete and Ignore, so the obvious
          answer was the one thing the panel could not do. `Enter` did it, which
          means the action existed and was simply invisible.

          Gated on the item's own candidate count, not on how many resolved. A
          stored session keeps one snapshot per item, so a five-candidate row
          whose live reload failed arrives here with a single transaction - and
          offering to accept it would settle a contested row on the strength of
          what the database happened to keep.
        */}
        {hasStatementRow &&
          item.actualTransactionIds.length === 1 &&
          transactions.length === 1 &&
          item.disposition !== "matched" &&
          (!amountsDisagree || differenceIsStuck) && (
          <div className="flex flex-col gap-0.5">
          <Button size="sm" onClick={() => onDisposition("matched")}>
            <Check className="mr-1 h-3.5 w-3.5" />
            {/*
              Accepting a pairing now takes the statement's amount with it, so
              where the figures differ this button and "Use the statement's ..."
              below would be the same action under two names. One of them has to
              go, and it is this one: naming the figure is the clearer wording
              for a write.

              It comes back only where the correction is refused, and then it
              says what it is leaving behind rather than claiming a clean match.
            */}
            {differenceIsStuck
              ? `Match, leaving a ${formatMinorUnits(
                  Math.abs(primary!.amount - statementRow!.amount)
                )} difference`
              : "These match"}
          </Button>
          {/* Visible rather than a `title`: this is the reason the figures
              cannot be brought together here, and it is the same treatment
              `GuardedButton` gives a refusal a few lines above. */}
          {differenceIsStuck && amountVerdict.reason && (
            <p className="text-[11px] text-muted-foreground">{amountVerdict.reason}</p>
          )}
          </div>
        )}

        {/*
          Declining the pairing, which was reachable only from a row offering
          *several* candidates.

          `onUseCandidate(null)` already does the right thing - it releases the
          candidates and returns both sides to undecided, never deleting
          anything - and the picker's "None of these" has called it all along.
          But that whole block is gated on `transactions.length > 1`, so a row
          the matcher paired with exactly one wrong candidate had no way to say
          so: not Create (offered only where nothing is attached), not Delete
          (that removes a transaction the user never disputed). The answer
          existed and was simply unreachable for the commonest case.

          Deliberately not a decision. Separating is the removal of a wrong
          pairing, not the substitution of a different answer - the user may
          want to create the row, or link it to some other transaction, and
          neither should be assumed here.
        */}
        {hasStatementRow &&
          // The same cardinality guard the accept action uses, and for the same
          // reason: a stored session keeps one snapshot per item, so a
          // five-candidate row whose live reload failed arrives here holding one
          // transaction. Releasing on `transactions.length` alone would let go
          // of four candidates the user never saw.
          item.actualTransactionIds.length === 1 &&
          transactions.length === 1 &&
          item.disposition === "unresolved" && (
          <Button size="sm" variant="outline" onClick={() => onUseCandidate(null)}>
            <Unlink className="mr-1 h-3.5 w-3.5" />
            Not the same transaction
          </Button>
        )}

        {hasStatementRow && !hasTransaction && (
          <Button
            size="sm"
            variant="default"
            onClick={() => onDisposition("create")}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Create in Actual
          </Button>
        )}

        {/*
          Only where it means something: a transaction with nothing on the
          statement against it, where keep and delete are the real pair.

          It was widened to every row holding a transaction to settle a
          disagreement between this panel and the bulk bar - the bulk bar
          offered it on two-sided rows and the panel did not. That made the two
          agree without anyone asking what Keep *means* on a two-sided row, and
          the answer is nothing that Ignore does not already mean: the planner
          runs them through the same branch, producing no operation, and the
          coverage bar treats them identically. Three buttons, two of them the
          same action, and the redundant one labelled in a way that reads as a
          claim about the pairing it does not make.

          The bulk bar's `keepable` narrows in step, or the disagreement the
          original change fixed comes straight back.
        */}
        {hasTransaction && !hasStatementRow && (
          <Button
            size="sm"
            variant="default"
            onClick={() => onDisposition("keep")}
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Keep as is
          </Button>
        )}

        {/* Correcting an amount keeps the transaction and everything on it; it
            is offered only when the statement actually disagrees — and only once
            there is one transaction it could mean. `primary` is the *leading*
            candidate, so offering this on a row with several would quietly
            rewrite the amount of a transaction the user has not chosen. Pick
            first, then correct. */}
        {amountsDisagree && statementRow && primary && (
          <GuardedButton
            size="sm"
            variant="default"
            allowed={amountVerdict.allowed}
            reason={amountVerdict.allowed ? undefined : amountVerdict.reason}
            onClick={() => onCorrectAmount(primary.id, statementRow.amount)}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" />
            {`Use the statement's ${formatMinorUnits(statementRow.amount)}`}
          </GuardedButton>
        )}

      </div>}
      <div className={cn("flex flex-wrap gap-1.5", hasPrimaryActions && "border-t border-border/50 pt-2")}>
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

    </section>
  );
}
