"use client";

import { useState, useRef } from "react";
import { parseCsv, matchImportRows, buildImportPreview } from "../lib/budgetCsv";
import type { ImportRowResult, ImportPreviewEntry } from "../lib/budgetCsv";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { formatCurrency as formatAmount } from "../lib/format";
import type { LoadedCategory, LoadedGroup } from "../types";

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

function getImportRowId(index: number): string {
  return String(index);
}

/**
 * Three-step import wizard:
 *   1. Upload — file input + drag-and-drop → parseCsv
 *   2. Match review — exact/suggested/out-of-range/absent/unmatched rows
 *   3. Preview — approve changes → stageBulkEdits
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

  const [step, setStep] = useState<Step>("upload");
  const [parseError, setParseError] = useState<string | null>(null);
  const [matchResults, setMatchResults] = useState<ImportRowResult[]>([]);
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  const [previewRows, setPreviewRows] = useState<ImportPreviewEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- Step 1: Upload ----------

  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setParseError("Please upload a .csv file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const raw = e.target?.result as string;
      try {
        const rows = parseCsv(raw);
        if (rows.length === 0) {
          setParseError("The CSV file contains no data rows.");
          return;
        }
        const results = matchImportRows(rows, categories, availableMonths, activeMonths);
        setMatchResults(results);
        // Auto-approve exact matches
        const autoApproved = new Set<string>(
          results
            .map((r, index) =>
              r.matchStatus === "exact" && r.matchedCategoryId !== null
                ? getImportRowId(index)
                : null
            )
            .filter((rowId): rowId is string => rowId !== null)
        );
        setApprovedIds(autoApproved);
        setParseError(null);
        setStep("match");
      } catch {
        setParseError("Failed to parse the CSV file. Please check the file format.");
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ---------- Step 2: Match Review ----------

  const toggleApproval = (rowId: string) => {
    setApprovedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const outOfRangeMonths = Array.from(
    new Set(
      matchResults.flatMap((r) =>
        Object.entries(r.monthAvailability)
          .filter(([, status]) => status === "out-of-range")
          .map(([month]) => month)
      )
    )
  ).sort();

  const handleExtendRange = () => {
    if (onExtendRange && outOfRangeMonths.length > 0) {
      onExtendRange(outOfRangeMonths);
    }
  };

  const handleBuildPreview = () => {
    const approved = matchResults.filter(
      (r, index) => r.matchedCategoryId && approvedIds.has(getImportRowId(index))
    );
    const preview = buildImportPreview(approved, groups, categoriesById);
    setPreviewRows(preview);
    setStep("preview");
  };

  // ---------- Step 3: Preview + Confirm ----------

  const handleConfirm = () => {
    stageBulkEdits(
      previewRows.map((row) => ({
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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import budget data from CSV"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5 max-h-[90vh] flex flex-col">

        {step === "upload" && (
          <>
            <h2 className="text-base font-semibold mb-4">Import Budget CSV</h2>

            <div
              role="button"
              tabIndex={0}
              aria-label="Drop CSV file here or click to select"
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-8 mb-4 cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            >
              <span className="text-sm text-muted-foreground text-center">
                Drag and drop a CSV file here, or click to browse
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileInput}
                className="sr-only"
                aria-label="Select CSV file to import"
              />
            </div>

            {parseError && (
              <p className="text-xs text-destructive mb-3" role="alert">{parseError}</p>
            )}

            <p className="text-xs text-muted-foreground mb-4">
              Expected format: CSV with columns{" "}
              <code className="font-mono bg-muted px-1 rounded">Group Name, Category Name, YYYY-MM, …</code>
            </p>

            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === "match" && (
          <>
            <h2 className="text-base font-semibold mb-1">Review Matches</h2>
            <p className="text-xs text-muted-foreground mb-3">
              {approvedIds.size} of {matchResults.length} rows approved. Exact matches are pre-selected.
            </p>

            {outOfRangeMonths.length > 0 && (
              <div className="mb-3 p-2 rounded bg-orange-50 dark:bg-orange-950/20 text-xs text-orange-700 dark:text-orange-400" role="alert">
                Some rows reference months outside the current visible range:{" "}
                <strong>{outOfRangeMonths.join(", ")}</strong>.{" "}
                {onExtendRange && (
                  <button
                    type="button"
                    onClick={handleExtendRange}
                    className="underline hover:no-underline"
                    aria-label={`Extend visible range to include ${outOfRangeMonths.join(", ")}`}
                  >
                    Extend visible range
                  </button>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto border border-border rounded text-xs mb-4 min-h-0">
              <table className="w-full" role="grid" aria-label="CSV import match review">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium w-8">
                      <span className="sr-only">Approved</span>
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium">CSV row</th>
                    <th className="px-2 py-1.5 text-left font-medium">Match</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {matchResults.map((result, i) => {
                    const rowId = getImportRowId(i);
                    const isApproved = result.matchedCategoryId
                      ? approvedIds.has(rowId)
                      : false;
                    const hasError = result.matchStatus === "unmatched" ||
                      Object.values(result.monthAvailability).some((s) => s === "absent");

                    return (
                      <tr
                        key={i}
                        className={`border-t border-border/50 ${hasError ? "opacity-50" : ""}`}
                      >
                        <td className="px-2 py-1">
                          {result.matchedCategoryId && result.matchStatus !== "unmatched" && (
                            <input
                              type="checkbox"
                              checked={isApproved}
                              onChange={() => toggleApproval(rowId)}
                              aria-label={`Approve import of ${result.csvRow.categoryName}`}
                            />
                          )}
                        </td>
                        <td className="px-2 py-1">
                          <span className="text-muted-foreground">{result.csvRow.groupName}</span>
                          {" / "}
                          <span>{result.csvRow.categoryName}</span>
                        </td>
                        <td className="px-2 py-1 truncate max-w-32">
                          {result.matchedCategoryName ?? (
                            <span className="text-destructive">No match</span>
                          )}
                          {result.matchStatus === "suggested" && result.suggestionKey && (
                            <span className="text-orange-600 dark:text-orange-400 ml-1">
                              (suggestion: {result.suggestionKey})
                            </span>
                          )}
                        </td>
                        <td className="px-2 py-1">
                          {result.matchStatus === "exact" && (
                            <span className="text-green-600 dark:text-green-400">Exact</span>
                          )}
                          {result.matchStatus === "suggested" && (
                            <span className="text-orange-600 dark:text-orange-400">Suggested</span>
                          )}
                          {result.matchStatus === "unmatched" && (
                            <span className="text-destructive">Unmatched</span>
                          )}
                          {Object.values(result.monthAvailability).some((s) => s === "absent") && (
                            <span className="text-destructive ml-1">— month absent</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("upload")} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Back
              </button>
              <button
                type="button"
                onClick={handleBuildPreview}
                disabled={approvedIds.size === 0}
                aria-label={`Preview ${approvedIds.size} approved rows`}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Preview {approvedIds.size} row{approvedIds.size !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <h2 className="text-base font-semibold mb-1">Preview Changes</h2>
            <p className="text-xs text-muted-foreground mb-3">
              {previewRows.length} cell{previewRows.length !== 1 ? "s" : ""} will be staged.
            </p>

            <div className="flex-1 overflow-y-auto border border-border rounded text-xs mb-4 min-h-0">
              <table className="w-full" role="grid" aria-label="Import preview">
                <thead className="bg-muted/40 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Category</th>
                    <th className="px-2 py-1.5 text-left font-medium">Month</th>
                    <th className="px-2 py-1.5 text-right font-medium">Current</th>
                    <th className="px-2 py-1.5 text-right font-medium">New</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row, i) => (
                    <tr key={i} className="border-t border-border/50">
                      <td className="px-2 py-1 truncate max-w-32">{row.categoryName}</td>
                      <td className="px-2 py-1 font-mono">{row.month}</td>
                      <td className="px-2 py-1 text-right font-mono text-muted-foreground">
                        {formatAmount(row.previousBudgeted)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium">
                        {formatAmount(row.nextBudgeted)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setStep("match")} className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors">
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                aria-label={`Stage ${previewRows.length} import changes`}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Stage {previewRows.length} change{previewRows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
