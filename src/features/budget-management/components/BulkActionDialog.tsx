"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useBulkAction,
  requiredSourceMonths,
  averageWindowLength,
  type BulkActionType,
  type BulkActionParams,
  type BulkPreviewRow,
} from "../hooks/useBulkAction";
import { addMonths, formatMonthLabel } from "@/lib/budget/monthMath";
import { parseBudgetExpression } from "../lib/budgetMath";
import { minorToDecimalString } from "../lib/format";
import { RotateCcw } from "lucide-react";

import type { ResolvedCell } from "../lib/budgetSelectionUtils";
import { formatCurrency as formatAmount, formatDelta } from "../lib/format";
import type { EnsureMonthsResult } from "../lib/ensureMonthsData";
import {
  collectSkips,
  describeAverageWindow,
  describeSkips,
  totalSkips,
  NO_SKIPS,
  type BulkSkips,
} from "../lib/bulkActionReport";
import type { LoadedCategory } from "../types";

type Props = {
  /**
   * The cells this run will change, already resolved. A rectangle, a group row
   * and a month column all arrive here the same way - as a set of cells.
   */
  targetCells: ResolvedCell[];
  /** What the cells represent, when it is not simply the current selection. */
  scopeLabel?: string;
  activeMonths: string[];
  categories: LoadedCategory[];
  readOnlyMonths?: Set<string>;
  /** Map of month → category list for that month (for copy-from-month operations) */
  monthDataMap: Record<string, LoadedCategory[]>;
  /** Every month the budget file has, so a source can be picked outside the window. */
  availableMonths?: string[];
  /** Loads source months outside the visible window. Supplied by the workspace. */
  ensureMonths: (months: string[]) => Promise<EnsureMonthsResult>;
  onClose: () => void;
  /**
   * The action to run. Required: the workspace only opens this dialog for a
   * chosen action, so there is no state in which the user picks one here.
   */
  initialAction: BulkActionType;
};

type Step = "action" | "preview";

const ACTION_LABELS: Record<BulkActionType, string> = {
  "copy-previous-month":           "Copy previous month",
  "copy-prior-year-same-month":     "Copy prior year same month",
  "copy-prior-year-same-month-pct": "Copy prior year same month, with a % change",
  "copy-from-month":               "Copy specific month",
  "set-to-zero":                   "Set all to zero",
  "set-fixed":                     "Set to fixed amount",
  "apply-percentage":              "Apply percentage change",
  "avg-3-months":                  "Avg. 3-month budget",
  "avg-6-months":                  "Avg. 6-month budget",
  "avg-12-months":                 "Avg. 12-month budget",
  "avg-3-months-actuals":          "Avg. 3-month actual",
  "avg-6-months-actuals":          "Avg. 6-month actual",
  "avg-12-months-actuals":         "Avg. 12-month actual",
};

/** Actions that accept a percentage but do not require one (blank = 100%). */
const OPTIONAL_PERCENTAGE_ACTIONS: BulkActionType[] = [
  "copy-prior-year-same-month-pct",
  "copy-from-month",
];

/**
 * Multi-step dialog for bulk budget actions on a selection.
 *
 * Step 1: Supply the action's parameters, if it takes any.
 * Step 2: Review a preview table of the proposed changes, then apply.
 *
 * The action itself is chosen from the cell context menu and arrives as
 * `initialAction`; this dialog never offers a choice of action.
 */
