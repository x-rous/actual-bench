"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileCheck, RefreshCw, Search, SlidersHorizontal, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiPillGroup, PillGroup } from "@/components/ui/pill-group";
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
import type { StageableField } from "@/lib/reconciliation/session/staging";
import type { ReconciliationDisposition } from "@/lib/reconciliation/types";
import type { Option } from "./StagedFields";
import type { TransformContext } from "@/lib/reconciliation/transform/rules";
import type { StagedPatch } from "@/lib/reconciliation/types";
import { useTableSelection } from "@/hooks/useTableSelection";
import { BulkDecisionBar } from "./BulkDecisionBar";
import { CoverageSummary } from "./CoverageSummary";
import { Inspector } from "./Inspector";
import { MatchOptions } from "./MatchOptions";
import { TransformDialog } from "./TransformDialog";
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

/**
 * A second axis: where the row stands in the user's own workflow, rather than
 * what the matcher concluded about it. "What is left for me to do" is a
 * different question from "what kind of problem is this".
 */
type DecisionFilter = "any" | "undecided" | "decided" | "edited";

const DECISION_FILTERS: { id: DecisionFilter; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "undecided", label: "Undecided" },
  { id: "decided", label: "Decided" },
  { id: "edited", label: "Edited" },
];

function matchesDecisionFilter(item: ReconciliationItem, filter: DecisionFilter): boolean {
  const edited = Boolean(item.stagedChanges && Object.keys(item.stagedChanges).length > 0);
  switch (filter) {
    case "undecided":
      return item.disposition === "unresolved";
    case "decided":
      // An automatic match is not a decision anyone took.
      return item.disposition !== "unresolved" && !(
        item.disposition === "matched" && item.match?.evidenceSource !== "manual"
      );
    case "edited":
      return edited;
    default:
      return true;
  }
}

/**
 * Attributes worth filtering on mid-reconciliation. Deliberately few: these are
 * the ones that identify work — rows needing cleanup, and rows that are
 * protected and therefore cannot be actioned here.
 */
type AttributeFilter = "no-payee" | "no-category" | "protected";

const ATTRIBUTE_FILTERS: { id: AttributeFilter; label: string }[] = [
  { id: "no-payee", label: "No payee" },
  { id: "no-category", label: "No category" },
  { id: "protected", label: "Protected" },
];

