"use client";

import { AlertTriangle, CheckCircle2, Plus, Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  balanceImpact,
  classifyPlan,
  planCounts,
  totalChanges,
  type ApplyPlan,
} from "@/lib/reconciliation/apply/operations";
import { stagedFields } from "@/lib/reconciliation/session/staging";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import type { DriftReport, DriftVerdict } from "@/lib/reconciliation/apply/drift";
import { statementText } from "@/lib/reconciliation/statement/text";
import { ReviewComparison } from "./ReviewComparison";
import { formatMinorUnits } from "../lib/format";
import type { Option } from "./StagedFields";
import { WriteSetting } from "./WriteSetting";

/**
 * The last screen before anything is written (feature spec §38).
 *
 * It names **changes**, not rows. Most of a reconciliation needs no write at
 * all, so a button offering to "import 248 transactions" when twelve will change
 * is not a rounding error in wording — it is the difference between a user who
 * trusts the tool and one who does not.
 *
 * Unresolved rows are shown but do not block: leaving part of a statement for
 * later is a legitimate way to work.
 */

const FIELD_LABELS: Record<string, string> = {
  amount: "Amount",
  date: "Date",
  payeeId: "Payee",
  categoryId: "Category",
  notes: "Notes",
};

/**
 * How a changed field is named in the summary sentence.
 *
 * Counted per field across the updates, so it reads as "3 payees" — three
 * transactions whose payee changes — rather than a bare number beside a label
 * that could as easily mean rows.
 */
function pluralFieldLabel(field: string, count: number): string {
  const one: Record<string, string> = {
    amount: "amount",
    date: "date",
    payeeId: "payee",
    notes: "note",
  };
  const singular = one[field] ?? (FIELD_LABELS[field] ?? field).toLowerCase();
  return count === 1 ? singular : `${singular}s`;
}

export type ReviewPanelProps = {
  plan: ApplyPlan;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  payees: Option[];
  categories: Option[];
  /** What moved in Actual since the session loaded, once checked. */
  drift: DriftReport | null;
  applyConfig: ApplyConfig;
  onApplyConfigChange: (config: ApplyConfig) => void;
};