export function BulkActionDialog({
  targetCells,
  scopeLabel,
  activeMonths,
  categories,
  readOnlyMonths,
  monthDataMap,
  availableMonths,
  ensureMonths,
  onClose,
  initialAction,
}: Props) {
  const { preview, apply } = useBulkAction();

  const [step, setStep] = useState<Step>("action");
  const autoPreviewed = useRef(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const action = initialAction;

  // The months this run will write to — also what the source defaults key off.
  const targetMonths = useMemo(
    () => [...new Set(targetCells.map((c) => c.month))].sort(),
    [targetCells]
  );

  /**
   * Source months come from the budget file, not the visible window — the whole
   * point of this dialog is to reach a month the grid is not showing. Newest
   * first, since a source is far more often recent than ancient.
   */
  const sourceOptions = useMemo(() => {
    const all = availableMonths?.length ? [...availableMonths] : [...activeMonths];
    const byYear = new Map<string, string[]>();
    for (const m of [...new Set(all)].sort().reverse()) {
      const year = m.slice(0, 4);
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year)!.push(m);
    }
    return [...byYear.entries()];
  }, [availableMonths, activeMonths]);

  const offeredMonths = useMemo(
    () => new Set(sourceOptions.flatMap(([, months]) => months)),
    [sourceOptions]
  );

  /** Default to the same month a year back: the reason most people open this. */
  const defaultSourceMonth = useMemo(() => {
    const anchor = targetMonths[0] ?? activeMonths[0];
    const lastYear = anchor ? addMonths(anchor, -12) : "";
    if (lastYear && offeredMonths.has(lastYear)) return lastYear;
    return sourceOptions[0]?.[1]?.[0] ?? activeMonths[0] ?? "";
  }, [targetMonths, activeMonths, sourceOptions, offeredMonths]);

  const [fixedAmount, setFixedAmount] = useState("");
  const [sourceMonth, setSourceMonth] = useState(defaultSourceMonth);
  // `availableMonths` can resolve after this dialog mounts, which would leave
  // the initial state value outside the offered set and the select blank.
  // Deriving the shown value keeps it valid without an effect.
  const effectiveSourceMonth =
    sourceMonth && offeredMonths.has(sourceMonth) ? sourceMonth : defaultSourceMonth;
  // Only the explicit "…with a % change" action suggests an uplift. Every other
  // copy defaults to an exact copy: pre-filling 105 there would silently change
  // what "Copy specific month" has always done.
  const [percentage, setPercentage] = useState(
    action === "copy-prior-year-same-month-pct" ? "105" : "100"
  );
  const [previewRows, setPreviewRows] = useState<BulkPreviewRow[]>([]);
  /**
   * Per-row adjustments made in the preview, keyed by cell.
   *
   * An average lands on 97 when the user wanted 100. Recomputing is not the
   * answer - the point of the preview is that these are the numbers about to be
   * written, so they are the numbers that should be editable. What is applied
   * is always what this table shows.
   */
  const [rowOverrides, setRowOverrides] = useState<Record<string, number>>({});
  /** In-progress text per row, so a half-typed value is never parsed. */
  const [rowDrafts, setRowDrafts] = useState<Record<string, string>>({});
  const [skips, setSkips] = useState<BulkSkips>(NO_SKIPS);
  const [avgNote, setAvgNote] = useState<string | null>(null);
  const [paramError, setParamError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const needsFixed = action === "set-fixed";
  const needsSourceMonth = action === "copy-from-month";
  const optionalPercentage = OPTIONAL_PERCENTAGE_ACTIONS.includes(action);
  const requiredPercentage = action === "apply-percentage";
  const showsPercentage = optionalPercentage || requiredPercentage;

  const buildParams = (): BulkActionParams | undefined => {
    const params: BulkActionParams = {};

    if (needsFixed) {
      const cents = Math.round(parseFloat(fixedAmount) * 100);
      if (isNaN(cents)) return undefined;
      params.fixedAmount = cents;
    }
    if (needsSourceMonth) params.sourceMonth = effectiveSourceMonth;
    if (showsPercentage) {
      // Blank is a legitimate answer for the copy actions: it means an exact
      // copy. It is not legitimate for apply-percentage, which is only a
      // percentage.
      if (percentage.trim() === "") {
        if (requiredPercentage) return undefined;
      } else {
        const pct = parseFloat(percentage);
        if (isNaN(pct)) return undefined;
        params.percentage = pct / 100;
      }
    }

    return params;
  };

  const handlePreview = async () => {
    setParamError(null);
    const params = buildParams();

    if (needsFixed && params?.fixedAmount === undefined) {
      setParamError("Please enter a valid dollar amount.");
      return;
    }
    if (requiredPercentage && params?.percentage === undefined) {
      setParamError("Please enter a valid percentage.");
      return;
    }
    if (showsPercentage && params === undefined) {
      setParamError("Please enter a valid percentage.");
      return;
    }

    setIsLoading(true);
    try {
      // Load whatever months this action reads before resolving anything, so a
      // value is never taken from "whatever happened to be cached".
      const needed = requiredSourceMonths(action, targetMonths, params);
      const loaded = needed.length > 0 ? await ensureMonths(needed) : null;

      const fullMap: Record<string, LoadedCategory[]> = {
        ...monthDataMap,
        ...(loaded?.monthDataMap ?? {}),
      };

      const result = preview(action, targetCells, activeMonths, categories, fullMap, params);
      if (!result) {
        setParamError("This action is missing a required value.");
        return;
      }

      const { rows, skips: nextSkips } = collectSkips(result, readOnlyMonths);

      if (rows.length === 0) {
        setParamError(
          totalSkips(nextSkips) > 0
            ? `No cells could be updated - ${describeSkips(nextSkips)}.`
            : "No cells would be changed by this action."
        );
        return;
      }

      setPreviewRows(rows);
      setRowOverrides({});
      setRowDrafts({});
      setSkips(nextSkips);
      setAvgNote(describeAverageWindow(result.averageWindow));
      setStep("preview");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * An action that collects no parameters has nothing to show on the first
   * step, so asking the user to click through an empty form to reach the
   * preview is a wasted step. Go straight to the preview instead - it is still
   * the confirmation, and it is the screen that carries the real information.
   */
  const collectsNothing = !needsFixed && !needsSourceMonth && !showsPercentage;
  useEffect(() => {
    if (!collectsNothing || autoPreviewed.current) return;
    autoPreviewed.current = true;
    void handlePreview();
    // handlePreview closes over state that is fixed for a given action; the
    // guard ref makes this run exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectsNothing]);

  const rowKey = (row: BulkPreviewRow) => `${row.month}:${row.categoryId}`;
  const valueFor = (row: BulkPreviewRow) =>
    rowOverrides[rowKey(row)] ?? row.nextBudgeted;

  /** Rows as they will actually be written, adjustments included. */
  const rowsToApply = previewRows.map((row) => ({
    ...row,
    nextBudgeted: valueFor(row),
  }));

  const netChange = rowsToApply.reduce(
    (sum, row) => sum + (row.nextBudgeted - row.previousBudgeted),
    0
  );
  const unchangedCount = rowsToApply.filter(
    (row) => row.nextBudgeted === row.previousBudgeted
  ).length;
  const adjustedCount = Object.keys(rowOverrides).length;

  const commitDraft = (row: BulkPreviewRow) => {
    const key = rowKey(row);
    const draft = rowDrafts[key];
    if (draft === undefined) return;
    const parsed = parseBudgetExpression(draft);
    setRowDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    if (!parsed.ok) return; // Invalid text is discarded, not written.
    setRowOverrides((o) =>
      parsed.value === row.nextBudgeted
        ? (() => {
            const next = { ...o };
            delete next[key];
            return next;
          })()
        : { ...o, [key]: parsed.value }
    );
  };

  /**
   * Move between the editable amounts with the keyboard.
   *
   * Without this, adjusting a long preview means clicking every row - which is
   * the work the bulk action was supposed to remove. Enter commits and steps
   * down, matching the grid's own commit-down behaviour.
   */
  const focusRow = (index: number) => {
    const input = tableRef.current?.querySelector<HTMLInputElement>(
      `input[data-preview-row="${index}"]`
    );
    if (!input) return;
    input.focus();
    input.select();
  };

  const revertRow = (row: BulkPreviewRow) => {
    const key = rowKey(row);
    setRowOverrides((o) => {
      const next = { ...o };
      delete next[key];
      return next;
    });
    setRowDrafts((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
  };

  const handleApply = () => {
    apply(rowsToApply);
    onClose();
  };

  const avgWindow = averageWindowLength(action);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk budget action"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-3xl mx-4 p-5">
        {step === "action" && (
          <>
            <h2 className="text-base font-semibold mb-1">{ACTION_LABELS[action]}</h2>
            <p className="text-xs text-muted-foreground mb-4">
              {scopeLabel ? `${scopeLabel} · ` : ""}
              {targetCells.length} cell{targetCells.length !== 1 ? "s" : ""}
            </p>

            <div className="space-y-3 mb-4">
              {needsFixed && (
                <div>
                  <label htmlFor="bulk-fixed-amount" className="block text-xs font-medium mb-1">
                    Amount ($)
                  </label>
                  <input
                    id="bulk-fixed-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={fixedAmount}
                    onChange={(e) => setFixedAmount(e.target.value)}
                    placeholder="0.00"
                    className="h-7 w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                    aria-label="Fixed amount in dollars"
                  />
                </div>
              )}

              {needsSourceMonth && (
                <div>
                  <label htmlFor="bulk-source-month" className="block text-xs font-medium mb-1">
                    Source month
                  </label>
                  <select
                    id="bulk-source-month"
                    value={effectiveSourceMonth}
                    onChange={(e) => setSourceMonth(e.target.value)}
                    className="h-7 w-full rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    {sourceOptions.map(([year, monthsInYear]) => (
                      <optgroup key={year} label={year}>
                        {monthsInYear.map((m) => (
                          <option key={m} value={m}>
                            {formatMonthLabel(m, "long")}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              )}

              {action === "copy-prior-year-same-month-pct" && (
                <p className="text-xs text-muted-foreground">
                  Each selected month copies from the same month in the prior year.
                </p>
              )}

              {showsPercentage && (
                <div>
                  <label htmlFor="bulk-percentage" className="block text-xs font-medium mb-1">
                    {requiredPercentage
                      ? "New value as % of current (e.g. 110 = 10% increase)"
                      : "Copy at % of the source (e.g. 105 = 5% increase)"}
                  </label>
                  <input
                    id="bulk-percentage"
                    type="number"
                    min="0"
                    step="1"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                    className="h-7 w-full rounded border border-border bg-background px-2 py-1 text-xs font-mono"
                    aria-label={
                      requiredPercentage
                        ? "Percentage of current value"
                        : "Percentage of the source value"
                    }
                  />
                  {optionalPercentage && (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Leave blank to copy the amount unchanged.
                    </p>
                  )}
                </div>
              )}

              {paramError && (
                <p className="text-xs text-destructive" role="alert">{paramError}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePreview}
                disabled={isLoading}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                {isLoading ? "Loading months…" : "Preview changes"}
              </button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <h2 className="text-base font-semibold mb-1">Preview Changes</h2>

            {/* One status line: the count and the qualifiers belong together. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs mb-3">
              <span className="text-muted-foreground">
                {rowsToApply.length} cell{rowsToApply.length !== 1 ? "s" : ""} will be updated.
              </span>
              {avgNote ? (
                <span className="text-amber-600 dark:text-amber-500" role="status">
                  {avgNote}
                </span>
              ) : (
                avgWindow !== null && (
                  <span className="text-muted-foreground">
                    Averaged over the {avgWindow} months before each cell.
                  </span>
                )
              )}
              {totalSkips(skips) > 0 && (
                <span className="text-amber-600 dark:text-amber-500" role="status">
                  {describeSkips(skips)}.
                </span>
              )}
              {unchangedCount > 0 && (
                <span className="text-muted-foreground">
                  {unchangedCount} already at this value and will not be written.
                </span>
              )}
            </div>

            <div
              ref={tableRef}
              className="max-h-96 overflow-y-auto border border-border rounded text-xs mb-2"
            >
              <table className="w-full" role="grid" aria-label="Preview of bulk changes">
                {/* Opaque header: the table body scrolls underneath it. */}
                <thead className="bg-muted sticky top-0 z-10 shadow-[0_1px_0_0_var(--color-border)]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Category</th>
                    <th className="px-3 py-2 text-left font-medium">Month</th>
                    <th className="px-3 py-2 text-right font-medium">Current</th>
                    <th className="px-3 py-2 text-right font-medium">
                      New
                      <span className="ml-1 font-normal text-muted-foreground">(editable)</span>
                    </th>
                    <th className="px-3 py-2 text-right font-medium">Change</th>
                    <th className="px-2 py-2 w-8" aria-label="Revert" />
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, index) => {
                    const key = rowKey(row);
                    const value = valueFor(row);
                    const delta = value - row.previousBudgeted;
                    const isAdjusted = rowOverrides[key] !== undefined;
                    return (
                      <tr
                        key={key}
                        className={`border-t border-border/50 ${
                          delta === 0 ? "text-muted-foreground" : ""
                        }`}
                      >
                        <td className="px-3 py-1 truncate max-w-[16rem]" title={row.categoryName}>
                          {row.categoryName}
                        </td>
                        <td className="px-3 py-1 whitespace-nowrap">
                          {formatMonthLabel(row.month, "long")}
                        </td>
                        <td className="px-3 py-1 text-right font-mono text-muted-foreground">
                          {formatAmount(row.previousBudgeted)}
                        </td>
                        <td className="px-3 py-1 text-right">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`New amount for ${row.categoryName}, ${formatMonthLabel(row.month, "long")}`}
                            data-preview-row={index}
                            value={rowDrafts[key] ?? minorToDecimalString(value)}
                            onChange={(e) =>
                              setRowDrafts((d) => ({ ...d, [key]: e.target.value }))
                            }
                            onBlur={() => commitDraft(row)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === "ArrowDown") {
                                e.preventDefault();
                                commitDraft(row);
                                focusRow(index + 1);
                              } else if (e.key === "ArrowUp") {
                                e.preventDefault();
                                commitDraft(row);
                                focusRow(index - 1);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRowDrafts((d) => {
                                  const next = { ...d };
                                  delete next[key];
                                  return next;
                                });
                              }
                            }}
                            className={`w-28 text-right font-mono rounded border bg-background px-1.5 py-0.5 transition-colors focus:outline-none focus:ring-1 focus:ring-primary ${
                              isAdjusted
                                ? "border-primary text-foreground font-medium"
                                : "border-border hover:border-foreground/40"
                            }`}
                          />
                        </td>
                        <td
                          className={`px-3 py-1 text-right font-mono ${
                            delta === 0
                              ? "text-muted-foreground"
                              : delta > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive"
                          }`}
                        >
                          {delta === 0 ? "-" : formatDelta(delta)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {isAdjusted && (
                            <button
                              type="button"
                              onClick={() => revertRow(row)}
                              aria-label={`Revert ${row.categoryName}, ${formatMonthLabel(row.month, "long")} to the calculated amount`}
                              title="Revert to the calculated amount"
                              className="text-muted-foreground hover:text-foreground"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[11px] text-muted-foreground mb-3">
              Adjust any amount before applying - ↑ ↓ move between rows, Enter commits,
              Esc cancels an edit.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Net change <span className="font-mono text-foreground">{formatDelta(netChange)}</span>
                {adjustedCount > 0 && (
                  <span className="ml-2">
                    · {adjustedCount} manually adjusted
                  </span>
                )}
              </p>
              <div className="flex gap-2 justify-end">
                {/* No Back for an action that collects nothing - it would lead
                    to an empty form the user was deliberately skipped past. */}
                <button
                  type="button"
                  onClick={() => (collectsNothing ? onClose() : setStep("action"))}
                  className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors"
                >
                  {collectsNothing ? "Cancel" : "Back"}
                </button>
                <button
                  type="button"
                  onClick={handleApply}
                  className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  aria-label={`Apply ${rowsToApply.length} budget change${rowsToApply.length !== 1 ? "s" : ""}`}
                >
                  Apply {rowsToApply.length} change{rowsToApply.length !== 1 ? "s" : ""}
                </button>
              </div>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
