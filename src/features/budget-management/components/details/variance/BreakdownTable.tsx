"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import {
  BREAKDOWN_SIGNAL_LABELS,
  buildCategoryBreakdown,
  buildMonthBreakdown,
  type BreakdownRow,
  type BreakdownSignal,
  type VarianceModel,
} from "../../../lib/varianceInvestigation";
import type { VarianceFormat } from "../../../lib/varianceInvestigation/varianceFormat";
import { FAVOURABLE_TEXT, UNFAVOURABLE_TEXT } from "./useChartFrame";

type Props = {
  model: VarianceModel;
  format: VarianceFormat;
  categoryIds: string[];
  /** The months the rows add up over (a month filter narrows this to one). */
  months: readonly string[];
  /** The months a by-month view lists: the period, or the recent months for a single month. */
  monthRows: readonly string[];
  /** A month to highlight in the by-month view. */
  highlightMonth: string | null;
  /** By category or by month; chosen in the panel's toggle row. */
  kind: "category" | "month";
};

type SortKey = "label" | "budget" | "actual" | "variance" | "cin" | "balance";

const SIGNAL_TONE: Partial<Record<BreakdownSignal, string>> = {
  unbudgeted: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "net-refund": "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  repeated: "bg-destructive/10 text-destructive",
  deficit: "bg-destructive/10 text-destructive",
  covered: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
};

function sortValue(row: BreakdownRow, key: SortKey): number | string {
  const env = row.aggregate.envelope;
  switch (key) {
    case "label": return row.month ?? row.label;
    case "budget": return row.aggregate.budget;
    case "actual": return row.aggregate.actual;
    case "variance": return row.aggregate.variance;
    case "cin": return env?.carriedIn ?? 0;
    case "balance": return env?.closing ?? 0;
  }
}

/**
 * Month figures for the selected driver: by category, or month by month.
 * Everything here comes from the monthly budget.
 */
export function BreakdownTable({ model, format, categoryIds, months, monthRows, highlightMonth, kind: effective }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "variance", dir: -1 });
  const envelope = model.mode === "envelope";
  const v = model.vocab;

  const rows = useMemo(() => {
    const built =
      effective === "category"
        ? buildCategoryBreakdown(model, categoryIds, months)
        : buildMonthBreakdown(model, categoryIds, monthRows);
    return built
      .map((row) => ({ ...row, label: row.month ? labelFor(row.month) : row.label }))
      .sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir;
      });
  }, [effective, model, categoryIds, months, monthRows, sort]);

  function head(key: SortKey, label: string, right = true) {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir < 0 ? "descending" : "ascending") : "none"}
        className={cn("px-2.5 py-1.5 font-semibold", right ? "text-right" : "text-left")}
      >
        <button
          type="button"
          onClick={() => setSort({ key, dir: active ? (sort.dir === 1 ? -1 : 1) : key === "label" ? 1 : -1 })}
          className="uppercase tracking-wide hover:text-foreground"
        >
          {label}{active ? (sort.dir < 0 ? " ↓" : " ↑") : ""}
        </button>
      </th>
    );
  }

  const wordFor = (variance: number) =>
    variance > 0 ? (model.side === "income" ? "short" : "over") : model.side === "income" ? "above" : envelope ? "unspent" : "under";

  return (
    <div className="min-w-0">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full min-w-[28rem] border-collapse text-xs">
          <thead className="bg-muted text-[10.5px] text-muted-foreground">
            <tr>
              {head("label", effective === "category" ? "Category" : "Month", false)}
              {head("budget", v.budget)}
              {head("actual", v.actual)}
              {envelope ? head("cin", "Carried in") : head("variance", "Variance")}
              {envelope && head("balance", "Balance")}
              <th scope="col" className="px-2.5 py-1.5 text-left font-semibold uppercase tracking-wide">Signal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const env = row.aggregate.envelope;
              const variance = row.aggregate.variance;
              return (
                <tr key={row.key} className={cn("border-t border-border/60", row.month && row.month === highlightMonth && "bg-primary/10")}>
                  <td className="px-2.5 py-1.5 font-medium">
                    {row.label}
                    {row.hidden && envelope && <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground">Hidden</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{format.money(row.aggregate.budget)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{format.money(row.aggregate.actual)}</td>
                  {envelope ? (
                    <>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{format.money(env?.carriedIn ?? 0)}</td>
                      <td className={cn("px-2.5 py-1.5 text-right tabular-nums", (env?.closing ?? 0) < 0 && UNFAVOURABLE_TEXT)}>
                        {(env?.closing ?? 0) < 0 ? "−" : ""}{format.money(env?.closing ?? 0)}
                      </td>
                    </>
                  ) : (
                    <td className={cn("px-2.5 py-1.5 text-right tabular-nums", variance > 0 ? UNFAVOURABLE_TEXT : variance < 0 ? FAVOURABLE_TEXT : "")}>
                      {variance === 0 ? "–" : `${format.money(variance)} ${wordFor(variance)}`}
                    </td>
                  )}
                  <td className="whitespace-nowrap px-2.5 py-1.5">
                    {row.signals.length === 0 ? (
                      <span className="text-muted-foreground" aria-label="No signal">–</span>
                    ) : (
                      <span className="flex gap-1">
                        {row.signals.map((signal) => (
                          <span key={signal} className={cn("rounded-full px-2 py-px text-[10.5px] font-semibold", SIGNAL_TONE[signal] ?? "bg-muted text-muted-foreground")}>
                            {BREAKDOWN_SIGNAL_LABELS[signal]}
                          </span>
                        ))}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-2.5 py-6 text-center text-muted-foreground">No rows for this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function labelFor(month: string): string {
  return formatMonthLabel(month, "long");
}
