"use client";

import { useState } from "react";
import { PillGroup } from "@/components/ui/pill-group";
import { cn } from "@/lib/utils";
import { useLargestTransactions } from "../../../hooks/useLargestTransactions";
import { formatTransactionDateLabel } from "../../../lib/budgetTransactionTable";
import {
  concentration,
  concentrationSize,
  displayAmount,
  hasMoreEvidence,
  nextEvidenceLimit,
  TRANSACTION_SIGNAL_LABELS,
  transactionSignals,
  type TransactionSignal,
  EVIDENCE_PAGE_SIZES,
  type VarianceModel,
} from "../../../lib/varianceInvestigation";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { FAVOURABLE_TEXT } from "./useChartFrame";

export type EvidenceScope = "driver" | "all";

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  scope: EvidenceScope;
  onScope: (scope: EvidenceScope) => void;
  /** Categories the "This driver" scope covers. */
  driverCategoryIds: string[];
  /** What "This driver" is called in the summary line. */
  driverLabel: string;
  monthStart: string;
  monthEnd: string;
  monthCount: number;
  /** The budget payload's figure the rows are measured against. */
  denominator: { driver: number; all: number };
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
 * The largest transactions in view, loaded on demand.
 *
 * A supporting view: every variance figure comes from the monthly budget, and
 * nothing here is summed into one. Eight rows load first; "Show more" asks for
 * the next page, and changing the driver, month or period starts again.
 */
export function EvidenceTransactions({
  model,
  format,
  scope,
  onScope,
  driverCategoryIds,
  driverLabel,
  monthStart,
  monthEnd,
  monthCount,
  denominator,
  onSelectCategory,
}: Props) {
  const [limit, setLimit] = useState<number>(EVIDENCE_PAGE_SIZES[0]);
  const categoryIds = scope === "driver" ? driverCategoryIds : model.categories.map((c) => c.id);
  const { data, isLoading, isFetching, error } = useLargestTransactions(
    { monthStart, monthEnd, categoryIds, side: model.side, limit },
    true
  );
  const base = scope === "driver" ? denominator.driver : denominator.all;
  const rows = data?.rows ?? [];
  const share = concentration(rows, model.side, base, concentrationSize(monthCount));
  const topN = Math.min(concentrationSize(monthCount), rows.length);
  const catName = new Map(model.categories.map((c) => [c.id, c.name]));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <PillGroup
          options={[
            { value: "driver", label: "This driver" },
            { value: "all", label: "Everything in view" },
          ]}
          value={scope}
          onChange={onScope}
        />
        <span className="text-[11px] tabular-nums text-muted-foreground" aria-live="polite">
          {error
            ? "Could not load transactions"
            : data
              ? `Largest ${rows.length}${data.total != null ? ` of ${data.total.toLocaleString()}` : ""}${share != null ? ` · Top ${topN} = ${Math.round(share * 100)}% of ${scope === "driver" ? driverLabel : "everything in view"} ${model.side === "income" ? "received" : "spend"}` : ""}`
              : "Loading the largest transactions…"}
        </span>
      </div>

      <div className={cn("max-h-[17rem] overflow-auto rounded-md border border-border", isFetching && data && "opacity-60")}>
        <table className="w-full min-w-[34rem] border-collapse text-xs">
          <thead className="sticky top-0 bg-muted text-[10.5px] uppercase tracking-wide text-muted-foreground">
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
            {isLoading && !data
              ? Array.from({ length: 6 }, (_, i) => (
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
                      <td className="max-w-[10rem] truncate px-2.5 py-1.5 font-medium" title={row.payeeName ?? "No payee"}>
                        {row.payeeName ?? <span className="italic text-muted-foreground">No payee</span>}
                      </td>
                      <td className="max-w-[10rem] truncate px-2.5 py-1.5">
                        {row.categoryId ? (
                          <button type="button" onClick={() => onSelectCategory(row.categoryId!)} className="truncate text-muted-foreground hover:text-foreground hover:underline" title={`Select ${name}`}>
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
                        {base > 0 && amount > 0 ? `${Math.round((amount / base) * 100)}%` : "–"}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5">
                        {signals.length === 0 ? (
                          <span className="text-muted-foreground" aria-label="No signal">–</span>
                        ) : (
                          <span className="flex gap-1">
                            {signals.slice(0, 2).map((signal) => (
                              <span key={signal} className={cn("rounded-full px-2 py-px text-[10.5px] font-semibold", SIGNAL_TONE[signal])}>
                                {TRANSACTION_SIGNAL_LABELS[signal]}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
            {data && rows.length === 0 && !error && (
              <tr><td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">No transactions in this view.</td></tr>
            )}
            {error ? (
              <tr><td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">The budget figures above are unaffected. Try again by changing the view.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {data && data.total != null && rows.length < data.total && hasMoreEvidence(limit) && (
        <button type="button" onClick={() => setLimit(nextEvidenceLimit(limit))} className="mt-1.5 w-full rounded py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          Show more ({rows.length} of {data.total.toLocaleString()})
        </button>
      )}
      <p className="mt-1.5 text-[10.5px] text-muted-foreground">
        Largest by amount. These rows are evidence only; the figures above come from the monthly budget and are not summed from them.
      </p>
    </div>
  );
}
