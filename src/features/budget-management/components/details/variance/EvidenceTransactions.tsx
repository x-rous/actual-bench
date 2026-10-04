"use client";

import { cn } from "@/lib/utils";
import type { BudgetTransactionRow } from "../../../lib/budgetTransactionsQuery";
import { formatTransactionDateLabel } from "../../../lib/budgetTransactionTable";
import {
  displayAmount,
  TRANSACTION_SIGNAL_LABELS,
  transactionSignals,
  type TransactionSignal,
  type VarianceModel,
} from "../../../lib/varianceInvestigation";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { FAVOURABLE_TEXT } from "./useChartFrame";

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  rows: BudgetTransactionRow[];
  /** First load, with nothing to show yet. */
  isLoading: boolean;
  /** A later page is loading; the rows stay on screen, dimmed. */
  isFetching: boolean;
  error: unknown;
  /** The budget payload's figure each row is a share of. */
  denominator: number;
  /** Selecting a transaction's category selects the driver it belongs to. */
  onSelectCategory: (categoryId: string) => void;
};

const SIGNAL_TONE: Record<TransactionSignal, string> = {
  unbudgeted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  refund: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  largest: "bg-muted text-muted-foreground",
  "deficit-month": "bg-destructive/10 text-destructive",
};

/**
 * The largest transactions in view. Presentational: the panel owns the query,
 * so its caption and "Show more" can sit where the toggles are.
 */
export function EvidenceTransactions({ model, format, rows, isLoading, isFetching, error, denominator, onSelectCategory }: Props) {
  const catName = new Map(model.categories.map((c) => [c.id, c.name]));
  return (
    <div className={cn("overflow-x-auto rounded-md border border-border", isFetching && rows.length > 0 && "opacity-60")}>
      <table className="w-full min-w-[30rem] border-collapse text-xs">
        <thead className="bg-muted text-[10.5px] uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2.5 py-1.5 text-left font-semibold">Date</th>
            <th className="px-2.5 py-1.5 text-left font-semibold">Payee</th>
            <th className="px-2.5 py-1.5 text-left font-semibold">Category</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Amount</th>
            <th className="px-2.5 py-1.5 text-right font-semibold">Share</th>
            <th className="px-2.5 py-1.5 text-left font-semibold">Signal</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && rows.length === 0
            ? Array.from({ length: 5 }, (_, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td colSpan={6} className="px-2.5 py-2">
                    <span className="block h-3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
                  </td>
                </tr>
              ))
            : rows.map((row, rank) => {
                const amount = displayAmount(model.side, row.amount);
                const signals = transactionSignals(model, row, rank);
                const name = (row.categoryId && catName.get(row.categoryId)) || row.categoryName || "Uncategorized";
                return (
                  <tr key={row.id} className="border-t border-border/60">
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-muted-foreground" title={row.date}>{formatTransactionDateLabel(row.date)}</td>
                    <td className="max-w-[11rem] truncate px-2.5 py-1.5 font-medium" title={row.payeeName ?? "No payee"}>
                      {row.payeeName ?? <span className="italic text-muted-foreground">No payee</span>}
                    </td>
                    <td className="max-w-[12rem] truncate px-2.5 py-1.5">
                      {row.categoryId ? (
                        <button type="button" onClick={() => onSelectCategory(row.categoryId!)} className="max-w-full truncate text-muted-foreground hover:text-foreground hover:underline" title={`Select ${name}`}>
                          {name}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">{name}</span>
                      )}
                    </td>
                    <td className={cn("whitespace-nowrap px-2.5 py-1.5 text-right font-semibold tabular-nums", amount < 0 && FAVOURABLE_TEXT)}>
                      {amount < 0 ? "−" : ""}{format.exact(amount)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums text-muted-foreground">
                      {denominator > 0 && amount > 0 ? `${Math.round((amount / denominator) * 100)}%` : "–"}
                    </td>
                    <td className="px-2.5 py-1.5">
                      {signals.length === 0 ? (
                        <span className="text-muted-foreground" aria-label="No signal">–</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {signals.slice(0, 2).map((signal) => (
                            <span key={signal} className={cn("whitespace-nowrap rounded-full px-2 py-px text-[10.5px] font-semibold", SIGNAL_TONE[signal])}>
                              {TRANSACTION_SIGNAL_LABELS[signal]}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
          {!isLoading && rows.length === 0 && !error && (
            <tr><td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">No transactions in this view.</td></tr>
          )}
          {error ? (
            <tr><td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">Could not load transactions. The budget figures are unaffected.</td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
