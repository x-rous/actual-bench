"use client";

import { useMemo, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { REASON } from "@/lib/reconciliation/session/build";
import type { ReconciliationCoverage } from "@/lib/reconciliation/session/build";
import type {
  ActualTransactionSnapshot,
  MatchConfig,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import type { TextTargetPreset } from "@/lib/reconciliation/match/config";
import { CoverageSummary } from "./CoverageSummary";
import { Inspector } from "./Inspector";
import { MatchOptions } from "./MatchOptions";
import { WorkbenchRow } from "./WorkbenchRow";

/**
 * Screen 3 — the reconciliation workbench (UX §7).
 *
 * Header, filters, search, the synchronized Bank | Match | Actual grid, and the
 * inspector. Read-only in this milestone: dispositions and staged edits arrive
 * with the apply pipeline, so nothing here can change the budget.
 */

type FilterId =
  | "all"
  | "needs-review"
  | "ambiguous"
  | "amount-mismatch"
  | "wrong-amount"
  | "duplicates"
  | "create"
  | "matched"
  | "actual-only"
  | "outside-period";

type FilterDef = {
  id: FilterId;
  label: string;
  /** Dot colour, always paired with the label — never colour alone. */
  dot: string;
  /** Indented under the filter it refines. */
  child?: boolean;
};

/**
 * Filters for the statement's own rows, in the order a user works through them.
 *
 * "Needs review" is the parent of the three reasons a row lands there, so the
 * counts nest rather than double-count: a row whose amount differs is already
 * one of the rows needing review.
 */
const STATEMENT_FILTERS: FilterDef[] = [
  { id: "all", label: "All", dot: "bg-muted-foreground/40" },
  { id: "needs-review", label: "Needs review", dot: "bg-amber-500/70" },
  { id: "ambiguous", label: "Several candidates", dot: "bg-amber-500/40", child: true },
  { id: "amount-mismatch", label: "Amount differs", dot: "bg-amber-500/40", child: true },
  { id: "wrong-amount", label: "Amount looks wrong", dot: "bg-amber-500/40", child: true },
  { id: "duplicates", label: "Duplicates", dot: "bg-amber-500/40", child: true },
  { id: "create", label: "Not in Actual", dot: "bg-sky-500/60" },
  { id: "matched", label: "Matched", dot: "bg-emerald-500/70" },
];

/**
 * Rows that exist only in Actual. Kept visually apart because they are not part
 * of the statement's total: nothing here counts towards how much of the
 * statement is covered.
 */
const ACTUAL_ONLY_FILTERS: FilterDef[] = [
  { id: "actual-only", label: "Actual only", dot: "bg-violet-500/60" },
  { id: "outside-period", label: "Outside period", dot: "bg-muted-foreground/40" },
];

function matchesFilter(item: ReconciliationItem, filter: FilterId): boolean {
  switch (filter) {
    case "matched":
      return item.disposition === "matched";
    case "needs-review":
      return (
        item.disposition === "unresolved" &&
        (item.reasonCode === REASON.ambiguousMatch ||
          item.reasonCode === REASON.belowConfidenceFloor ||
          item.reasonCode === REASON.amountMismatch ||
          item.reasonCode === REASON.sameMerchantDate ||
          item.reasonCode === REASON.merchantCluster ||
          item.reasonCode === REASON.likelyDuplicate)
      );
    case "ambiguous":
      return (
        item.reasonCode === REASON.ambiguousMatch ||
        item.reasonCode === REASON.belowConfidenceFloor
      );
    case "amount-mismatch":
      return item.reasonCode === REASON.amountMismatch;
    case "wrong-amount":
      return (
        item.reasonCode === REASON.sameMerchantDate ||
        item.reasonCode === REASON.merchantCluster
      );
    case "duplicates":
      // A matched row can carry the duplicate flag; it belongs under Matched,
      // not under the work still to do.
      return item.disposition !== "matched" && item.reasonCode === REASON.likelyDuplicate;
    case "create":
      return item.reasonCode === REASON.noActualCandidate;
    case "actual-only":
      return item.reasonCode === REASON.notOnStatement;
    case "outside-period":
      return item.reasonCode === REASON.outsideStatementPeriod;
    default:
      return true;
  }
}

export type WorkbenchProps = {
  accountName: string;
  statementName: string | null;
  period: { start: string; end: string } | null;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  coverage: ReconciliationCoverage;
  matchConfig: MatchConfig;
  matchPreset: TextTargetPreset;
  isMatching: boolean;
  canRematch: boolean;
  onMatchConfigChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  onRematch: () => void;
};

function FilterButton({
  entry,
  active,
  count,
  onSelect,
}: {
  entry: FilterDef;
  active: boolean;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
        entry.child && "ml-1 text-[11px]",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/50",
        count === 0 && !active && "opacity-50"
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", entry.dot)} aria-hidden="true" />
      {entry.label}
      <span className="tabular-nums opacity-70">{count}</span>
    </button>
  );
}

export function Workbench({
  accountName,
  statementName,
  period,
  items,
  statementRows,
  transactions,
  coverage,
  matchConfig,
  matchPreset,
  isMatching,
  canRematch,
  onMatchConfigChange,
  onRematch,
}: WorkbenchProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const counts = useMemo(() => {
    const result = {} as Record<FilterId, number>;
    for (const { id } of [...STATEMENT_FILTERS, ...ACTUAL_ONLY_FILTERS]) {
      result[id] = items.filter((item) => matchesFilter(item, id)).length;
    }
    return result;
  }, [items]);

  /**
   * Sorted by transaction date, not by match status.
   *
   * The user reads this table to see what happened on a given day across both
   * sides, so grouping by outcome would scatter a single day's transactions.
   * The statement date leads where there is one; otherwise the Actual date
   * stands in, which keeps an Actual-only row next to the day it belongs to.
   */
  const sorted = useMemo(() => {
    const dateOf = (item: ReconciliationItem): string => {
      for (const id of item.statementRowIds) {
        const row = statementRows.get(id);
        if (row) return row.postedDate;
      }
      for (const id of item.actualTransactionIds) {
        const transaction = transactions.get(id);
        if (transaction) return transaction.date;
      }
      return "";
    };

    return [...items].sort((a, b) => {
      const left = dateOf(a);
      const right = dateOf(b);
      if (left !== right) return left < right ? -1 : 1;
      // Stable within a day: source order, then id.
      const leftRow = statementRows.get(a.statementRowIds[0] ?? "");
      const rightRow = statementRows.get(b.statementRowIds[0] ?? "");
      const leftSeq = leftRow?.sourceRowNumber ?? Number.MAX_SAFE_INTEGER;
      const rightSeq = rightRow?.sourceRowNumber ?? Number.MAX_SAFE_INTEGER;
      if (leftSeq !== rightSeq) return leftSeq - rightSeq;
      return a.id < b.id ? -1 : 1;
    });
  }, [items, statementRows, transactions]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return sorted.filter((item) => {
      if (!matchesFilter(item, filter)) return false;
      if (!needle) return true;

      // Search spans both sides plus the amount, since a user looking for a
      // transaction may remember the bank's wording or their own payee.
      const haystacks: string[] = [];
      for (const id of item.statementRowIds) {
        const row = statementRows.get(id);
        if (row) haystacks.push(row.description, row.reference ?? "", String(row.amount));
      }
      for (const id of item.actualTransactionIds) {
        const transaction = transactions.get(id);
        if (transaction) {
          haystacks.push(
            transaction.payeeName ?? "",
            transaction.importedPayee ?? "",
            transaction.notes ?? "",
            String(transaction.amount)
          );
        }
      }
      return haystacks.join(" ").toLowerCase().includes(needle);
    });
  }, [sorted, filter, search, statementRows, transactions]);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border/50 px-4 py-3">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-sm font-semibold">{accountName}</h2>
          {period && (
            <span className="text-xs text-muted-foreground">
              {period.start} → {period.end}
            </span>
          )}
          {statementName && (
            <span className="text-xs text-muted-foreground">· {statementName}</span>
          )}
        </div>

        <div className="mt-2">
          <CoverageSummary coverage={coverage} />
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2">
        <div role="group" aria-label="Filter statement rows" className="flex flex-wrap items-center gap-1">
          {STATEMENT_FILTERS.map((entry) => (
            <FilterButton
              key={entry.id}
              entry={entry}
              active={filter === entry.id}
              count={counts[entry.id]}
              onSelect={() => setFilter(entry.id)}
            />
          ))}
        </div>

        {/* Kept apart: nothing here counts towards the statement's coverage. */}
        <div
          role="group"
          aria-label="Filter transactions that are not on the statement"
          className="flex flex-wrap items-center gap-1 border-l border-border/60 pl-2"
        >
          {ACTUAL_ONLY_FILTERS.map((entry) => (
            <FilterButton
              key={entry.id}
              entry={entry}
              active={filter === entry.id}
              count={counts[entry.id]}
              onSelect={() => setFilter(entry.id)}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
            Matching
          </Button>
          <Button size="sm" disabled={!canRematch || isMatching} onClick={onRematch}>
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isMatching && "animate-spin")} />
            {isMatching ? "Matching…" : "Re-run"}
          </Button>
        </div>

        <div className="relative w-full">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search description, payee, amount…"
            aria-label="Search reconciliation rows"
            className="h-8 w-full pl-7 text-xs"
          />
        </div>
      </div>

      {optionsOpen && (
        <div className="border-b border-border/50 px-4 py-3">
          <MatchOptions config={matchConfig} preset={matchPreset} onChange={onMatchConfigChange} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            Changing these does not re-match on its own — choose Re-run when you are ready.
          </p>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Bank statement rows matched against Actual transactions
            </caption>
            <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/30">
                <th scope="colgroup" colSpan={3} className="px-2 pt-2 text-left font-semibold">
                  Bank statement
                </th>
                <th scope="col" className="border-x border-border/40 px-2 pt-2 text-left font-semibold">
                  Match
                </th>
                <th scope="colgroup" colSpan={4} className="px-2 pt-2 text-left font-semibold">
                  Actual
                </th>
              </tr>
              <tr className="border-b border-border/50">
                <th scope="col" className="w-14 px-2 pb-2 text-left font-medium">Date</th>
                <th scope="col" className="px-2 pb-2 text-left font-medium">Description</th>
                <th scope="col" className="w-24 px-2 pb-2 text-right font-medium">Amount</th>
                <th scope="col" className="w-40 border-x border-border/40 px-2 pb-2 text-left font-medium">
                  Result
                </th>
                <th scope="col" className="w-14 px-2 pb-2 text-left font-medium">Date</th>
                <th scope="col" className="w-[18%] px-2 pb-2 text-left font-medium">Payee</th>
                <th scope="col" className="px-2 pb-2 text-left font-medium">Notes</th>
                <th scope="col" className="w-24 px-2 pb-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <WorkbenchRow
                  key={item.id}
                  item={item}
                  statementRow={
                    item.statementRowIds[0] ? statementRows.get(item.statementRowIds[0]) : undefined
                  }
                  transactions={item.actualTransactionIds
                    .map((id) => transactions.get(id))
                    .filter((t): t is ActualTransactionSnapshot => Boolean(t))}
                  selected={item.id === selectedId}
                  onSelect={() => setSelectedId(item.id)}
                />
              ))}
            </tbody>
          </table>

          {visible.length === 0 && (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {items.length === 0
                ? "No matching has run for this session yet. Choose Re-run to match it against Actual."
                : "No rows match this filter."}
            </p>
          )}
        </div>

        {/* The inspector opens on selection and narrows the grid rather than
            permanently occupying space (UX §26). */}
        {selected && (
          <Inspector
            item={selected}
            statementRow={
              selected.statementRowIds[0]
                ? statementRows.get(selected.statementRowIds[0])
                : undefined
            }
            transactions={selected.actualTransactionIds
              .map((id) => transactions.get(id))
              .filter((t): t is ActualTransactionSnapshot => Boolean(t))}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  );
}
