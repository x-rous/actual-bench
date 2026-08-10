"use client";

import { AlertTriangle, ArrowLeft, Loader2, Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { planCounts, totalChanges, type ApplyPlan } from "@/lib/reconciliation/apply/operations";
import { stagedFields } from "@/lib/reconciliation/session/staging";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import type { ActualTransactionSnapshot, StatementRow } from "@/lib/reconciliation/types";
import { formatMinorUnits } from "../lib/format";

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

export type ReviewPanelProps = {
  plan: ApplyPlan;
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  isApplying: boolean;
  applyConfig: ApplyConfig;
  onApplyConfigChange: (config: ApplyConfig) => void;
  onBack: () => void;
  onApply: () => void;
};

export function ReviewPanel({
  plan,
  statementRows,
  transactions,
  isApplying,
  applyConfig,
  onApplyConfigChange,
  onBack,
  onApply,
}: ReviewPanelProps) {
  const counts = planCounts(plan);
  const total = totalChanges(plan);

  // Counted per field rather than per operation: one update that changes a
  // category and a note is two metadata changes, and that is what the user is
  // actually reviewing.
  const fieldCounts = new Map<string, number>();
  for (const operation of plan.operations) {
    if (operation.kind !== "update") continue;
    for (const field of stagedFields(operation.patch)) {
      fieldCounts.set(field, (fieldCounts.get(field) ?? 0) + 1);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="mr-1 h-3.5 w-3.5" />
          Back to the workbench
        </Button>
      </div>

      <div>
        <h2 className="text-sm font-semibold">Review before applying</h2>
        <p className="text-xs text-muted-foreground">
          Nothing has been written to your budget yet. Everything below happens only when you apply.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Create" value={counts.create} icon={Plus} />
        <Stat label="Update" value={counts.update} icon={Pencil} />
        <Stat label="Delete" value={counts.delete} icon={Trash2} destructive />
        <Stat label="No change needed" value={plan.noWriteMatches} muted />
      </div>

      {/*
        Asked here rather than in the matching options: these shape the write,
        not the match, and this is the screen where the affected rows are in
        front of the user.
      */}
      <section className="rounded-md border border-border/60 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Mark as cleared
        </h3>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Which transactions to mark cleared</legend>
          {(
            [
              ["none", "Leave cleared status alone", "Nothing's cleared flag changes."],
              [
                "created",
                "New transactions only",
                "Transactions created from this statement start out cleared.",
              ],
              [
                "reconciled",
                "Everything this statement confirms",
                "Also clears matched transactions that are not cleared yet — the point of reconciling, but it turns rows needing no change into writes.",
              ],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2 text-xs">
              <input
                type="radio"
                name="cleared-target"
                className="mt-0.5"
                checked={applyConfig.clearedTarget === value}
                onChange={() => onApplyConfigChange({ ...applyConfig, clearedTarget: value })}
              />
              <span>
                {label}
                <span className="block text-[11px] text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Transactions already cleared, or already reconciled in Actual, are left untouched — the
          count above only ever includes writes that change something.
        </p>
      </section>

      {counts.create > 0 && (
        <section className="rounded-md border border-border/60 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            New transactions
          </h3>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs">Put the bank&apos;s description in</legend>
            {(
              [
                ["payee", "The payee", "What a merchant name normally is."],
                [
                  "notes",
                  "The notes",
                  "Keeps a curated payee list free of raw bank text — and gives your rules something to read.",
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label key={value} className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  name="description-target"
                  className="mt-0.5"
                  checked={applyConfig.descriptionTarget === value}
                  onChange={() => onApplyConfigChange({ ...applyConfig, descriptionTarget: value })}
                />
                <span>
                  {label}
                  <span className="block text-[11px] text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="mt-2 text-[11px] text-muted-foreground">
            A payee or note you set on a row yourself is always kept — this only decides where the
            description goes when you have not.
          </p>
        </section>
      )}

      {fieldCounts.size > 0 && (
        <section className="rounded-md border border-border/60 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What the updates change
          </h3>
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
            {[...fieldCounts].map(([field, count]) => (
              <div key={field} className="flex gap-1.5">
                <dt className="text-muted-foreground">{FIELD_LABELS[field] ?? field}</dt>
                <dd className="font-medium tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {plan.operations.length > 0 && (
        <section className="rounded-md border border-border/60">
          <h3 className="border-b border-border/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Every change, in the order it will run
          </h3>
          <ul className="divide-y divide-border/30 text-xs">
            {plan.operations.map((operation) => {
              const row =
                operation.kind === "create"
                  ? statementRows.get(operation.statementRowId)
                  : undefined;
              const transaction =
                operation.kind === "create"
                  ? undefined
                  : transactions.get(operation.transactionId);

              return (
                <li key={operation.id} className="flex items-start gap-3 px-3 py-2">
                  <span
                    className={cn(
                      "w-14 shrink-0 font-medium",
                      operation.kind === "delete"
                        ? "text-destructive"
                        : operation.kind === "create"
                          ? "text-sky-600 dark:text-sky-400"
                          : "text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {operation.kind === "create"
                      ? "Create"
                      : operation.kind === "delete"
                        ? "Delete"
                        : "Update"}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {row?.description ?? transaction?.payeeName ?? transaction?.notes ?? "—"}
                    </span>
                    {operation.kind === "update" && (
                      <span className="block text-muted-foreground">
                        {stagedFields(operation.patch)
                          .map((field) => {
                            const entry = operation.patch[field];
                            if (!entry) return null;
                            if (field === "amount") {
                              return `Amount ${formatMinorUnits(
                                entry.original as number
                              )} → ${formatMinorUnits(entry.staged as number)}`;
                            }
                            return FIELD_LABELS[field] ?? field;
                          })
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>

                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {operation.kind === "create"
                      ? formatMinorUnits(operation.amount)
                      : formatMinorUnits(transaction?.amount ?? operation.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

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

      {plan.unresolved > 0 && (
        <p className="text-xs text-muted-foreground">
          {plan.unresolved} row{plan.unresolved === 1 ? "" : "s"} still have no decision. They will
          be left exactly as they are — you can come back to them.
        </p>
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

      <div className="flex items-center justify-end gap-2 border-t border-border/50 pt-3">
        <Button variant="ghost" onClick={onBack} disabled={isApplying}>
          Cancel
        </Button>
        <Button onClick={onApply} disabled={isApplying || total === 0}>
          {isApplying && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          {total === 0
            ? "Nothing to apply"
            : `Apply ${total} change${total === 1 ? "" : "s"}`}
        </Button>
      </div>
    </div>
  );
}

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
    <div className="rounded-md border border-border/60 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
        {label}
      </div>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums",
          destructive && value > 0 && "text-destructive",
          muted && "text-muted-foreground"
        )}
      >
        {value}
      </p>
    </div>
  );
}