function matchesAttributes(
  item: ReconciliationItem,
  active: Set<AttributeFilter>,
  transactions: Map<string, ActualTransactionSnapshot>
): boolean {
  if (active.size === 0) return true;
  const transaction = transactions.get(item.actualTransactionIds[0] ?? "");

  if (active.has("no-payee") && transaction?.payeeName) return false;
  if (active.has("no-category") && transaction?.categoryId) return false;
  if (
    active.has("protected") &&
    !item.guards.protectedReconciled &&
    !item.guards.splitParent &&
    item.guards.transfer === "no"
  ) {
    return false;
  }
  return true;
}

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
  items: ReconciliationItem[];
  statementRows: Map<string, StatementRow>;
  transactions: Map<string, ActualTransactionSnapshot>;
  coverage: ReconciliationCoverage;
  matchConfig: MatchConfig;
  matchPreset: TextTargetPreset;
  isMatching: boolean;
  canRematch: boolean;
  /**
   * Why re-running is refused, when it is. Present rather than a bare disabled
   * button, because "why can I not do this" is the next question.
   */
  rematchBlockedReason?: string | null;
  payees: Option[];
  categories: Option[];
  onMatchConfigChange: (preset: TextTargetPreset, config: MatchConfig) => void;
  onRematch: () => void;
  onDisposition: (itemId: string, disposition: ReconciliationDisposition) => void;
  onUseCandidate: (itemId: string, transactionId: string | null) => void;
  onCorrectAmount: (itemId: string, transactionId: string, amount: number) => void;
  onStage: (itemId: string, field: StageableField, value: string | null) => void;
  onUnstage: (itemId: string, field: StageableField) => void;
  onBulkDisposition: (itemIds: string[], disposition: ReconciliationDisposition) => void;
  onBulkCorrectAmount: (
    entries: { itemId: string; transactionId: string; amount: number }[]
  ) => void;
  /** Writes the plan would make, named on the button rather than a row count. */
  changeCount: number;
  /** Set when this session has already been applied, so its outcome is reachable. */
  onViewResult?: () => void;
  onReview: () => void;
  transformContextFor: (item: ReconciliationItem) => TransformContext;
  onTransform: (changes: { itemId: string; patch: StagedPatch | undefined }[]) => void;
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
  items,
  statementRows,
  transactions,
  coverage,
  matchConfig,
  matchPreset,
  isMatching,
  canRematch,
  rematchBlockedReason,
  payees,
  categories,
  onMatchConfigChange,
  onRematch,
  onDisposition,
  onUseCandidate,
  onCorrectAmount,
  onStage,
  onUnstage,
  onBulkDisposition,
  onBulkCorrectAmount,
  changeCount,
  onViewResult,
  onReview,
  transformContextFor,
  onTransform,
}: WorkbenchProps) {
  const [filter, setFilter] = useState<FilterId>("all");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("any");
  const [attributeFilters, setAttributeFilters] = useState<Set<AttributeFilter>>(new Set());
  const [search, setSearch] = useState("");
  const { selectedIds, toggleSelect, toggleSelectAll, clearSelection } = useTableSelection();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [transformOpen, setTransformOpen] = useState(false);

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
      if (!matchesDecisionFilter(item, decisionFilter)) return false;
      if (!matchesAttributes(item, attributeFilters, transactions)) return false;
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
  }, [sorted, filter, decisionFilter, attributeFilters, search, statementRows, transactions]);

  const visibleIds = useMemo(() => visible.map((item) => item.id), [visible]);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.has(item.id)),
    [items, selectedIds]
  );

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  );

  /**
   * Move the selection by keyboard.
   *
   * A few hundred rows is a lot of mousing, and the work is inherently
   * sequential: look at a row, decide, move on. j/k and the arrow keys follow
   * the visible order, so the filter in force defines what "next" means.
   */
  const step = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const index = visible.findIndex((item) => item.id === selectedId);
      const next = index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta));
      setSelectedId(visible[next].id);
    },
    [visible, selectedId]
  );

  /** Jump to the next row still waiting on a decision. */
  const goToNextUndecided = useCallback(() => {
    const index = visible.findIndex((item) => item.id === selectedId);
    const after = visible.slice(index + 1).find((item) => item.disposition === "unresolved");
    const wrapped = after ?? visible.find((item) => item.disposition === "unresolved");
    if (wrapped) setSelectedId(wrapped.id);
  }, [visible, selectedId]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never steal a key from someone typing in the search box or a note.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        step(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "n") {
        event.preventDefault();
        goToNextUndecided();
      } else if (event.key === "Escape") {
        setSelectedId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [step, goToNextUndecided]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* The session's identity now sits beside the page title, so this row
          carries only what changes as you work. */}
      <header className="border-b border-border/50 px-4 py-2">
        <CoverageSummary coverage={coverage} />
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
          {/* Beside the actions rather than on a row of its own: full width, it
              cost a line of vertical space to hold a field nobody types more
              than a few characters into. */}
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search rows…"
              aria-label="Search reconciliation rows"
              className="h-7 w-72 pl-7 text-xs"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={transformOpen}
            onClick={() => setTransformOpen((open) => !open)}
          >
            <Wand2 className="mr-1 h-3.5 w-3.5" />
            Transform
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
            Matching
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!canRematch || isMatching || Boolean(rematchBlockedReason)}
            title={rematchBlockedReason ?? undefined}
            onClick={onRematch}
          >
            <RefreshCw className={cn("mr-1 h-3.5 w-3.5", isMatching && "animate-spin")} />
            {isMatching ? "Matching…" : "Re-run"}
          </Button>
          {/* An applied session's outcome is a record worth being able to
              return to — what was written, what failed, what can be retried. */}
          {onViewResult && (
            <Button size="sm" variant="outline" onClick={onViewResult}>
              <FileCheck className="mr-1 h-3.5 w-3.5" />
              What was applied
            </Button>
          )}
          {/* Named in changes, not rows: most of a reconciliation needs no
              write, and offering to "apply 248" when 12 will change is how a
              user stops trusting the numbers. */}
          <Button size="sm" disabled={changeCount === 0} onClick={onReview}>
            {changeCount === 0
              ? "Nothing to review"
              : `Review ${changeCount} change${changeCount === 1 ? "" : "s"}`}
          </Button>
        </div>
      </div>

      {/* Segmented controls rather than loose buttons, matching the other list
          pages: the grouping is what tells the reader these are two separate
          questions — one answer to the first, any number to the second. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 bg-muted/10 px-4 py-1.5 text-xs">
        <span className="text-muted-foreground">Progress</span>
        <PillGroup
          options={DECISION_FILTERS.map((entry) => ({ value: entry.id, label: entry.label }))}
          value={decisionFilter}
          onChange={setDecisionFilter}
        />

        <span className="ml-2 text-muted-foreground">Show only</span>
        <MultiPillGroup
          options={ATTRIBUTE_FILTERS.map((entry) => ({ value: entry.id, label: entry.label }))}
          values={[...attributeFilters]}
          onChange={(next) => setAttributeFilters(new Set(next))}
          emptyMeansAll={false}
        />

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={goToNextUndecided}>
            Next undecided
            <kbd className="ml-1.5 rounded border border-border px-1 text-[10px]">n</kbd>
          </Button>
          <span className="tabular-nums text-muted-foreground">
            {visible.length} of {items.length} rows
          </span>
        </div>
      </div>

      {transformOpen && (
        <TransformDialog
          items={items}
          selectedIds={selectedIds}
          contextFor={transformContextFor}
          payees={payees}
          onClose={() => setTransformOpen(false)}
          onApply={(changes) => {
            onTransform(changes);
            clearSelection();
          }}
        />
      )}

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
            {/*
              Two sides, and Date and Amount appear on both, so the split is
              carried by the group headings, a band down the statement's columns,
              and a solid divider between them.

              Every cell paints its own **opaque** background. A background on
              the `<thead>` is not painted under `border-collapse`, and a
              translucent one lets the rows scroll through underneath — both of
              which leave a sticky header with body text showing through it.
            */}
            <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="w-8 bg-muted px-2 pt-2" />
                <th
                  scope="colgroup"
                  colSpan={3}
                  className="bg-muted px-2 pt-2 text-left font-semibold text-foreground"
                >
                  From the bank statement
                </th>
                <th
                  scope="col"
                  className="border-x border-border bg-background px-2 pt-2 text-left font-semibold text-foreground"
                >
                  Match
                </th>
                <th
                  scope="colgroup"
                  colSpan={4}
                  className="bg-background px-2 pt-2 text-left font-semibold text-foreground"
                >
                  In Actual
                </th>
              </tr>
              <tr>
                <th scope="col" className="w-8 border-b border-border bg-muted px-2 pb-2">
                  <input
                    type="checkbox"
                    aria-label={
                      allVisibleSelected ? "Deselect all visible rows" : "Select all visible rows"
                    }
                    checked={allVisibleSelected}
                    onChange={() => toggleSelectAll(visibleIds, allVisibleSelected)}
                  />
                </th>
                <th scope="col" className="w-14 border-b border-border bg-muted px-2 pb-2 text-left font-medium">
                  Date
                </th>
                <th scope="col" className="border-b border-border bg-muted px-2 pb-2 text-left font-medium">
                  Description
                </th>
                <th scope="col" className="w-24 border-b border-border bg-muted px-2 pb-2 text-right font-medium">
                  Amount
                </th>
                <th
                  scope="col"
                  className="w-40 border-x border-b border-border bg-background px-2 pb-2 text-left font-medium"
                >
                  Result
                </th>
                <th scope="col" className="w-14 border-b border-border bg-background px-2 pb-2 text-left font-medium">
                  Date
                </th>
                <th scope="col" className="w-[18%] border-b border-border bg-background px-2 pb-2 text-left font-medium">
                  Payee
                </th>
                <th scope="col" className="border-b border-border bg-background px-2 pb-2 text-left font-medium">
                  Notes
                </th>
                <th scope="col" className="w-24 border-b border-border bg-background px-2 pb-2 text-right font-medium">
                  Amount
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
                  checked={selectedIds.has(item.id)}
                  onToggleChecked={(checked) => toggleSelect(item.id, checked)}
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
            payees={payees}
            categories={categories}
            onClose={() => setSelectedId(null)}
            onDisposition={(disposition) => onDisposition(selected.id, disposition)}
            onUseCandidate={(transactionId) => onUseCandidate(selected.id, transactionId)}
            onCorrectAmount={(transactionId, amount) =>
              onCorrectAmount(selected.id, transactionId, amount)
            }
            onStage={(field, value) => onStage(selected.id, field, value)}
            onUnstage={(field) => onUnstage(selected.id, field)}
          />
        )}
      </div>

      <BulkDecisionBar
        selected={selectedItems}
        statementRows={statementRows}
        transactions={transactions}
        onClear={clearSelection}
        onBulkDisposition={(itemIds, disposition) => {
          onBulkDisposition(itemIds, disposition);
          clearSelection();
        }}
        onBulkCorrectAmount={(entries) => {
          onBulkCorrectAmount(entries);
          clearSelection();
        }}
      />
    </div>
  );
}
