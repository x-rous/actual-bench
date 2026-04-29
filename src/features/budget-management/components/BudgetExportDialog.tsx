"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MultiSearchableCombobox } from "@/components/ui/combobox";
import type { ComboboxOption } from "@/components/ui/combobox";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { subtractMonths, formatMonthLabel } from "@/lib/budget/monthMath";
import { exportToCsv, exportBlankTemplate } from "../lib/budgetCsv";
import { budgetMonthDataQueryOptions } from "../hooks/useMonthData";
import type { LoadedCategory, LoadedGroup, LoadedMonthState, StagedBudgetEdit, BudgetCellKey } from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────

type SelectionMode = "quick" | "range" | "select";
type QuickPreset = "current-view" | "this-month" | "last-3" | "this-year" | "last-year" | "all";

type Props = {
  availableMonths: string[];
  activeMonths: string[];
  groups: LoadedGroup[];
  categoriesById: Record<string, LoadedCategory>;
  stagedEdits?: Record<BudgetCellKey, StagedBudgetEdit>;
  onClose: () => void;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtMonthLabel = formatMonthLabel;

function fmtSummaryRange(months: string[]): string {
  if (months.length === 0) return "No months selected";
  const sorted = [...months].sort();
  if (sorted.length === 1) return fmtMonthLabel(sorted[0]!);
  return `${fmtMonthLabel(sorted[0]!)} – ${fmtMonthLabel(sorted[sorted.length - 1]!)}`;
}

function resolveQuickPreset(
  preset: QuickPreset,
  available: string[],
  activeMonths: string[]
): string[] {
  if (available.length === 0) return [];
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const thisYear = String(now.getFullYear());
  const lastYear = String(now.getFullYear() - 1);

  switch (preset) {
    case "current-view":
      return [...activeMonths].sort();
    case "this-month":
      return available.filter((m) => m === thisMonth);
    case "last-3": {
      const cutoff = subtractMonths(thisMonth, 2);
      return available.filter((m) => m >= cutoff && m <= thisMonth).sort();
    }
    case "this-year":
      return available.filter((m) => m.startsWith(thisYear)).sort();
    case "last-year":
      return available.filter((m) => m.startsWith(lastYear)).sort();
    case "all":
      return [...available].sort();
  }
}


const QUICK_PRESETS: { id: QuickPreset; label: string }[] = [
  { id: "current-view", label: "Current View" },
  { id: "this-month",   label: "This Month" },
  { id: "last-3",       label: "Last 3 Months" },
  { id: "this-year",    label: "This Year" },
  { id: "last-year",    label: "Last Year" },
  { id: "all",          label: "All" },
];

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Dialog for exporting budget data to CSV.
 *
 * Month selection via three progressive modes:
 *   Quick Range – presets with count badges (default, "Current View" pre-selected)
 *   Date Range  – From / To dropdowns constrained to availableMonths
 *   Manual      – tag-chip input for individual YYYY-MM months with inline validation
 */
export function BudgetExportDialog({
  availableMonths,
  activeMonths,
  groups,
  categoriesById,
  stagedEdits,
  onClose,
}: Props) {
  const [mode, setMode] = useState<SelectionMode>("quick");
  const [quickPreset, setQuickPreset] = useState<QuickPreset>("current-view");
  const [rangeFrom, setRangeFrom] = useState<string>(
    availableMonths[0] ?? activeMonths[0] ?? ""
  );
  const [rangeTo, setRangeTo] = useState<string>(
    availableMonths[availableMonths.length - 1] ?? activeMonths[activeMonths.length - 1] ?? ""
  );
  const [selectMonths, setSelectMonths] = useState<string[]>([]);

  const [includeHidden, setIncludeHidden] = useState(false);
  const [includeIncome, setIncludeIncome] = useState(false);
  const [includeStagedView, setIncludeStagedView] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const connection = useConnectionStore(selectActiveInstance);

  // Combobox options for the Select tab — one option per available month.
  const monthOptions = useMemo<ComboboxOption[]>(
    () => availableMonths.map((m) => ({ id: m, name: fmtMonthLabel(m) })),
    [availableMonths]
  );

  // Derive the resolved month list from the current mode.
  const selectedMonths = useMemo<string[]>(() => {
    if (mode === "quick") {
      return resolveQuickPreset(quickPreset, availableMonths, activeMonths);
    }
    if (mode === "range") {
      if (!rangeFrom || !rangeTo) return [];
      const from = rangeFrom <= rangeTo ? rangeFrom : rangeTo;
      const to   = rangeFrom <= rangeTo ? rangeTo   : rangeFrom;
      return availableMonths.filter((m) => m >= from && m <= to).sort();
    }
    // select — months chosen via combobox, already constrained to availableMonths
    return [...selectMonths].sort();
  }, [mode, quickPreset, rangeFrom, rangeTo, selectMonths, availableMonths, activeMonths]);

  // Per-preset counts for badges.
  const presetCounts = useMemo<Record<QuickPreset, number>>(
    () => ({
      "current-view": activeMonths.length,
      "this-month":   resolveQuickPreset("this-month",  availableMonths, activeMonths).length,
      "last-3":       resolveQuickPreset("last-3",      availableMonths, activeMonths).length,
      "this-year":    resolveQuickPreset("this-year",   availableMonths, activeMonths).length,
      "last-year":    resolveQuickPreset("last-year",   availableMonths, activeMonths).length,
      all:            availableMonths.length,
    }),
    [availableMonths, activeMonths]
  );

  const canExport = selectedMonths.length > 0;

  const triggerDownload = (content: string, filename: string) => {
    // Prepend UTF-8 BOM so Excel and other tools open the file with the correct encoding.
    const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExport = async () => {
    if (!canExport || !connection) return;
    setFetchError(null);
    setIsExporting(true);

    // Fetch all selected months in parallel. queryClient.fetchQuery returns the
    // cached value immediately for months already loaded by the grid, so only
    // months outside the current 12-month window incur a network request.
    const results = await Promise.allSettled(
      selectedMonths.map((m) =>
        queryClient.fetchQuery(budgetMonthDataQueryOptions(connection, m))
      )
    );

    const failedCount = results.filter((r) => r.status === "rejected").length;
    if (failedCount > 0) {
      setIsExporting(false);
      setFetchError(
        `Failed to load data for ${failedCount} month${failedCount !== 1 ? "s" : ""}. Please try again.`
      );
      return;
    }

    const monthDataMap: Record<string, LoadedMonthState> = {};
    for (let i = 0; i < selectedMonths.length; i++) {
      const result = results[i];
      if (result?.status === "fulfilled") {
        monthDataMap[selectedMonths[i]!] = result.value;
      }
    }

    const opts = { months: selectedMonths, includeHidden, includeIncome };
    const edits = includeStagedView ? stagedEdits : undefined;
    const csv = exportToCsv(selectedMonths, groups, monthDataMap, opts, edits);
    const filename = `budget-export-${selectedMonths[0]}-to-${selectedMonths[selectedMonths.length - 1]}.csv`;
    triggerDownload(csv, filename);
    setIsExporting(false);
    onClose();
  };

  const handleTemplate = () => {
    if (!canExport) return;
    const opts = { months: selectedMonths, includeHidden, includeIncome };
    const csv = exportBlankTemplate(selectedMonths, groups, categoriesById, opts);
    const filename = `budget-template-${selectedMonths[0]}-to-${selectedMonths[selectedMonths.length - 1]}.csv`;
    triggerDownload(csv, filename);
    onClose();
  };

  const handleRangeFromChange = (val: string) => {
    setRangeFrom(val);
    if (val > rangeTo) setRangeTo(val);
  };

  const handleRangeToChange = (val: string) => {
    setRangeTo(val);
    if (val < rangeFrom) setRangeFrom(val);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Export budget data"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-md mx-4 p-5">
        <h2 className="text-base font-semibold mb-4">Export Budget Data</h2>

        {/* Mode segmented control */}
        <div
          className="flex rounded border border-border overflow-hidden mb-4 text-xs font-medium"
          role="group"
          aria-label="Month selection mode"
        >
          {(["quick", "range", "select"] as SelectionMode[]).map((m, i, arr) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`flex-1 py-1.5 capitalize transition-colors ${
                i < arr.length - 1 ? "border-r border-border" : ""
              } ${
                mode === m
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {m === "quick" ? "Quick Range" : m === "range" ? "Date Range" : "Select"}
            </button>
          ))}
        </div>

        {/* Quick Range */}
        {mode === "quick" && (
          <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Quick range presets">
            {QUICK_PRESETS.map(({ id, label }) => {
              const count = presetCounts[id];
              const active = quickPreset === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setQuickPreset(id)}
                  aria-pressed={active}
                  disabled={count === 0}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {label}
                  <span
                    className={`tabular-nums ${active ? "opacity-80" : "opacity-60"}`}
                    aria-label={`${count} months`}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Date Range */}
        {mode === "range" && (
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">From</label>
              <select
                value={rangeFrom}
                onChange={(e) => handleRangeFromChange(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background font-mono"
                aria-label="Range start month"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{fmtMonthLabel(m)}</option>
                ))}
              </select>
            </div>
            <span className="mt-4 text-muted-foreground text-xs shrink-0">–</span>
            <div className="flex-1">
              <label className="block text-xs text-muted-foreground mb-1">To</label>
              <select
                value={rangeTo}
                onChange={(e) => handleRangeToChange(e.target.value)}
                className="w-full text-xs border border-border rounded px-2 py-1.5 bg-background font-mono"
                aria-label="Range end month"
              >
                {availableMonths.map((m) => (
                  <option key={m} value={m}>{fmtMonthLabel(m)}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Select — searchable multi-select combobox constrained to availableMonths */}
        {mode === "select" && (
          <div className="mb-4">
            <label className="block text-xs text-muted-foreground mb-1">
              Pick individual months
            </label>
            <MultiSearchableCombobox
              options={monthOptions}
              values={selectMonths}
              onChange={setSelectMonths}
              placeholder="Search and select months…"
            />
          </div>
        )}

        {/* Resolution summary — always visible */}
        <div
          className={`mb-4 px-3 py-2 rounded text-xs ${
            canExport
              ? "bg-muted/50 text-foreground"
              : "bg-muted/30 text-muted-foreground"
          }`}
          aria-live="polite"
          aria-label="Month selection summary"
        >
          {canExport ? (
            <>
              <span className="font-semibold">{selectedMonths.length} month{selectedMonths.length !== 1 ? "s" : ""}</span>
              {" selected: "}
              <span className="font-mono">{fmtSummaryRange(selectedMonths)}</span>
            </>
          ) : (
            "No months selected"
          )}
        </div>

        {/* Options */}
        <fieldset className="mb-4 space-y-2">
          <legend className="text-sm font-medium mb-2">Options</legend>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeHidden}
              onChange={(e) => setIncludeHidden(e.target.checked)}
              aria-label="Include hidden categories"
            />
            Include hidden categories
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={includeIncome}
              onChange={(e) => setIncludeIncome(e.target.checked)}
              aria-label="Include income groups"
            />
            Include income groups
          </label>

          {stagedEdits && Object.keys(stagedEdits).length > 0 && (
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={includeStagedView}
                onChange={(e) => setIncludeStagedView(e.target.checked)}
                aria-label="Export with staged (unsaved) values"
              />
              Export with staged (unsaved) values
            </label>
          )}
        </fieldset>

        {fetchError && (
          <p className="text-xs text-destructive mb-3" role="alert">{fetchError}</p>
        )}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleTemplate}
            disabled={!canExport || isExporting}
            aria-label="Download blank CSV template for the selected months"
            className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Blank template
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={!canExport || isExporting}
            aria-label={`Export ${selectedMonths.length} month${selectedMonths.length !== 1 ? "s" : ""} to CSV`}
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isExporting ? "Exporting…" : "Export CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}
