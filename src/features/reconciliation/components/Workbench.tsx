"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { REASON } from "@/lib/reconciliation/session/build";
import type { ReconciliationCoverage } from "@/lib/reconciliation/session/build";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "@/lib/reconciliation/types";
import { Inspector } from "./Inspector";
import { WorkbenchRow } from "./WorkbenchRow";

/**
 * Screen 3 — the reconciliation workbench (UX §7).
 *
 * Header, filters, search, the synchronized Bank | Match | Actual grid, and the
 * inspector. Read-only in this milestone: dispositions and staged edits arrive
 * with the apply pipeline, so nothing here can change the budget.
 */

type FilterId = "all" | "needs-review" | "create" | "actual-only" | "duplicates" | "matched";

const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-review", label: "Needs review" },
  { id: "create", label: "Not in Actual" },
  { id: "actual-only", label: "Actual only" },
  { id: "duplicates", label: "Duplicates" },
  { id: "matched", label: "Matched" },
];

function matchesFilter(item: ReconciliationItem, filter: FilterId): boolean {
  switch (filter) {
    case "matched":
      return item.disposition === "matched";
    case "needs-review":
      return (
        item.disposition === "unresolved" &&
        (item.reasonCode === REASON.ambiguousMatch ||
          item.reasonCode === REASON.belowConfidenceFloor)
      );
    case "create":
      return item.reasonCode === REASON.noActualCandidate;
    case "actual-only":
      return item.reasonCode === REASON.notOnStatement;
    case "duplicates":
      return item.reasonCode === REASON.likelyDuplicate;
    default:
      return true;
  }
}

function percent(part: number, whole: number): string {
  if (whole === 0) return "100%";
  return `${Math.round((part / whole) * 1000) / 10}%`;
}

export type WorkbenchProps = {
  accountName: string;
  statementName: string | null;
  period: { start: string; end: string } | null;
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  coverage: ReconciliationCoverage;
};

export function Workbench({
  accountName,
  statementName,
  period,
  items,
  statementRows,
  transactions,
  coverage,
}: WorkbenchProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const counts = useMemo(() => {
    const result = {} as Record<FilterId, number>;
    for (const { id } of FILTERS) {
      result[id] = items.filter((item) => matchesFilter(item, id)).length;
    }
    return result;
  }, [items]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return items.filter((item) => {
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
  }, [items, filter, search, statementRows, transactions]);

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

        {/*
          Two independent completeness numbers. A single "96.8% matched" figure
          hides an unexplained Actual side, so both are always visible.
        */}
        <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Statement rows resolved</dt>
            <dd className="font-medium tabular-nums">
              {coverage.statementRowsResolved} / {coverage.statementRows} (
              {percent(coverage.statementRowsResolved, coverage.statementRows)})
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Actual transactions explained</dt>
            <dd className="font-medium tabular-nums">
              {coverage.actualTransactionsExplained} / {coverage.actualTransactions} (
              {percent(coverage.actualTransactionsExplained, coverage.actualTransactions)})
            </dd>
          </div>
        </dl>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-4 py-2">
        <div role="group" aria-label="Filter reconciliation rows" className="flex flex-wrap gap-1">
          {FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={filter === entry.id}
              onClick={() => setFilter(entry.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs transition-colors",
                filter === entry.id
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50"
              )}
            >
              {entry.label}
              <span className="ml-1 tabular-nums opacity-70">{counts[entry.id]}</span>
            </button>
          ))}
        </div>

        <div className="relative ml-auto">
          <Search
            className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search description, payee, amount…"
            aria-label="Search reconciliation rows"
            className="h-8 w-64 pl-7 text-xs"
          />
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full table-fixed border-collapse">
            <caption className="sr-only">
              Bank statement rows matched against Actual transactions
            </caption>
            <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b border-border/50">
                <th scope="col" className="w-[38%] px-3 py-2 text-left font-medium">
                  Bank statement
                </th>
                <th scope="col" className="w-[24%] px-3 py-2 text-left font-medium">
                  Match
                </th>
                <th scope="col" className="w-[38%] px-3 py-2 text-left font-medium">
                  Actual
                </th>
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
              No rows match this filter.
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