export function ReviewPanel({
  plan,
  items,
  statementRows,
  transactions,
  payees,
  categories,
  drift,
  applyConfig,
  onApplyConfigChange,
}: ReviewPanelProps) {
  const counts = planCounts(plan);
  const total = totalChanges(plan);
  const balance = balanceImpact(plan);
  // Provenance writes are writes, so they are counted — but they are not
  // changes the user staged, and reporting them as such would overstate what
  // is about to happen to their budget (RD-072 §2.4).
  const { enrichments } = classifyPlan(plan);

  // Counted per field rather than per operation: one update that changes a
  // category and a note is two metadata changes, and that is what the user is
  // actually reviewing.
  // Once the pre-flight check has run, the button has to speak about the work
  // that will actually happen rather than the work that was planned.
  const withheld = drift?.withheld.length ?? 0;
  const applicable = Math.max(total - withheld, 0);

  const fieldCounts = new Map<string, number>();
  for (const operation of plan.operations) {
    if (operation.kind !== "update") continue;
    for (const field of stagedFields(operation.patch)) {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }

  return (
    // The summary, settings and decision stay put; only the table scrolls.
    // Scrolling the whole page meant the Apply button — and the count it is
    // about — left the screen the moment you started reading the rows.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4">
      {/*
        One line for the whole summary: what will happen, and what it does to
        the balance. These were four cards and a panel, which pushed the table
        the user came here to read below the fold.

        A reconciliation that moves money is doing something the user should
        agree to knowingly, so the figure is stated before the fact rather than
        discovered afterwards in the account.
      */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-border/60 px-3 py-2">
        <h2 className="text-sm font-semibold">Review before applying</h2>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <Stat label="Create" value={counts.create} icon={Plus} />
          <Stat label="Update" value={counts.update} icon={Pencil} />
          <Stat label="Delete" value={counts.delete} icon={Trash2} destructive />
          <Stat label="No change needed" value={plan.noWriteMatches} muted />
          {enrichments > 0 && (
            <span
              className="text-muted-foreground"
              title="Matched transactions that keep their payee, notes and category, and gain the merchant text your bank used."
            >
              {enrichments} bank {enrichments === 1 ? "detail" : "details"} recorded
            </span>
          )}
        </div>

        <div className="flex items-baseline gap-1.5 border-l border-border/60 pl-3 text-xs">
          {/* "Balance" alone reads as the account's balance, which this is not
              — it is what these changes move it by. */}
          <span className="text-muted-foreground">Net change to balance</span>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              balance > 0 && "text-emerald-600 dark:text-emerald-400",
              balance < 0 && "text-destructive"
            )}
            title={
              balance === 0
                ? "These changes leave the balance where it is."
                : "Transactions created, less those deleted, plus the difference on any corrected amount."
            }
          >
            {balance > 0 ? "+" : balance < 0 ? "−" : ""}
            {formatMinorUnits(Math.abs(balance))}
          </span>
        </div>

        {/* An applied session says so, rather than presenting an empty plan
            as though there were simply nothing to do. */}
        {plan.alreadyApplied > 0 && (
          <span className="flex items-center gap-1 border-l border-border/60 pl-3 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            {plan.alreadyApplied} already applied
          </span>
        )}

        <p className="ml-auto text-[11px] text-muted-foreground">
          {applicable === 0 && plan.alreadyApplied > 0
            ? "Everything decided here has been written."
            : "Nothing is written until you apply."}
        </p>
      </section>

      {/*
        Asked here rather than in the matching options: these shape the write,
        not the match, and this is the screen where the affected rows are in
        front of the user.

        Every option stays visible, but only the chosen one explains itself.
        Three permanent hint blocks each is what made these two settings taller
        than the table they are about.
      */}
      <div className="grid gap-3 lg:grid-cols-2">
        <WriteSetting
          label="Mark as cleared"
          legend="Which transactions to mark cleared"
          name="cleared-target"
          value={applyConfig.clearedTarget}
          onChange={(next) => onApplyConfigChange({ ...applyConfig, clearedTarget: next })}
          options={[
            {
              value: "none",
              label: "Leave alone",
              hint: "Nothing's cleared flag changes.",
            },
            {
              value: "created",
              label: "New only",
              hint: "Transactions created from this statement start out cleared.",
            },
            {
              value: "reconciled",
              label: "Everything confirmed",
              hint: "Also clears matched transactions that are not cleared yet - the point of reconciling, but it turns rows needing no change into writes. Rows already cleared or reconciled in Actual are left untouched.",
            },
          ]}
        />

        <WriteSetting
          label="Record the bank's merchant text"
          legend="Whether matched transactions gain the bank's own merchant text"
          name="enrich-imported-payee"
          value={applyConfig.enrichImportedPayee ? "on" : "off"}
          onChange={(next) =>
            onApplyConfigChange({ ...applyConfig, enrichImportedPayee: next === "on" })
          }
          options={[
            {
              value: "on",
              label: "On new and matched rows",
              hint: "A matched transaction keeps its payee, notes and category exactly as they are - only the bank's merchant text is attached. Rows already reconciled in Actual are skipped.",
            },
            {
              value: "off",
              label: "On new rows only",
              hint: "Only transactions created from this statement record it. Matched transactions are not written to at all unless you staged a change on them, and keep whatever imported payee they already have.",
            },
          ]}
        />
      </div>

      {/*
        Stated, not offered. Where a new transaction's payee and notes come from
        is chosen on the import screen, because the transformation engine reads
        the note a row is going to carry — a source picked after transformations
        have run would move every untouched row and leave the transformed ones
        behind. Naming it here keeps the review complete.
      */}
      {counts.create > 0 && (
        <p className="text-[11px] text-muted-foreground">
          New transactions take their payee from{" "}
          <span className="font-medium">
            {applyConfig.payeeStrategy === "imported-payee"
              ? "the bank's merchant text"
              : "your rules"}
          </span>{" "}
          and their notes from{" "}
          <span className="font-medium">
            {applyConfig.notesStrategy === "bank-notes"
              ? "the bank's memo"
              : applyConfig.notesStrategy === "imported-payee"
                ? "the bank's memo, or its merchant text where there is none"
                : "nothing"}
          </span>
          . The bank&apos;s merchant text is recorded as the imported payee either way. Change this
          on the import screen.
        </p>
      )}

      {drift && (
        <DriftNotice
          drift={drift}
          plan={plan}
          items={items}
          statementRows={statementRows}
          transactions={transactions}
        />
      )}

      {/* Which fields the updates touch. The Apply and Cancel buttons that used
          to sit here now live in the page toolbar, with the rest of the phase
          navigation. */}
      {fieldCounts.size > 0 && (
        <div className="border-t border-border/50 pt-3 text-xs">
          <p className="text-muted-foreground">The changes will include:</p>
          <p className="flex flex-wrap items-baseline gap-x-3">
            {[...fieldCounts].map(([field, count]) => (
              <span key={field}>
                <span className="font-medium tabular-nums">{count}</span>{" "}
                {pluralFieldLabel(field, count)}
              </span>
            ))}
          </p>
        </div>
      )}

      <ReviewComparison
        plan={plan}
        items={items}
        statementRows={statementRows}
        transactions={transactions}
        payees={payees}
        categories={categories}
        applyConfig={applyConfig}
        unresolved={plan.unresolved}
      />

      {plan.blocked.length > 0 && (
        <section className="rounded-md border border-amber-500/40 p-3 text-xs">
          <h3 className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {plan.blocked.length} will not be applied
          </h3>
          <ul className="space-y-1 text-muted-foreground">
            {plan.blocked.slice(0, 8).map((entry) => (
              <li key={entry.itemId}>{entry.reason}</li>
            ))}
          </ul>
        </section>
      )}

      {/*
        Rules run on transactions as they are created, so a created row may not
        end up exactly as previewed. Said here rather than only afterwards.
      */}
      {counts.create > 0 && (
        <p className="text-xs text-muted-foreground">
          Actual&apos;s rules run on new transactions, so payees and categories on the{" "}
          {counts.create} created row{counts.create === 1 ? "" : "s"} may end up different from what
          is shown here.
        </p>
      )}

    </div>
  );
}

