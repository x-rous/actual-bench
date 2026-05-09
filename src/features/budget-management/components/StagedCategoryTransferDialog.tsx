"use client";

import { useState, useId } from "react";
import { toast } from "sonner";
import { formatMonthLabel } from "@/lib/budget/monthMath";
import { formatCurrency } from "../lib/format";
import { useMonthData } from "../hooks/useMonthData";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useStagedTransfer } from "../hooks/useStagedTransfer";
import {
  CategoryBalanceCombobox,
  type CategoryWithBalance,
} from "./CategoryBalanceCombobox";

type Props = {
  month: string;
  clickedCategoryId: string;
  mode: "cover" | "transfer";
  onClose: () => void;
};

export function StagedCategoryTransferDialog({
  month,
  clickedCategoryId,
  mode,
  onClose,
}: Props) {
  const { data: monthData } = useMonthData(month);
  const edits = useBudgetEditsStore((s) => s.edits);
  const { stageTransfer } = useStagedTransfer();

  const amountInputId = useId();
  const comboboxId = useId();

  const [otherCategoryId, setOtherCategoryId] = useState("");
  const [amountStr, setAmountStr] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  // ── Effective value helpers ────────────────────────────────────────────────

  function effectiveBudgeted(catId: string): number {
    return (
      edits[`${month}:${catId}`]?.nextBudgeted ??
      monthData?.categoriesById[catId]?.budgeted ??
      0
    );
  }

  function effectiveBalance(catId: string): number {
    const cat = monthData?.categoriesById[catId];
    if (!cat) return 0;
    return cat.balance + (effectiveBudgeted(catId) - cat.budgeted);
  }

  // ── Eligible categories ───────────────────────────────────────────────────

  function buildEligible(filterPositiveBalance: boolean): CategoryWithBalance[] {
    if (!monthData) return [];
    const result: CategoryWithBalance[] = [];
    for (const groupId of monthData.groupOrder) {
      const group = monthData.groupsById[groupId];
      if (!group || group.hidden) continue;
      for (const catId of group.categoryIds) {
        const cat = monthData.categoriesById[catId];
        if (!cat || cat.isIncome || cat.hidden || cat.id === clickedCategoryId) continue;
        const bal = effectiveBalance(catId);
        if (filterPositiveBalance && bal <= 0) continue;
        result.push({
          id: cat.id,
          name: cat.name,
          groupId: cat.groupId,
          groupName: cat.groupName,
          effectiveBalance: bal,
        });
      }
    }
    return result;
  }

  const clickedBalance = effectiveBalance(clickedCategoryId);
  const clickedCat = monthData?.categoriesById[clickedCategoryId];
  const clickedName = clickedCat?.name ?? clickedCategoryId;

  // Cover mode: pick source with positive balance; transfer mode: pick any destination
  const eligibleCategories = buildEligible(mode === "cover");

  // ── Dynamic max amount ────────────────────────────────────────────────────

  function maxAmount(): number {
    if (mode === "transfer") {
      return clickedBalance;
    }
    // cover: capped by both the overspending and the source's available balance
    const absOverspent = Math.abs(clickedBalance);
    if (!otherCategoryId) return absOverspent;
    const srcBal = eligibleCategories.find((c) => c.id === otherCategoryId)?.effectiveBalance ?? 0;
    return Math.min(absOverspent, srcBal);
  }

  // Pre-fill amount once (on first render when monthData is ready)
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && monthData) {
    const prefillCents = mode === "transfer" ? clickedBalance : Math.abs(clickedBalance);
    setAmountStr((prefillCents / 100).toFixed(2));
    setPrefilled(true);
  }

  // ── Validation ────────────────────────────────────────────────────────────

  function validate(): boolean {
    const amount = Math.round(parseFloat(amountStr) * 100);

    if (!otherCategoryId) {
      const label = mode === "cover" ? "source" : "destination";
      setValidationError(`Please select a ${label} category.`);
      return false;
    }

    if (isNaN(amount) || amount <= 0) {
      setValidationError("Amount must be greater than 0.");
      return false;
    }

    const max = maxAmount();
    if (amount > max) {
      if (mode === "cover") {
        const srcName =
          eligibleCategories.find((c) => c.id === otherCategoryId)?.name ?? "source";
        const srcBal = eligibleCategories.find((c) => c.id === otherCategoryId)?.effectiveBalance ?? 0;
        setValidationError(
          `Amount exceeds available balance in ${srcName} (${formatCurrency(srcBal)} available).`
        );
      } else {
        setValidationError(
          `Amount exceeds your available balance (${formatCurrency(clickedBalance)} available).`
        );
      }
      return false;
    }

    setValidationError(null);
    return true;
  }

  // ── Confirm ───────────────────────────────────────────────────────────────

  function handleConfirm() {
    if (!validate()) return;

    const amount = Math.round(parseFloat(amountStr) * 100);

    const sourceCategoryId = mode === "cover" ? otherCategoryId : clickedCategoryId;
    const destinationCategoryId = mode === "cover" ? clickedCategoryId : otherCategoryId;

    stageTransfer({
      month,
      sourceCategoryId,
      destinationCategoryId,
      amount,
      sourceServerBudgeted: monthData?.categoriesById[sourceCategoryId]?.budgeted ?? 0,
      destServerBudgeted: monthData?.categoriesById[destinationCategoryId]?.budgeted ?? 0,
    });

    toast.success("Transfer staged — save to apply");
    onClose();
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const title = mode === "cover" ? "Cover Overspending" : "Transfer to Another Category";
  const monthLabel = formatMonthLabel(month, "long");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-sm mx-4 p-5">
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors ml-2 shrink-0"
          >
            ✕
          </button>
        </div>
        <p className="text-xs text-muted-foreground mb-4">{monthLabel}</p>

        <div className="h-px bg-border mb-4" />

        {/* Clicked category context */}
        <div className="mb-4 text-sm space-y-0.5">
          {mode === "cover" ? (
            <>
              <div className="text-muted-foreground text-xs">Covering:</div>
              <div className="font-medium">{clickedName}</div>
              <div className="text-xs text-destructive">
                Current overspending: {formatCurrency(Math.abs(clickedBalance))}
              </div>
            </>
          ) : (
            <>
              <div className="text-muted-foreground text-xs">From:</div>
              <div className="font-medium">{clickedName}</div>
              <div className="text-xs text-emerald-700 dark:text-emerald-400">
                Available balance: {formatCurrency(clickedBalance)}
              </div>
            </>
          )}
        </div>

        <div className="space-y-3 mb-4">
          {/* Amount input */}
          <div>
            <label htmlFor={amountInputId} className="block text-xs font-medium mb-1">
              {mode === "cover" ? "Amount to cover ($)" : "Amount to transfer ($)"}
            </label>
            <input
              id={amountInputId}
              type="number"
              min="0.01"
              step="0.01"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                setValidationError(null);
              }}
              placeholder="0.00"
              className="w-full text-sm border border-border rounded px-2 py-1.5 bg-background font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="Transfer amount in dollars"
            />
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Max: {formatCurrency(maxAmount())}
            </div>
          </div>

          {/* Category combobox */}
          <div>
            <label htmlFor={comboboxId} className="block text-xs font-medium mb-1">
              {mode === "cover" ? "Cover from" : "Transfer to"}
            </label>
            <CategoryBalanceCombobox
              id={comboboxId}
              categories={eligibleCategories}
              value={otherCategoryId}
              onChange={(id) => {
                setOtherCategoryId(id);
                setValidationError(null);
              }}
            />
            {mode === "cover" && (
              <div className="text-[10px] text-muted-foreground mt-0.5">
                Only categories with available balance shown
              </div>
            )}
          </div>
        </div>

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-destructive mb-3" role="alert">
            {validationError}
          </p>
        )}

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
            onClick={handleConfirm}
            className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Stage Transfer
          </button>
        </div>
      </div>
    </div>
  );
}
