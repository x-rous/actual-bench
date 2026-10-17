"use client";

import type { ReactNode } from "react";
import { Link2, Lock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ActualTransactionSnapshot,
  MatchReason,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import type { StageableField } from "@/lib/reconciliation/session/staging";
import type { PossiblePair } from "@/lib/reconciliation/session/possiblePairs";
import type { ReconciliationDisposition } from "@/lib/reconciliation/types";
import { canStageField } from "@/lib/reconciliation/session/staging";
import { ItemActions } from "./ItemActions";
import { StagedFields, type Option } from "./StagedFields";
import { statementText } from "@/lib/reconciliation/statement/text";
import {
  confidenceLabelText,
  describeReason,
  formatMinorUnits,
  formatShortDate,
} from "../lib/format";

/** Current bank/Actual comparison and staged edits for the selected row. */
function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className="space-y-2.5 rounded-lg border border-border/60 bg-background p-3">
    <h4 className="text-xs font-semibold">{title}</h4>
    {children}
  </section>;
}

/** Keep the most useful evidence without repeating every text channel. */
function evidenceSummary(reasons: MatchReason[]): string[] {
  const facts = reasons.filter((reason) => reason.kind !== "text" && reason.kind !== "text-skipped");
  const text = reasons.filter((reason): reason is Extract<MatchReason, { kind: "text" }> => reason.kind === "text" && reason.similarity > 0)
    .sort((a, b) => b.similarity - a.similarity)[0];
  return [...new Set([...facts, ...(text ? [text] : [])].map(describeReason))].slice(0, 3);
}

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
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2.5">
      <dt className="whitespace-nowrap text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 whitespace-pre-wrap break-words text-xs leading-relaxed", numeric && "tabular-nums")}>{value || "-"}</dd>
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
  action,
}: {
  label: string;
  statement: string | null;
  actual: string | null;
  differs: boolean;
  /** The size of the difference, when saying it is more useful than showing it. */
  note?: string | null;
  action?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] items-baseline gap-2">
      <dt className="whitespace-nowrap text-xs text-muted-foreground">{label}</dt>
      <dd className="tabular-nums text-xs">{statement || "-"}</dd>
      <dd
        className={cn(
          "min-w-0 tabular-nums text-xs",
          differs ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
        )}
        title={note ?? undefined}
      >
        {actual || "-"}
        {differs && note && <span className="mt-0.5 block text-[11px]">{note}</span>}
        {action && <span className="mt-1.5 block text-foreground">{action}</span>}
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
  candidateSelection?: boolean;
  evidenceFor?: (transactionId: string) => string[];
  onResolveGroup?: () => void;
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
  candidateSelection = false,
  evidenceFor,
  onResolveGroup,
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
  const manual = item.match?.evidenceSource === "manual";
  const currentEvidence = chosen && !manual ? evidenceFor?.(chosen.id) : undefined;
  const evidence = (currentEvidence ?? (item.match ? evidenceSummary(item.match.reasons) : [])).slice(0, 3);
  const canUseDate = !readOnly && !candidateSelection && chosen && statementRow &&
    (item.disposition === "matched" || item.disposition === "correct-amount") &&
    chosen.date !== statementRow.postedDate && canStageField(item, "date").allowed;

  return (
    <aside aria-label="Match details"
      className="flex min-h-0 w-96 shrink-0 flex-col border-l border-border/60 bg-background">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
        <h3 className="text-sm font-semibold">Match details</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Close match details" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {(item.match || candidateSelection || evidence.length > 0) && (
          <section aria-label="Match summary" className="overflow-hidden rounded-lg border border-border/60">
            <div className="space-y-0.5 bg-muted/40 px-3 py-2">
              <h4 className="text-sm font-semibold">
                {candidateSelection ? "Candidate comparison" : manual ? "Matched manually"
                  : item.match?.label === "exact" ? "Exact match"
                  : item.match ? `${confidenceLabelText(item.match.label)} confidence` : "Match evidence"}
              </h4>
              {manual && <p className="text-[11px] text-muted-foreground">
                You matched these manually
              </p>}
            </div>
            {evidence.length > 0 && <ul className="space-y-1 px-3 py-2 text-xs text-muted-foreground">
              {evidence.map((detail) => <li key={detail} className="flex items-baseline gap-2">
                <span aria-hidden="true" className="text-muted-foreground/60">·</span>{detail}
              </li>)}
            </ul>}
          </section>
        )}
        {!readOnly && onResolveGroup && (
          <Button size="sm" variant="outline" className="w-full" onClick={onResolveGroup}>Resolve group</Button>
        )}

        {/* The two facts both sides state, compared rather than listed twice. */}
        {statementRow && chosen && (
          <PanelSection title="Comparison">
            <dl className="space-y-2">
              <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 text-[11px] font-medium">
                <span />
                <span className="rounded bg-muted px-1.5 py-1">Bank</span>
                <span className="rounded bg-muted px-1.5 py-1">Actual</span>
              </div>

              <Compared
                label="Date"
                statement={statementRow.postedDate}
                actual={chosen.date}
                differs={statementRow.postedDate !== chosen.date}
                note={dayGap(statementRow.postedDate, chosen.date)}
                action={canUseDate ? <Button size="sm" variant="outline" className="h-auto whitespace-normal px-2 py-1 text-[11px]"
                  disabled={item.stagedChanges?.date?.staged === statementRow.postedDate}
                  onClick={() => onStage("date", statementRow.postedDate)}>Use statement date</Button> : undefined}
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
          </PanelSection>
        )}

        {(statementRow || chosen) && <div aria-label="Transaction details" className="divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60">
        {statementRow && (
          <section className="space-y-2 p-3">
            <h4 className="text-xs font-semibold">Bank statement</h4>
            <dl className="flex flex-col gap-1.5">
              {!chosen && !possiblePartner && (
                <Field label="Date" value={statementRow.postedDate} />
              )}
              {statementRow.importedPayee && <Field label="Imported payee" value={statementRow.importedPayee} />}
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
              {(statementRow.bankReference || statementRow.externalId) && <Field
                label="Reference" value={statementRow.bankReference || statementRow.externalId || null} />}
            </dl>
          </section>
        )}

        {chosen && (
          <section className="space-y-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-semibold">In Actual</h4>
              {(item.guards.protectedReconciled || item.guards.splitParent || item.guards.transfer === "yes") && (
                <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  <Lock className="h-3 w-3" aria-hidden="true" />
                  {[item.guards.protectedReconciled && "Reconciled", item.guards.splitParent && "Split", item.guards.transfer === "yes" && "Transfer"].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>
            <dl className="flex flex-col gap-1.5">
              {!statementRow && <Field label="Date" value={chosen.date} />}
              {!statementRow && (
                <Field label="Amount" value={formatMinorUnits(chosen.amount)} numeric />
              )}
              <Field label="Payee" value={chosen.payeeName || "No payee"} />
              {/* The bank's raw text is shown separately from the curated payee —
                  the statement never silently replaces user data. */}
              {chosen.importedPayee && <Field label="Imported payee" value={chosen.importedPayee} />}
              <Field label="Category" value={chosen.categoryName} />
              {chosen.notes && <Field label="Notes" value={chosen.notes} />}
            </dl>
          </section>
        )}

        </div>}

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
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-sky-700 dark:text-sky-300">
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

        {/* Editing is offered once the row is about a specific transaction, or is
            going to become one. Until then there is nothing to edit. */}
        {!readOnly && !candidateSelection &&
          (item.disposition === "create" ||
            item.disposition === "matched" ||
            item.disposition === "correct-amount") && (
          <StagedFields
            key={item.id}
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

        {readOnly ? (
          <p className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground">
            This reconciliation has been applied, so its decisions are a record rather than something
            still to settle. Start a new reconciliation to check the account as it stands now.
          </p>
        ) : candidateSelection && chosen ? (
          <PanelSection title="Actions">
            {statementRow && statementRow.amount !== chosen.amount && (
              <p className="text-xs text-muted-foreground">
                {canStageField(item, "amount").allowed
                  ? `Amount will change to ${formatMinorUnits(statementRow.amount)}.`
                  : `Amount stays ${formatMinorUnits(chosen.amount)}: ${canStageField(item, "amount").allowed ? "" : "protected transaction"}.`}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => onUseCandidate(chosen.id)}>Use this match</Button>
              <Button size="sm" variant="ghost" onClick={() => onUseCandidate(null)}>None of these</Button>
            </div>
          </PanelSection>
        ) : (
          <ItemActions
            item={item}
            statementRow={statementRow}
            transactions={transactions}
            evidenceFor={evidenceFor}
            onDisposition={onDisposition}
            onUseCandidate={onUseCandidate}
            onCorrectAmount={onCorrectAmount}
          />
        )}

      </div>
    </aside>
  );
}