/**
 * What the pre-flight re-read found (feature spec §41).
 *
 * Three things are worth different amounts of the reader's attention, so they
 * are separated rather than listed together: rows held back because applying
 * would overwrite an edit made in Actual, notes whose staged change was replayed
 * onto text written since, and figures quietly brought up to date. Only the
 * first needs a decision.
 */
function DriftNotice({
  drift,
  plan,
  items,
  statementRows,
  transactions,
}: {
  drift: DriftReport;
  plan: ApplyPlan;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const operationById = new Map(plan.operations.map((operation) => [operation.id, operation]));

  /** Enough of a row for the reader to recognise which transaction is meant. */
  const describe = (verdict: DriftVerdict): string => {
    const operation = operationById.get(verdict.operationId);
    const item = operation ? itemById.get(operation.itemId) : undefined;
    const row = item ? statementRows.get(item.statementRowIds[0] ?? "") : undefined;
    if (row) return `${row.postedDate} · ${statementText(row)}`;
    const transaction = item ? transactions.get(item.actualTransactionIds[0] ?? "") : undefined;
    if (transaction) {
      return `${transaction.date} · ${transaction.payeeName ?? transaction.notes ?? "transaction"}`;
    }
    return "One transaction";
  };

  const held = drift.withheld;
  const rebased = drift.verdicts.filter((verdict) => verdict.status === "rebased");
  const refreshed = drift.verdicts.filter((verdict) => verdict.status === "refreshed");

  if (held.length === 0 && rebased.length === 0 && refreshed.length === 0) {
    return (
      <p className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
        Nothing these changes touch has been altered in Actual since this session loaded.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {held.length > 0 && (
        <section className="rounded-md border border-amber-500/50 bg-amber-500/5 p-3 text-xs">
          <h3 className="mb-1 flex items-center gap-1 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            {held.length} change{held.length === 1 ? " is" : "s are"} being held back
          </h3>
          <p className="mb-2 text-muted-foreground">
            {held.length === 1 ? "This row" : "These rows"} changed in Actual after this session
            loaded, so applying would overwrite that. Nothing here will be written. Go back to the
            workbench to look, or apply the rest and come back to{" "}
            {held.length === 1 ? "it" : "them"}.
          </p>
          <ul className="max-h-40 space-y-1.5 overflow-y-auto">
            {held.map((verdict) => (
              <li key={verdict.operationId}>
                <span className="font-medium">{describe(verdict)}</span>
                <span className="block text-muted-foreground">
                  {verdict.status === "conflict" || verdict.status === "vanished"
                    ? verdict.reason
                    : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rebased.length > 0 && (
        <section className="rounded-md border border-border/60 p-3 text-xs">
          <h3 className="mb-1 font-semibold">
            {rebased.length} note{rebased.length === 1 ? "" : "s"} kept what was written in Actual
          </h3>
          <p className="mb-2 text-muted-foreground">
            The note changed in Actual after this session staged its change, so the change was
            applied to the current text instead of replacing it.
          </p>
          <ul className="max-h-32 space-y-1 overflow-y-auto">
            {rebased.map((verdict) => (
              <li key={verdict.operationId} className="text-muted-foreground">
                <span className="font-medium text-foreground">{describe(verdict)}</span>
                {verdict.status === "rebased" && (
                  <span className="block">→ {verdict.notes ?? "(no note)"}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {refreshed.length > 0 && (
        <p className="rounded-md border border-border/60 px-3 py-2 text-xs text-muted-foreground">
          {refreshed.length} transaction{refreshed.length === 1 ? " has" : "s have"} an amount or
          date that changed in Actual since this session loaded. Those values were left as Actual
          has them rather than written back to what this session read.
        </p>
      )}
    </div>
  );
}

/**
 * One setting that shapes how the writes are made.
 *
 * Radios, so the whole choice is visible and one keystroke moves between the
 * options — but rendered as a segmented control, with the hint shown only for
 * whichever option is selected. Every option a user might pick still explains
 * itself; it just does so when they are looking at it.
 */
function Stat({
  label,
  value,
  icon: Icon,
  destructive,
  muted,
}: {
  label: string;
  value: number;
  icon?: typeof Plus;
  destructive?: boolean;
  muted?: boolean;
}) {
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />}
      <span
        className={cn(
          "font-semibold tabular-nums",
          destructive && value > 0 && "text-destructive",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
