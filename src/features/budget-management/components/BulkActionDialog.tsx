"use client";

import { useState } from "react";
import { useBulkAction, type BulkActionType, type BulkActionParams, type BulkPreviewRow } from "../hooks/useBulkAction";
import { formatCurrency as formatAmount } from "../lib/format";
import type { BudgetCellSelection, LoadedCategory } from "../types";

type Props = {
  selection: BudgetCellSelection;
  activeMonths: string[];
  categories: LoadedCategory[];
  readOnlyMonths?: Set<string>;
  /** Map of month → category list for that month (for copy-from-month operations) */
  monthDataMap: Record<string, LoadedCategory[]>;
  onClose: () => void;
  /** When set, pre-selects the action and hides the action picker. */
  initialAction?: BulkActionType;
};

type Step = "action" | "preview" | "done";

const ACTION_LABELS: Record<BulkActionType, string> = {
  "copy-previous-month": "Copy previous month",
  "copy-from-month":     "Copy specific month",
  "set-to-zero":         "Set all to zero",
  "set-fixed":           "Set to fixed amount",
  "apply-percentage":    "Apply percentage change",
  "avg-3-months":        "Set to 3 months average",
  "avg-6-months":        "Set to 6 months average",
  "avg-12-months":       "Set to yearly average",
};

/**
 * Multi-step dialog for bulk budget actions on a selection.
 *
 * Step 1: Choose action type + parameters.
 * Step 2: Review preview table of proposed changes.
 * Step 3: Confirmation after apply.
 */
export function BulkActionDialog({
  selection,
  activeMonths,
  categories,
  readOnlyMonths,
  monthDataMap,
  onClose,
  initialAction,
}: Props) {
  const { preview, apply } = useBulkAction();

  const [step, setStep] = useState<Step>("action");
  const [action, setAction] = useState<BulkActionType>(initialAction ?? "copy-previous-month");
  const [fixedAmount, setFixedAmount] = useState("");
  const [sourceMonth, setSourceMonth] = useState(activeMonths[0] ?? "");
  const [percentage, setPercentage] = useState("100");
  const [previewRows, setPreviewRows] = useState<BulkPreviewRow[]>([]);
  const [paramError, setParamError] = useState<string | null>(null);

  const needsFixed = action === "set-fixed";
  const needsSourceMonth = action === "copy-from-month";
  const needsPercentage = action === "apply-percentage";

  const buildParams = (): BulkActionParams | undefined => {
    if (needsFixed) {
      const cents = Math.round(parseFloat(fixedAmount) * 100);
      if (isNaN(cents)) return undefined;
      return { fixedAmount: cents };
    }
    if (needsSourceMonth) return { sourceMonth };
    if (needsPercentage) {
      const pct = parseFloat(percentage);
      if (isNaN(pct)) return undefined;
      return { percentage: pct / 100 };
    }
    return undefined;
  };

  const handlePreview = () => {
    setParamError(null);
    const params = buildParams();

    if (needsFixed && params?.fixedAmount === undefined) {
      setParamError("Please enter a valid dollar amount.");
      return;
    }
    if (needsPercentage && params?.percentage === undefined) {
      setParamError("Please enter a valid percentage.");
      return;
    }

    const allRows = preview(action, selection, activeMonths, categories, monthDataMap, params);
    const rows = allRows?.filter((row) => !readOnlyMonths?.has(row.month));
    if (!allRows || allRows.length === 0) {
      setParamError("No cells would be changed by this action.");
      return;
    }
    if (!rows || rows.length === 0) {
      setParamError("All matching months are read-only.");
      return;
    }

    setPreviewRows(rows);
    setStep("preview");
  };

  const handleApply = () => {
    apply(previewRows);
    setStep("done");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Bulk budget action"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 p-5">
        {step === "action" && (
          <>
            <h2 className="text-base font-semibold mb-4">Bulk Action</h2>

            <div className="space-y-3 mb-4">
              {!initialAction && (
                <div>
                  <label htmlFor="bulk-action-type" className="block text-sm font-medium mb-1">
                    Action
                  </label>
                  <select
                    id="bulk-action-type"
                    value={action}
                    onChange={(e) => setAction(e.target.value as BulkActionType)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                  >
                    {(Object.keys(ACTION_LABELS) as BulkActionType[]).map((a) => (
                      <option key={a} value={a}>
                        {ACTION_LABELS[a]}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {needsFixed && (
                <div>
                  <label htmlFor="bulk-fixed-amount" className="block text-sm font-medium mb-1">
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
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background font-mono"
                    aria-label="Fixed amount in dollars"
                  />
                </div>
              )}

              {needsSourceMonth && (
                <div>
                  <label htmlFor="bulk-source-month" className="block text-sm font-medium mb-1">
                    Source month
                  </label>
                  <select
                    id="bulk-source-month"
                    value={sourceMonth}
                    onChange={(e) => setSourceMonth(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background"
                  >
                    {activeMonths.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}

              {needsPercentage && (
                <div>
                  <label htmlFor="bulk-percentage" className="block text-sm font-medium mb-1">
                    New value as % of current (e.g. 110 = 10% increase)
                  </label>
                  <input
                    id="bulk-percentage"
                    type="number"
                    min="0"
                    step="1"
                    value={percentage}
                    onChange={(e) => setPercentage(e.target.value)}
                    className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background font-mono"
                    aria-label="Percentage of current value"
                  />
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
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Preview changes
              </button>
            </div>
          </>
        )}

        {step === "preview" && (
          <>
            <h2 className="text-base font-semibold mb-1">Preview Changes</h2>
            <p className="text-xs text-muted-foreground mb-3">
              {previewRows.length} cell{previewRows.length !== 1 ? "s" : ""} will be updated.
            </p>

            <div className="max-h-64 overflow-y-auto border border-border rounded text-xs mb-4">
              <table className="w-full" role="grid" aria-label="Preview of bulk changes">
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
              <button
                type="button"
                onClick={() => setStep("action")}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-muted transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleApply}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                aria-label={`Apply ${previewRows.length} bulk changes`}
              >
                Apply {previewRows.length} change{previewRows.length !== 1 ? "s" : ""}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="text-base font-semibold mb-3">Changes Staged</h2>
            <p className="text-sm text-muted-foreground mb-4">
              {previewRows.length} cell{previewRows.length !== 1 ? "s" : ""} staged as a single undo step. Use Ctrl+Z to reverse.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
