"use client";

import { useMemo, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  parseBudgetCsv,
  matchImportRows,
  buildImportPreview,
} from "../lib/budgetCsv";
import type {
  ImportRowResult,
  ImportPreviewEntry,
  ParsedBudgetCsv,
} from "../lib/budgetCsv";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { budgetMonthDataQueryOptions } from "../lib/monthDataQuery";
import { formatCurrency as formatAmount, formatDelta } from "../lib/format";
import type { LoadedCategory, LoadedGroup, LoadedMonthState } from "../types";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { incomeBudgetsQueryOptions } from "../hooks/useIncomeBudgets";
import { incomeCategoryIdsNeedingBudgetFallback } from "../lib/monthAuthority";
import { applyIncomeBudgetFallback } from "../lib/varianceInvestigation/varianceIncomeBudgets";

type Props = {
  availableMonths: string[];
  activeMonths: string[];
  categories: LoadedCategory[];
  groups: LoadedGroup[];
  categoriesById: Record<string, LoadedCategory>;
  onClose: () => void;
  /** Called when user accepts "extend visible range" to add out-of-range months */
  onExtendRange?: (months: string[]) => void;
};

type Step = "upload" | "match" | "preview";

/** How many unreadable cells the match step lists before "Show N more". */
const INVALID_CELL_SAMPLE = 5;

function getImportRowId(index: number): string {
  return String(index);
}

const DELIMITER_LABEL: Record<ParsedBudgetCsv["delimiter"], string> = {
  ",": "comma",
  ";": "semicolon",
  "\t": "tab",
};

function describeMonthSpan(months: string[]): string {
  if (months.length === 0) return "";
  const sorted = [...months].sort();
  const first = formatMonthLabel(sorted[0]!);
  const last = formatMonthLabel(sorted[sorted.length - 1]!);
  return first === last ? first : `${first} – ${last}`;
}

/** Union of `base` and every category in `states`, keeping the first seen. */
function mergeCategories(
  base: LoadedCategory[],
  states: LoadedMonthState[]
): LoadedCategory[] {
  const byId = new Map(base.map((c) => [c.id, c]));
  for (const state of states) {
    for (const cat of Object.values(state.categoriesById)) {
      if (!byId.has(cat.id)) byId.set(cat.id, cat);
    }
  }
  return [...byId.values()];
}

/**
 * Three-step import wizard:
 *   1. Upload — a file (drag-and-drop or browse) or cells pasted from a
 *      spreadsheet → parseBudgetCsv
 *   2. Match review — exact/suggested/out-of-range/absent/unmatched rows, plus
 *      anything in the file that could not be read
 *   3. Preview — the cells that would change → stageBulkEdits
 */
