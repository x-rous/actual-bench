"use client";

import { Link2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import type { StageableField } from "@/lib/reconciliation/session/staging";
import type { PossiblePair } from "@/lib/reconciliation/session/possiblePairs";
import type { ReconciliationDisposition } from "@/lib/reconciliation/types";
import { ItemActions } from "./ItemActions";
import { StagedFields, type Option } from "./StagedFields";
import { statementText } from "@/lib/reconciliation/statement/text";
import {
  confidenceLabelText,
  describeReason,
  formatMinorUnits,
  formatShortDate,
} from "../lib/format";

/**
 * The selected-row inspector (UX §9, feature spec §46).
 *
 * Read-only in this milestone. It answers "why does Actual Bench think these
 * match?", shows both sides side by side, and states which guardrails apply —
 * the editing surface arrives with the staged-resolution milestone.
 */

/**
 * One fact, label left and value right.
 *
 * Stacked, each field cost two lines and the panel ran to a scroll for what is
 * a dozen short values. Side by side it reads as a list of facts, which is what
 * it is.
 */
function Field({
  label,
  value,
  numeric,
}: {
  label: string;
  value: string | null;
  numeric?: boolean;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_1fr] items-baseline gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("break-words text-xs", numeric && "tabular-nums")}>{value || "-"}</dd>
    </div>
  );
}

/**
 * A fact both sides state, shown once with both readings.
 *
 * Date and amount were listed under Bank and again under Actual, leaving the
 * reader to compare two lists in their head — which is the work this feature
 * exists to remove. Here they sit on one line, and a difference is marked and
 * quantified rather than left to be spotted.
 */
function Compared({
  label,
  statement,
  actual,
  differs,
  note,
}: {
  label: string;
  statement: string | null;
  actual: string | null;
  differs: boolean;
  /** The size of the difference, when saying it is more useful than showing it. */
  note?: string | null;
}) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr_1fr] items-baseline gap-2">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-xs">{statement || "-"}</dd>
      <dd
        className={cn(
          "tabular-nums text-xs",
          differs ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        )}
        title={note ?? undefined}
      >
        {actual || "-"}
        {differs && note && <span className="block text-[10px]">{note}</span>}
      </dd>
    </div>
  );
}

