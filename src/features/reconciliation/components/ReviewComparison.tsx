"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ApplyPlan } from "@/lib/reconciliation/apply/operations";
import type { ApplyConfig } from "@/lib/reconciliation/session/plan";
import { prospectiveTransaction } from "@/lib/reconciliation/session/prospective";
import { stagedFields } from "@/lib/reconciliation/session/staging";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { formatMinorUnits, formatShortDate } from "../lib/format";
import type { Option } from "./StagedFields";

/**
 * Statement row by statement row, what it will look like in the budget.
 *
 * The operation list answers "what will run". This answers "what will my
 * statement look like afterwards", which is the question someone about to write
 * to their own budget is actually asking. Both are needed, and neither
 * substitutes for the other.
 *
 * One line per row, values shown as they will end up, with anything that
 * changes marked and carrying its previous value. Reproducing the workbench
 * here would only make the reader hunt for the difference twice.
 */

type ReviewRow = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  transaction: ActualTransactionSnapshot | undefined;
  action: "create" | "update" | "delete" | "unchanged" | "later";
  pending: ReturnType<typeof prospectiveTransaction>;
  changedFields: Set<string>;
};

const ACTION_LABELS: Record<ReviewRow["action"], string> = {
  create: "Create",
  update: "Update",
  delete: "Delete",
  unchanged: "No change",
  later: "Left for later",
};

const ACTION_TONES: Record<ReviewRow["action"], string> = {
  create: "text-sky-600 dark:text-sky-400",
  update: "text-amber-600 dark:text-amber-400",
  delete: "text-destructive",
  unchanged: "text-muted-foreground",
  later: "text-muted-foreground",
};

/** A value that will change, shown as it will be, carrying what it was. */
function Changed({
  changed,
  was,
  children,
}: {
  changed: boolean;
  was?: string | null;
  children: React.ReactNode;
}) {
  if (!changed) return <>{children}</>;
  return (
    <span
      className="text-amber-600 dark:text-amber-400"
      title={was ? `was: ${was}` : "not set before"}
    >
      {children}
    </span>
  );
}

export type ReviewComparisonProps = {
  plan: ApplyPlan;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  payees: Option[];
  categories: Option[];
  applyConfig: ApplyConfig;
};