export function BudgetImportDialog({
  availableMonths,
  activeMonths,
  categories,
  groups,
  categoriesById,
  onClose,
  onExtendRange,
}: Props) {
  const stageBulkEdits = useBudgetEditsStore((s) => s.stageBulkEdits);
  const stagedEdits = useBudgetEditsStore((s) => s.edits);
  const isTracking = useBudgetEditsStore((s) => s.budgetMode) === "tracking";
  const connection = useConnectionStore(selectActiveInstance);
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>("upload");
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBudgetCsv | null>(null);
  const [matchCategories, setMatchCategories] = useState<LoadedCategory[]>([]);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [previewRows, setPreviewRows] = useState<ImportPreviewEntry[]>([]);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const [showAllInvalid, setShowAllInvalid] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [previewError, setPreviewError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Each read or preview load takes a ticket; a newer one (or Back) makes an
  // older pending load's result void, so it cannot replace newer state.
  const requestRef = useRef(0);

  // Recomputed when the visible range changes, so months brought into view
  // by "Move the visible range" are no longer treated as out of range. Row
  // ids are row positions, so approvals carry over unchanged.
  const matchResults = useMemo<ImportRowResult[]>(
    () => (parsed ? matchImportRows(parsed.rows, matchCategories, availableMonths, activeMonths) : []),
    [parsed, matchCategories, availableMonths, activeMonths]
  );

  /**
   * Server state for each given month, with the months that could not be
   * loaded. Matching can use the cache (the grid has loaded the window); the
   * preview reads fresh (`fresh`), because a cached value that another client
   * has since changed would hide a real change as "already matches".
   */
  const loadMonthStates = async (months: string[], fresh = false) => {
    const monthStates: Record<string, LoadedMonthState | undefined> = {};
    const failed: string[] = [];
    const loaded = await Promise.allSettled(
      months.map(async (month) => {
        const options = budgetMonthDataQueryOptions(connection, month);
        const state = fresh
          ? await queryClient.fetchQuery({ ...options, staleTime: 0 })
          : await queryClient.ensureQueryData(options);
        return [month, state] as const;
      })
    );
    for (const [index, outcome] of loaded.entries()) {
      if (outcome.status === "fulfilled") monthStates[outcome.value[0]] = outcome.value[1];
      else failed.push(months[index]!);
    }
    return { monthStates, failed };
  };

  const goToStep = (next: Step) => {
    requestRef.current++;
    setIsWorking(false);
    setPreviewError(null);
    setStep(next);
  };

  // ---------- Step 1: Upload or paste ----------

  const readImport = async (raw: string, sourceLabel: string) => {
    let result: ParsedBudgetCsv;
    try {
      result = parseBudgetCsv(raw);
    } catch {
      setParseError(`Could not read the ${sourceLabel}. Please check its format.`);
      return;
    }
    if (result.monthColumns.length === 0) {
      setParseError(
        "No month columns found. After Group Name and Category Name, each column header must be a month, such as 2026-01 or Jan 2026."
      );
      return;
    }
    if (result.rows.length === 0) {
      setParseError(`The ${sourceLabel} contains no category rows.`);
      return;
    }
    if (result.analysisExport) {
      setParseError(
        `This is a ${result.analysisExport} export, not budgeted amounts, so it cannot be imported. Export Budgeted amounts to edit and import them back.`
      );
      return;
    }
    if (result.duplicateMonthColumns.length > 0) {
      const conflicts = result.duplicateMonthColumns
        .map((d) => `${d.headers.join(" and ")} (${formatMonthLabel(d.month)})`)
        .join("; ");
      setParseError(`More than one column is the same month: ${conflicts}. Keep one column per month and try again.`);
      return;
    }

    const request = ++requestRef.current;
    setIsWorking(true);
    try {
      // Match against every category that exists in the months in view, so a
      // category created after the first visible month is found too.
      const visible = new Set(activeMonths);
      const available = new Set(availableMonths);
      const inView = [...new Set(result.monthColumns.map((c) => c.month))].filter(
        (m) => visible.has(m) && available.has(m)
      );
      const { monthStates: states } = await loadMonthStates(inView);
      if (request !== requestRef.current) return;
      const allCategories = mergeCategories(
        categories,
        Object.values(states).filter((st): st is LoadedMonthState => st != null)
      );

      const results = matchImportRows(result.rows, allCategories, availableMonths, activeMonths);
      setParsed(result);
      setMatchCategories(allCategories);
      // Auto-approve exact matches
      setApprovedIds(
        new Set(
          results.flatMap((r, index) =>
            r.matchStatus === "exact" && r.matchedCategoryId !== null
              ? [getImportRowId(index)]
              : []
          )
        )
      );
      setShowAllInvalid(false);
      setParseError(null);
      setPreviewError(null);
      setStep("match");
    } finally {
      if (request === requestRef.current) setIsWorking(false);
    }
  };

  const handleFile = (file: File) => {
    // One import at a time: a second file waits until the first is read.
    if (isWorking) return;
    const name = file.name.toLowerCase();
    const looksLikeText =
      name.endsWith(".csv") ||
      name.endsWith(".tsv") ||
      name.endsWith(".txt") ||
      file.type.startsWith("text/");
    if (!looksLikeText) {
      setParseError("Please choose a .csv, .tsv or .txt file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      void readImport((e.target?.result as string) ?? "", "file");
    };
    reader.onerror = () => setParseError("The file could not be read.");
    reader.readAsText(file, "UTF-8");
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Allow choosing the same file again after fixing it.
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ---------- Step 2: Match Review ----------

  const matchableIds = matchResults.flatMap((r, index) =>
    r.matchedCategoryId && r.matchStatus !== "unmatched" ? [getImportRowId(index)] : []
  );
  const suggestedIds = matchResults.flatMap((r, index) =>
    r.matchedCategoryId && r.matchStatus === "suggested" ? [getImportRowId(index)] : []
  );
  const unapprovedSuggestions = suggestedIds.filter((id) => !approvedIds.has(id));

  const toggleApproval = (rowId: string) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const monthsWithStatus = (status: "out-of-range" | "absent") =>
    Array.from(
      new Set(
        matchResults.flatMap((r) =>
          Object.entries(r.monthAvailability)
            .filter(([, s]) => s === status)
            .map(([month]) => month)
        )
      )
    ).sort();
  const outOfRangeMonths = monthsWithStatus("out-of-range");
  const absentMonths = monthsWithStatus("absent");

  // Approved rows that resolve to the same category: the last one wins.
  const approvedCountByCategory = new Map<string, number>();
  for (const [index, r] of matchResults.entries()) {
    if (!r.matchedCategoryId || !approvedIds.has(getImportRowId(index))) continue;
    approvedCountByCategory.set(
      r.matchedCategoryId,
      (approvedCountByCategory.get(r.matchedCategoryId) ?? 0) + 1
    );
  }
  const duplicateCategoryNames = [
    ...new Set(
      matchResults
        .filter((r) => r.matchedCategoryId && (approvedCountByCategory.get(r.matchedCategoryId) ?? 0) > 1)
        .map((r) => r.matchedCategoryName ?? "")
    ),
  ];

  const handleExtendRange = async () => {
    if (!onExtendRange || outOfRangeMonths.length === 0 || !parsed) return;
    const months = outOfRangeMonths;
    onExtendRange(months);

    // Categories are matched against the months in view; load the months just
    // brought into view too, so a category found only there can be matched.
    // Approvals are kept (row ids are row positions); a row that only now
    // matches exactly is approved, as it would have been on the first read.
    const available = new Set(availableMonths);
    const request = ++requestRef.current;
    setIsWorking(true);
    try {
      const { monthStates } = await loadMonthStates(months.filter((m) => available.has(m)));
      if (request !== requestRef.current) return;
      const merged = mergeCategories(
        matchCategories,
        Object.values(monthStates).filter((st): st is LoadedMonthState => st != null)
      );
      if (merged.length === matchCategories.length) return;
      const before = matchResults;
      const after = matchImportRows(parsed.rows, merged, availableMonths, [...activeMonths, ...months]);
      setMatchCategories(merged);
      setApprovedIds((prev) => {
        const next = new Set(prev);
        after.forEach((r, index) => {
          if (r.matchStatus === "exact" && r.matchedCategoryId !== null && before[index]?.matchStatus !== "exact") {
            next.add(getImportRowId(index));
          }
        });
        return next;
      });
    } finally {
      if (request === requestRef.current) setIsWorking(false);
    }
  };

  const handleBuildPreview = async () => {
    const approved = matchResults.filter(
      (r, index) => r.matchedCategoryId && approvedIds.has(getImportRowId(index))
    );
    // H4: compare each cell with its own month's saved value.
    const targetMonths = new Set<string>();
    for (const r of approved) {
      for (const [month, avail] of Object.entries(r.monthAvailability)) {
        if (avail === "available") targetMonths.add(month);
      }
    }
    const request = ++requestRef.current;
    setIsWorking(true);
    setPreviewError(null);
    try {
      const { monthStates, failed } = await loadMonthStates([...targetMonths], true);
      if (request !== requestRef.current) return;
      // Never compare a month's cells with another month's values: a month
      // whose saved amounts could not be read blocks the preview until retried.
      if (failed.length > 0) {
        const labels = failed.sort().map((m) => formatMonthLabel(m)).join(", ");
        setPreviewError(`Could not load the saved amounts for ${labels}. Try again.`);
        return;
      }
      // Older Actual servers leave Tracking income budgets out of the month
      // data; the grid reads them separately, and the preview must compare
      // against the same saved values (read fresh, like the months).
      const fallbackIds = isTracking
        ? incomeCategoryIdsNeedingBudgetFallback(Object.values(monthStates))
        : [];
      if (fallbackIds.length > 0) {
        let incomeBudgets: Map<string, Map<string, number>>;
        try {
          incomeBudgets = await queryClient.fetchQuery({
            ...incomeBudgetsQueryOptions(connection, fallbackIds),
            staleTime: 0,
          });
        } catch {
          if (request === requestRef.current) {
            setPreviewError("Could not load the saved income budgets. Try again.");
          }
          return;
        }
        if (request !== requestRef.current) return;
        for (const [month, state] of Object.entries(monthStates)) {
          if (state) monthStates[month] = applyIncomeBudgetFallback(state, month, incomeBudgets);
        }
      }
      setPreviewRows(buildImportPreview(approved, groups, categoriesById, monthStates));
      setShowUnchanged(false);
      setStep("preview");
    } finally {
      if (request === requestRef.current) setIsWorking(false);
    }
  };

  // ---------- Step 3: Preview + Confirm ----------

  // A cell whose imported value is already saved is not a change, unless it
  // replaces a different staged value (importing it then undoes that edit).
  const rowsToStage = previewRows.filter((row) => {
    if (row.nextBudgeted !== row.previousBudgeted) return true;
    const staged = stagedEdits[`${row.month}:${row.categoryId}`];
    return staged !== undefined && staged.nextBudgeted !== row.nextBudgeted;
  });
  const unchangedCount = previewRows.length - rowsToStage.length;
  const visibleRows = showUnchanged ? previewRows : rowsToStage;
  const netChange = rowsToStage.reduce(
    (sum, row) => sum + (row.nextBudgeted - row.previousBudgeted),
    0
  );
  const changedMonthCount = new Set(rowsToStage.map((row) => row.month)).size;

  const handleConfirm = () => {
    stageBulkEdits(
      rowsToStage.map((row) => ({
        month: row.month,
        categoryId: row.categoryId,
        nextBudgeted: row.nextBudgeted,
        previousBudgeted: row.previousBudgeted,
        source: "import",
      }))
    );
    onClose();
  };

  // ---------- Render ----------

  const invalidCells = parsed?.invalidCells ?? [];
  const shownInvalid = showAllInvalid ? invalidCells : invalidCells.slice(0, INVALID_CELL_SAMPLE);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import budget data"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 p-5 max-h-[90vh] flex flex-col">

        {step === "upload" && (
          <>
            <h2 className="text-base font-semibold mb-4">Import Budget Data</h2>

            <div
              role="button"
              tabIndex={0}
              aria-label="Drop a CSV file here or click to select one"
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-6 mb-3 cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <span className="text-sm text-muted-foreground text-center">
                Drag and drop a CSV file here, or click to browse
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                onChange={handleFileInput}
                className="sr-only"
                aria-label="Select a file to import"
              />
            </div>

            <label htmlFor="import-paste" className="block text-xs font-medium mb-1">
              Or paste cells copied from a spreadsheet, including the header row
            </label>
            <Textarea
              id="import-paste"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder={"Group Name\tCategory Name\tJan 2026\tFeb 2026\nFood\tGroceries\t450.00\t450.00"}
              className="font-mono mb-2 resize-y"
            />
            <div className="flex justify-end mb-3">
              <button
                type="button"
                onClick={() => void readImport(pasteText, "pasted data")}
                disabled={pasteText.trim() === "" || isWorking}
                className="px-3 py-1.5 text-xs rounded border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Use pasted data
              </button>
            </div>

            {parseError && (
              <p className="text-xs text-destructive mb-3" role="alert">{parseError}</p>
            )}
            {isWorking && (
              <p className="text-xs text-muted-foreground mb-3" role="status">Reading…</p>
            )}

            <div className="text-xs text-muted-foreground mb-4 space-y-1">
              <p>
                Columns:{" "}
                <code className="font-mono bg-muted px-1 rounded">Group Name, Category Name</code>, then
                one column per month. Empty cells leave a month unchanged.
              </p>
              <p>
                Files saved by Excel or Google Sheets work as they are: comma, semicolon or tab
                separated; month headers such as 2026-01, Jan-26, Jan 2026 or 1/1/2026; amounts such
                as 1,234.50, 1.234,50, $150 or (150.00).
              </p>
            </div>

            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "match" && parsed && (
          <>
            <h2 className="text-base font-semibold mb-1">Review Matches</h2>
            <p className="text-xs text-muted-foreground mb-3">
              Read {parsed.rows.length} row{parsed.rows.length !== 1 ? "s" : ""} and{" "}
              {parsed.monthColumns.length} month column{parsed.monthColumns.length !== 1 ? "s" : ""} (
              {describeMonthSpan(parsed.monthColumns.map((c) => c.month))})
              {parsed.delimiter !== "," ? `, ${DELIMITER_LABEL[parsed.delimiter]} separated` : ""}.{" "}
              {approvedIds.size} of {matchResults.length} rows approved; exact matches are pre-selected.
            </p>

            <div className="space-y-2 mb-3">
              {outOfRangeMonths.length > 0 && (
                <div className="p-2 rounded bg-orange-50 dark:bg-orange-950/20 text-xs text-orange-700 dark:text-orange-400" role="alert">
                  Months outside the visible range are not imported:{" "}
                  <strong>{outOfRangeMonths.map((m) => formatMonthLabel(m)).join(", ")}</strong>.{" "}
                  {onExtendRange && (
                    <button
                      type="button"
                      onClick={handleExtendRange}
                      className="underline hover:no-underline"
                      aria-label={`Move the visible range to include ${outOfRangeMonths.join(", ")}`}
                    >
                      Move the visible range
                    </button>
                  )}
                </div>
              )}

              {absentMonths.length > 0 && (
                <div className="p-2 rounded bg-destructive/10 text-xs text-destructive" role="alert">
                  This budget has no {absentMonths.map((m) => formatMonthLabel(m)).join(", ")}; those
                  columns are not imported.
                </div>
              )}

              {parsed.ignoredColumns.length > 0 && (
                <div className="p-2 rounded bg-muted/60 text-xs text-muted-foreground">
                  Ignored column{parsed.ignoredColumns.length !== 1 ? "s" : ""} that {parsed.ignoredColumns.length !== 1 ? "are" : "is"} not a month:{" "}
                  <strong className="text-foreground">{parsed.ignoredColumns.join(", ")}</strong>.
                </div>
              )}

              {invalidCells.length > 0 && (
                <div className="p-2 rounded bg-orange-50 dark:bg-orange-950/20 text-xs text-orange-700 dark:text-orange-400" role="alert">
                  <p className="mb-1">
                    {invalidCells.length} cell{invalidCells.length !== 1 ? "s are" : " is"} not an
                    amount and will be skipped:
                  </p>
                  <ul className="space-y-0.5 font-mono">
                    {shownInvalid.map((cell, i) => (
                      <li key={i}>
                        Line {cell.line}, {cell.categoryName || cell.groupName}, {cell.header}: “{cell.value}”
                      </li>
                    ))}
                  </ul>
                  {invalidCells.length > INVALID_CELL_SAMPLE && (
                    <button
                      type="button"
                      onClick={() => setShowAllInvalid((v) => !v)}
                      className="underline hover:no-underline mt-1"
                    >
                      {showAllInvalid
                        ? "Show fewer"
                        : `Show ${invalidCells.length - INVALID_CELL_SAMPLE} more`}
                    </button>
                  )}
                </div>
              )}

              {duplicateCategoryNames.length > 0 && (
                <div className="p-2 rounded bg-muted/60 text-xs text-muted-foreground">
                  More than one approved row matches{" "}
                  <strong className="text-foreground">{duplicateCategoryNames.join(", ")}</strong>; the
                  last row in the file is used.
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mb-2 text-xs">
              <button
                type="button"
                onClick={() => setApprovedIds(new Set(matchableIds))}
                disabled={approvedIds.size === matchableIds.length || isWorking}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Approve all matches
              </button>
              {unapprovedSuggestions.length > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    setApprovedIds((prev) => new Set([...prev, ...unapprovedSuggestions]))
                  }
                  disabled={isWorking}
                  className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
                >
                  Approve {unapprovedSuggestions.length} similar name{unapprovedSuggestions.length !== 1 ? "s" : ""}
                </button>
              )}
              <button
                type="button"
                onClick={() => setApprovedIds(new Set())}
                disabled={approvedIds.size === 0 || isWorking}
                className="px-2 py-1 rounded border border-border hover:bg-muted disabled:opacity-40 transition-colors"
              >
                Clear
              </button>
            </div>

            <div className="flex-1 overflow-y-auto border border-border rounded text-xs mb-4 min-h-0">
              <table className="w-full" aria-label="Import match review">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium w-8">
                      <span className="sr-only">Approved</span>
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">Row in file</th>
                    <th className="px-2 py-1.5 text-left font-medium">Budget category</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matchResults.map((result, i) => {
                    const rowId = getImportRowId(i);
                    const isApproved = result.matchedCategoryId
                      ? approvedIds.has(rowId)
                      : false;
                    const valueCount = Object.keys(result.csvRow.monthValues).length;

                    return (
                      <tr
                        key={i}
                        className={`border-t border-border/50 ${result.matchStatus === "unmatched" ? "opacity-60" : ""}`}
                      >
                        <td className="px-2 py-1">
                          {result.matchedCategoryId && result.matchStatus !== "unmatched" && (
                            <Checkbox
                              checked={isApproved}
                              disabled={isWorking}
                              onCheckedChange={() => toggleApproval(rowId)}
                              aria-label={`Approve import of ${result.csvRow.categoryName}`}
                            />
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span className="text-muted-foreground">{result.csvRow.groupName}</span>
                          {" / "}
                          <span>{result.csvRow.categoryName}</span>
                          <span className="text-muted-foreground ml-1">
                            ({valueCount} value{valueCount !== 1 ? "s" : ""})
                          </span>
                        </td>
                        <td className="px-2 py-1 truncate max-w-48">
                          {result.matchedCategoryName ? (
                            <>
                              <span className="text-muted-foreground">{result.matchedGroupName}</span>
                              {" / "}
                              {result.matchedCategoryName}
                            </>
                          ) : (
                            <span className="text-destructive">No match</span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {result.matchStatus === "exact" && (
                            <span className="text-green-600 dark:text-green-400">Exact</span>
                          )}
                          {result.matchStatus === "suggested" && (
                            <span className="text-orange-600 dark:text-orange-400">Similar name</span>
                          )}
                          {result.matchStatus === "unmatched" && (
                            <span className="text-destructive">Not found</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {previewError && (
              <p className="text-xs text-destructive mb-2" role="alert">{previewError}</p>
            )}

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => goToStep("upload")} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleBuildPreview()}
                disabled={approvedIds.size === 0 || isWorking}
                aria-label={`Preview ${approvedIds.size} approved rows`}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {isWorking ? "Loading…" : `Preview ${approvedIds.size} row${approvedIds.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <h2 className="text-base font-semibold mb-1">Preview Changes</h2>
            <p className="text-xs text-muted-foreground mb-3" aria-live="polite">
              {rowsToStage.length === 0 ? (
                "Every imported value already matches the budget. Nothing to stage."
              ) : (
                <>
                  {rowsToStage.length} cell{rowsToStage.length !== 1 ? "s" : ""} change in{" "}
                  {changedMonthCount} month{changedMonthCount !== 1 ? "s" : ""}; net change{" "}
                  <span className="font-mono text-foreground">{formatDelta(netChange)}</span>.
                </>
              )}
              {unchangedCount > 0 && ` ${unchangedCount} already match and are skipped.`}
            </p>

            {unchangedCount > 0 && (
              <label className="flex items-center gap-2 text-xs mb-2 cursor-pointer">
                <Checkbox
                  checked={showUnchanged}
                  onCheckedChange={(checked) => setShowUnchanged(checked)}
                  aria-label="Show cells that already match"
                />
                Show cells that already match
              </label>
            )}

            <div className="flex-1 overflow-y-auto border border-border rounded text-xs mb-4 min-h-0">
              <table className="w-full" aria-label="Import preview">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Category</th>
                    <th className="px-2 py-1.5 text-left font-medium">Month</th>
                    <th className="px-2 py-1.5 text-right font-medium">Current</th>
                    <th className="px-2 py-1.5 text-right font-medium">New</th>
                    <th className="px-2 py-1.5 text-right font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, i) => {
                    const delta = row.nextBudgeted - row.previousBudgeted;
                    const staged = stagedEdits[`${row.month}:${row.categoryId}`];
                    // Same as the saved value, but a different value is staged:
                    // importing it replaces (undoes) that staged edit.
                    const replacesStaged =
                      delta === 0 && staged !== undefined && staged.nextBudgeted !== row.nextBudgeted;
                    return (
                      <tr
                        key={i}
                        className={`border-t border-border/50 ${delta === 0 ? "text-muted-foreground" : ""}`}
                      >
                        <td className="px-2 py-1 truncate max-w-40">
                          <span className="text-muted-foreground">{row.groupName}</span>
                          {" / "}
                          {row.categoryName}
                        </td>
                        <td className="px-2 py-1">{formatMonthLabel(row.month)}</td>
                        <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                          {formatAmount(row.previousBudgeted)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono font-medium">
                          {formatAmount(row.nextBudgeted)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono">
                          {replacesStaged
                            ? `Replaces staged ${formatAmount(staged.nextBudgeted)}`
                            : delta === 0
                              ? "No change"
                              : formatDelta(delta)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => goToStep("match")} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={rowsToStage.length === 0}
                aria-label={`Stage ${rowsToStage.length} import changes`}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Stage {rowsToStage.length} change{rowsToStage.length !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