/** How far apart two dates are, in the words the reader would use. */
function dayGap(left: string, right: string): string | null {
  const a = Date.parse(`${left}T00:00:00Z`);
  const b = Date.parse(`${right}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || a === b) return null;
  const days = Math.round(Math.abs(b - a) / 86_400_000);
  return `${days} day${days === 1 ? "" : "s"} ${b > a ? "later" : "earlier"}`;
}

/**
 * One side of a possible pair, in the shape the candidate list already uses.
 *
 * Date and amount on one line, the name beneath it, supporting text below that
 * — so two of these stacked read as two things to choose between rather than as
 * a table to parse.
 */
function PairSide({
  label,
  date,
  amount,
  title,
  detail,
  category,
}: {
  label: string;
  date: string;
  amount: number;
  title: string;
  detail?: string | null;
  category?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-border/60 bg-background/60 p-2 text-xs">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="flex justify-between gap-2">
        <span className="tabular-nums text-muted-foreground">{formatShortDate(date)}</span>
        <span className="tabular-nums font-medium">{formatMinorUnits(amount)}</span>
      </span>
      <span className="break-words font-medium">{title || "No payee"}</span>
      {detail && <span className="break-words text-muted-foreground">{detail}</span>}
      {category && <span className="text-muted-foreground">{category}</span>}
    </div>
  );
}

export type InspectorProps = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transactions: ActualTransactionSnapshot[];
  payees: Option[];
  categories: Option[];
  onClose: () => void;
  onDisposition: (disposition: ReconciliationDisposition) => void;
  onUseCandidate: (transactionId: string | null) => void;
  onCorrectAmount: (transactionId: string, amount: number) => void;
  onStage: (field: StageableField, value: string | null) => void;
  onUnstage: (field: StageableField) => void;
  /** The session has been applied: show the record, offer no more decisions. */
  readOnly?: boolean;
  /**
   * The other half of a pair the matcher could not relate.
   *
   * Offered here rather than in the candidate list, and confirmed by its own
   * button, because that is the whole basis on which the search behind it runs
   * at a lower threshold than matching: it can be generous precisely because
   * acting on it is deliberate. Putting it among the candidates would make it
   * one keypress away and take that back.
   */
  possiblePartner?: {
    pair: PossiblePair;
    /** The statement side of the pair, whichever row is selected. */
    row: StatementRow | undefined;
    /** The Actual side of the pair, whichever row is selected. */
    transaction: ActualTransactionSnapshot | undefined;
  } | null;
  onLinkPossible?: (statementItemId: string, actualItemId: string) => void;
};

export function Inspector({
  item,
  statementRow,
  transactions,
  payees,
  categories,
  onClose,
  onDisposition,
  onUseCandidate,
  onCorrectAmount,
  onStage,
  onUnstage,
  readOnly = false,
  possiblePartner = null,
  onLinkPossible,
}: InspectorProps) {
  /*
   * The transaction this row is about — and only when there is one.
   *
   * `transactions[0]` on a contested row is the matcher's ranking, not a choice
   * anyone made, so comparing the statement against it and heading the result
   * "In Actual" presents a guess as a finding.
   *
   * The item's own candidate count decides it, not how many happened to
   * resolve. Where the session is showing stored snapshots rather than a live
   * read, a five-candidate item resolves to the one snapshot it persisted —
   * and treating that as the selection would call a contested row settled on
   * the strength of what the database happened to keep. While several candidates are in
   * play the panel shows the statement, and the candidates themselves are the
   * one list in `ItemActions` below — which is where they can be picked.
   */
  const chosen =
    item.actualTransactionIds.length === 1 && transactions.length === 1
      ? transactions[0]
      : undefined;
  const reasons = item.match?.reasons ?? [];

  return (
    <aside
      aria-label="Match details"
      className="flex w-96 shrink-0 flex-col gap-3 overflow-auto border-l border-border/50 p-4"
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

      {/* The two facts both sides state, compared rather than listed twice. */}
      {statementRow && chosen && (
        <section className="flex flex-col gap-1.5">
          <dl className="flex flex-col gap-1.5">
            <div className="grid grid-cols-[3.5rem_1fr_1fr] gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
              <span />
              <span>Bank</span>
              <span>Actual</span>
            </div>
            <Compared
              label="Date"
              statement={statementRow.postedDate}
              actual={chosen.date}
              differs={statementRow.postedDate !== chosen.date}
              note={dayGap(statementRow.postedDate, chosen.date)}
            />
            <Compared
              label="Amount"
              statement={formatMinorUnits(statementRow.amount)}
              actual={formatMinorUnits(chosen.amount)}
              differs={statementRow.amount !== chosen.amount}
              note={
                statementRow.amount !== chosen.amount
                  ? `${chosen.amount > statementRow.amount ? "+" : "−"}${formatMinorUnits(
                      Math.abs(chosen.amount - statementRow.amount)
                    )}`
                  : null
              }
            />
          </dl>
        </section>
      )}

      {statementRow && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide">Bank statement</h4>
          <dl className="flex flex-col gap-1.5">
            {!chosen && !possiblePartner && (
              <Field label="Date" value={statementRow.postedDate} />
            )}
            <Field label="Imported payee" value={statementRow.importedPayee} />
            {statementRow.bankNotes && (
              <Field label="Bank notes" value={statementRow.bankNotes} />
            )}
            {!chosen && !possiblePartner && (
              <Field label="Amount" value={formatMinorUnits(statementRow.amount)} numeric />
            )}
            {/* A foreign purchase carries two amounts, and which one Actual
                holds is exactly what makes these rows hard to match by hand. */}
            {statementRow.originalAmount != null && (
              <Field
                label="Original"
                value={`${formatMinorUnits(statementRow.originalAmount)} ${
                  statementRow.originalCurrency ?? ""
                }`.trim()}
                numeric
              />
            )}
            <Field
              label="Reference"
              value={statementRow.bankReference ?? statementRow.externalId ?? null}
            />
          </dl>
        </section>
      )}

      {chosen && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide">In Actual</h4>
          <dl className="flex flex-col gap-1.5">
            {!statementRow && <Field label="Date" value={chosen.date} />}
            {!statementRow && (
              <Field label="Amount" value={formatMinorUnits(chosen.amount)} numeric />
            )}
            <Field label="Payee" value={chosen.payeeName} />
            {/* The bank's raw text is shown separately from the curated payee —
                the statement never silently replaces user data. */}
            <Field label="Imported payee" value={chosen.importedPayee} />
            <Field label="Category" value={chosen.categoryName} />
            <Field label="Notes" value={chosen.notes} />
          </dl>
        </section>
      )}

      {/*
        Shown above the decide actions, because if these two are the same thing
        then none of the decisions below is the right one.

        **Both sides, always.** The first version showed only the difference —
        "0.67 apart" — while the panel above it showed whichever row happened to
        be selected. So the user was asked to confirm a pairing without ever
        being shown the other half of it, which is not a question anyone can
        answer. The comparison is the same shape the panel uses for a matched
        row: one line per fact, both readings, differences marked.
      */}
      {!readOnly && possiblePartner?.row && possiblePartner.transaction && onLinkPossible && (
        <section className="flex flex-col gap-2 rounded-md border border-sky-500/40 bg-sky-500/5 p-2.5">
          <h4 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            <Link2 className="h-3 w-3" aria-hidden="true" />
            Possibly the same transaction
          </h4>

          {/*
            Stacked, not side by side.
            
            A three-column compare fits a *matched* row, where the panel is
            reporting a conclusion and the two readings of each fact belong on
            one line. Here the user is choosing, and choosing is what the
            candidate list already does - one block per transaction, read top to
            bottom. Two shapes for the same act is one more thing to learn, and
            in a 24rem panel the columns were too narrow for a merchant name.
          */}
          <PairSide
            label="From the statement"
            date={possiblePartner.row.postedDate}
            amount={possiblePartner.row.amount}
            title={statementText(possiblePartner.row)}
          />
          <PairSide
            label="In Actual"
            date={possiblePartner.transaction.date}
            amount={possiblePartner.transaction.amount}
            // The same three channels the comparison itself reads. Falling
            // straight to "No payee" threw away the bank text the pairing was
            // very likely found on.
            title={
              possiblePartner.transaction.payeeName ??
              possiblePartner.transaction.importedPayee ??
              ""
            }
            detail={possiblePartner.transaction.notes}
            category={possiblePartner.transaction.categoryName}
          />

          {/* What separates them, said once rather than marked on each line. */}
          <p className="text-[11px] text-muted-foreground">
            {possiblePartner.pair.dayGap === 0
              ? "Same day"
              : `${Math.abs(possiblePartner.pair.dayGap)} day${
                  Math.abs(possiblePartner.pair.dayGap) === 1 ? "" : "s"
                } apart`}
            {possiblePartner.pair.amountDifference !== 0 &&
              ` · ${formatMinorUnits(Math.abs(possiblePartner.pair.amountDifference))} apart`}
            . Matching would not relate these, so neither row was offered to the other.
          </p>

          <Button
            size="sm"
            variant="outline"
            className="self-start"
            onClick={() =>
              onLinkPossible(
                possiblePartner.pair.statementItemId,
                possiblePartner.pair.actualItemId
              )
            }
          >
            <Link2 className="mr-1 h-3.5 w-3.5" />
            These are the same transaction
          </Button>
        </section>
      )}

      {readOnly ? (
        <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
          This reconciliation has been applied, so its decisions are a record rather than something
          still to settle. Start a new reconciliation to check the account as it stands now.
        </p>
      ) : (
        <ItemActions
          item={item}
          statementRow={statementRow}
          transactions={transactions}
          onDisposition={onDisposition}
          onUseCandidate={onUseCandidate}
          onCorrectAmount={onCorrectAmount}
        />
      )}

      {/* Editing is offered once the row is about a specific transaction, or is
          going to become one. Until then there is nothing to edit. */}
      {!readOnly &&
        (item.disposition === "create" ||
          item.disposition === "matched" ||
          item.disposition === "correct-amount") && (
        <StagedFields
          item={item}
          current={{
            payeeId: chosen?.payeeId ?? null,
            categoryId: chosen?.categoryId ?? null,
            notes: chosen?.notes ?? null,
          }}
          payees={payees}
          categories={categories}
          onStage={onStage}
          onUnstage={onUnstage}
        />
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