export function ReviewComparison({
  plan,
  items,
  statementRows,
  transactions,
  payees,
  categories,
  applyConfig,
}: ReviewComparisonProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const nameOf = (options: Option[], id: string | null) =>
    id ? options.find((option) => option.id === id)?.name ?? null : null;

  const rows = useMemo<ReviewRow[]>(() => {
    const operationByItem = new Map(plan.operations.map((operation) => [operation.itemId, operation]));

    const built = items.map((item) => {
      const statementRow = statementRows.get(item.statementRowIds[0] ?? "");
      const transaction = transactions.get(item.actualTransactionIds[0] ?? "");
      const operation = operationByItem.get(item.id);

      const action: ReviewRow["action"] = operation
        ? operation.kind
        : item.disposition === "unresolved"
          ? "later"
          : "unchanged";

      const changedFields = new Set<string>(stagedFields(item.stagedChanges));
      if (operation?.kind === "update" && operation.cleared) changedFields.add("cleared");

      return {
        item,
        statementRow,
        transaction,
        action,
        pending: prospectiveTransaction({ item, statementRow, transaction, applyConfig }),
        changedFields,
      };
    });

    // Statement order, so the reader can follow their own document down the
    // page rather than reconciling two orderings in their head.
    return built.sort((a, b) => {
      const left = a.statementRow?.postedDate ?? a.transaction?.date ?? "";
      const right = b.statementRow?.postedDate ?? b.transaction?.date ?? "";
      if (left !== right) return left < right ? -1 : 1;
      return (a.statementRow?.sourceRowNumber ?? 0) - (b.statementRow?.sourceRowNumber ?? 0);
    });
  }, [plan, items, statementRows, transactions, applyConfig]);

  const changing = rows.filter((row) => row.action !== "unchanged" && row.action !== "later");
  const quiet = rows.filter((row) => row.action === "unchanged" || row.action === "later");
  const visible = showUnchanged ? rows : changing;

  return (
    <section className="rounded-md border border-border/60">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your statement, after applying
        </h3>
        {quiet.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={showUnchanged}
              onChange={(event) => setShowUnchanged(event.target.checked)}
            />
            Also show the {quiet.length} rows nothing happens to
          </label>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">
            Each statement row and the transaction it will correspond to after applying
          </caption>
          <thead className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr className="border-b border-border/30">
              <th scope="colgroup" colSpan={3} className="px-2 pt-1.5 text-left font-semibold">
                Bank statement
              </th>
              <th scope="col" className="border-x border-border/40 px-2 pt-1.5 text-left font-semibold">
                Will
              </th>
              <th scope="colgroup" colSpan={5} className="px-2 pt-1.5 text-left font-semibold">
                Resulting transaction in Actual
              </th>
            </tr>
            <tr className="border-b border-border/50">
              <th scope="col" className="w-14 px-2 pb-1.5 text-left font-medium">Date</th>
              <th scope="col" className="px-2 pb-1.5 text-left font-medium">Description</th>
              <th scope="col" className="w-24 px-2 pb-1.5 text-right font-medium">Amount</th>
              <th scope="col" className="w-20 border-x border-border/40 px-2 pb-1.5 text-left font-medium">
                Action
              </th>
              <th scope="col" className="w-14 px-2 pb-1.5 text-left font-medium">Date</th>
              <th scope="col" className="w-40 px-2 pb-1.5 text-left font-medium">Payee</th>
              <th scope="col" className="px-2 pb-1.5 text-left font-medium">Notes</th>
              <th scope="col" className="w-36 px-2 pb-1.5 text-left font-medium">Category</th>
              <th scope="col" className="w-24 px-2 pb-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const deleted = row.action === "delete";
              const payeeName = nameOf(payees, row.pending.payeeId);
              const categoryName = nameOf(categories, row.pending.categoryId);

              return (
                <tr key={row.item.id} className="border-b border-border/20">
                  <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
                    {row.statementRow ? formatShortDate(row.statementRow.postedDate) : "—"}
                  </td>
                  <td
                    className="max-w-0 truncate px-2 py-1"
                    title={row.statementRow?.description}
                  >
                    {row.statementRow?.description ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                    {row.statementRow ? formatMinorUnits(row.statementRow.amount) : "—"}
                  </td>

                  <td
                    className={cn(
                      "whitespace-nowrap border-x border-border/40 px-2 py-1 font-medium",
                      ACTION_TONES[row.action]
                    )}
                  >
                    {ACTION_LABELS[row.action]}
                  </td>

                  {deleted ? (
                    <td colSpan={5} className="px-2 py-1 text-muted-foreground line-through">
                      {row.transaction?.payeeName ?? row.transaction?.notes ?? "This transaction"}{" "}
                      · {formatMinorUnits(row.transaction?.amount ?? 0)}
                    </td>
                  ) : (
                    <>
                      <td className="whitespace-nowrap px-2 py-1 tabular-nums text-muted-foreground">
                        <Changed changed={row.changedFields.has("date")} was={row.transaction?.date}>
                          {row.pending.date ? formatShortDate(row.pending.date) : "—"}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={payeeName ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("payeeId")}
                          was={row.transaction?.payeeName}
                        >
                          {payeeName ??
                            (row.pending.isNew && applyConfig.descriptionTarget === "payee"
                              ? row.statementRow?.description ?? "—"
                              : "—")}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={row.pending.notes ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("notes")}
                          was={row.transaction?.notes}
                        >
                          {row.pending.notes ?? "—"}
                        </Changed>
                      </td>
                      <td className="max-w-0 truncate px-2 py-1" title={categoryName ?? undefined}>
                        <Changed
                          changed={row.changedFields.has("categoryId")}
                          was={row.transaction?.categoryName}
                        >
                          {categoryName ?? "—"}
                        </Changed>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1 text-right tabular-nums">
                        <Changed
                          changed={row.changedFields.has("amount")}
                          was={
                            row.transaction ? formatMinorUnits(row.transaction.amount) : undefined
                          }
                        >
                          {row.pending.amount !== null ? formatMinorUnits(row.pending.amount) : "—"}
                        </Changed>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>

        {visible.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing will change in your budget.
          </p>
        )}
      </div>

      <p className="border-t border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
        Values in amber are changing — hover one to see what it is now. Everything else is shown as
        it already stands.
      </p>
    </section>
  );
}
