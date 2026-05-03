"use client";

import { useRef, useState } from "react";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import { useEffectiveMonthFromContext } from "../context/MonthsDataContext";
import { parseBudgetExpression } from "../lib/budgetMath";
import { formatMinor } from "../lib/format";
import { isIncomeBlocked, isLargeChange } from "../lib/budgetValidation";
import { useCellKeymap, useCellEditKeymap } from "../keyboard/useBudgetKeymap";
import type { BudgetCellKey, BudgetMode, CellView, LoadedCategory, NavDirection } from "../types";

export type BudgetCellDragState = {
  activePointerId: number | null;
  origin: { x: number; y: number } | null;
  hasDragged: boolean;
};

type Props = {
  category: LoadedCategory;
  month: string;
  budgetMode: BudgetMode;
  cellView: CellView;
  isSelected: boolean;
  isAnchor: boolean;
  onFocus: (categoryId: string, month: string) => void;
  onRangeSelect: (categoryId: string, month: string) => void;
  onNavigate?: (dir: NavDirection) => void;
  /** Shared pointer-drag state from BudgetGrid for mouse/stylus range selection. */
  dragStateRef?: { current: BudgetCellDragState };
  /** Shared one-shot guard that prevents the click emitted after drag from clearing/opening edit. */
  suppressNextClickRef?: { current: boolean };
  /** Called when the user right-clicks the cell. */
  onContextMenuRequest?: (catId: string, month: string, carryover: boolean, x: number, y: number) => void;
  /** When true, renders the cell at 50% opacity (hidden category/group shown). */
  isDimmed?: boolean;
  /** Historical month missing from the API; visible for context but not editable. */
  isReadOnlyMonth?: boolean;
};

/** BM-16: minimum pointer travel (CSS px) before treating a drag as range-select. */
const DRAG_THRESHOLD_PX = 3;

/**
 * A single budget grid cell for a (category, month) intersection.
 *
 * Displays the budgeted amount (staged or persisted) for the specific month.
 * In edit mode, accepts numeric values or arithmetic expressions.
 * Income cells are hard-blocked in envelope mode.
 * Supports drag-to-select (via dragStateRef) and shift+arrow range extension.
 */
export function BudgetCell({
  category,
  month,
  budgetMode,
  cellView,
  isSelected,
  isAnchor,
  onFocus,
  onRangeSelect,
  onNavigate,
  dragStateRef,
  suppressNextClickRef,
  onContextMenuRequest,
  isDimmed,
  isReadOnlyMonth = false,
}: Props) {
  const dimClass = isDimmed ? " opacity-50" : "";
  const key: BudgetCellKey = `${month}:${category.id}`;
  // Subscribe only to THIS cell's staged edit — Zustand re-renders this cell
  // only when this specific edit changes, not on every keystroke anywhere.
  const stagedEdit = useBudgetEditsStore((s) => s.edits[key]);
  const stageEdit = useBudgetEditsStore((s) => s.stageEdit);
  const removeEdit = useBudgetEditsStore((s) => s.removeEdit);

  // Read precomputed effective state from MonthsDataProvider — the cascade
  // runs once per month at the provider level, not per cell.
  const effectiveData = useEffectiveMonthFromContext(month);
  const effectiveCategory = effectiveData?.categoriesById[category.id] ?? category;
  const hasMonthData = effectiveData != null;

  const currentBudgeted = effectiveCategory.budgeted;
  const blocked = isIncomeBlocked(category, budgetMode);
  // Editing is only possible in the "budgeted" view.
  const viewBlocked = cellView !== "budgeted";

  // The value shown in the cell (effective value for all views).
  // In Envelope mode, income cells always show actuals (received) — there is
  // no budget or variance concept for income in envelope budgeting.
  const envelopeIncome = budgetMode === "envelope" && category.isIncome;
  const displayMinor = envelopeIncome
    ? effectiveCategory.actuals
    : cellView === "spent"
    ? effectiveCategory.actuals
    : cellView === "balance"
    ? effectiveCategory.balance
    : currentBudgeted;


  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const enterEdit = (initialValue?: string) => {
    if (isReadOnlyMonth || blocked || viewBlocked || editing) return;
    setInputValue(initialValue ?? formatMinor(currentBudgeted));
    setInputError(null);
    setEditing(true);
    requestAnimationFrame(() => {
      if (initialValue !== undefined) {
        const len = initialValue.length;
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(len, len);
      } else {
        inputRef.current?.select();
      }
    });
  };

  /** Returns true if commit succeeded (valid parse), false on error. */
  const commitEdit = (): boolean => {
    if (!editing) return true;
    const result = parseBudgetExpression(inputValue);
    if (!result.ok) {
      setInputError(result.error);
      return false;
    }
    setEditing(false);
    setInputError(null);
    // originalValue is the server-persisted value before any staged edits.
    const originalValue = stagedEdit?.previousBudgeted ?? effectiveCategory.budgeted;
    if (result.value === originalValue) {
      // User reverted to the original — remove the staged edit so the cell is clean.
      if (stagedEdit) removeEdit(key);
    } else if (result.value !== currentBudgeted) {
      // Value genuinely changed from current — stage the edit.
      stageEdit({
        month,
        categoryId: category.id,
        nextBudgeted: result.value,
        previousBudgeted: originalValue,
        source: "manual",
      });
    }
    return true;
  };

  const cancelEdit = () => {
    setEditing(false);
    setInputError(null);
    setInputValue("");
  };

  const clearValue = () => {
    if (isReadOnlyMonth) return;
    if (currentBudgeted === 0) return;
    const originalValue = stagedEdit?.previousBudgeted ?? effectiveCategory.budgeted;
    if (originalValue === 0) {
      // Going back to the original value of 0 — remove the staged edit.
      if (stagedEdit) removeEdit(key);
    } else {
      stageEdit({
        month,
        categoryId: category.id,
        nextBudgeted: 0,
        previousBudgeted: originalValue,
        source: "manual",
      });
    }
  };

  const handleKeyDown = useCellEditKeymap({
    commitEdit,
    cancelEdit,
    navigate: (dir: NavDirection) => onNavigate?.(dir),
  });

  const handleCellKeyDown = useCellKeymap({
    blocked: blocked || isReadOnlyMonth,
    viewBlocked,
    navigate: (dir: NavDirection) => onNavigate?.(dir),
    enterEdit,
    clearValue,
  });

  /** On pointer down: reset drag state, capture origin, set this cell as the selection anchor. */
  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.shiftKey) return; // shift+click handled by click handler
    if (e.button !== 0) return;
    if (dragStateRef) {
      dragStateRef.current = {
        activePointerId: e.pointerId,
        origin: { x: e.clientX, y: e.clientY },
        hasDragged: false,
      };
    }
    onFocus(category.id, month);
  };

  /**
   * On pointer enter with the primary button held: extend the selection.
   * BM-16: only register a drag once the pointer has moved more than
   * DRAG_THRESHOLD_PX from the mousedown origin. Below the threshold, treat
   * the gesture as a click — preserves edit-mode entry on a clean tap even
   * if the pointer briefly grazes a neighbour cell.
   */
  const handlePointerEnter = (e: React.PointerEvent) => {
    if (e.buttons !== 1) {
      const dragState = dragStateRef?.current;
      if (dragStateRef && dragState?.activePointerId === e.pointerId) {
        dragStateRef.current = {
          activePointerId: null,
          origin: null,
          hasDragged: false,
        };
      }
      return;
    }
    const dragState = dragStateRef?.current;
    if (!dragState || dragState.activePointerId !== e.pointerId) return;
    const origin = dragState.origin;
    if (origin) {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    }
    dragStateRef.current = {
      ...dragState,
      hasDragged: true,
    };
    onRangeSelect(category.id, month);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const dragState = dragStateRef?.current;
    if (!dragState || dragState.activePointerId !== e.pointerId) return;
    if (dragState.hasDragged && suppressNextClickRef) {
      suppressNextClickRef.current = true;
    }
    dragStateRef.current = {
      activePointerId: null,
      origin: null,
      hasDragged: false,
    };
  };

  const handlePointerCancel = (e: React.PointerEvent) => {
    const dragState = dragStateRef?.current;
    if (!dragState || dragState.activePointerId !== e.pointerId) return;
    dragStateRef.current = {
      activePointerId: null,
      origin: null,
      hasDragged: false,
    };
  };

  /** Click: if shift, extend selection; otherwise enter edit (unless drag just ended). */
  const handleClick = (e: React.MouseEvent) => {
    if (suppressNextClickRef?.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.shiftKey) {
      onRangeSelect(category.id, month);
    } else if (!isReadOnlyMonth) {
      // Anchor was already set in mousedown; just open the editor.
      enterEdit();
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (isReadOnlyMonth) return;
    onContextMenuRequest?.(category.id, month, effectiveCategory.carryover, e.clientX, e.clientY);
  };

  const hasSaveError = !!stagedEdit?.saveError;
  const hasLargeChange =
    stagedEdit != null &&
    isLargeChange(stagedEdit.previousBudgeted, stagedEdit.nextBudgeted);

  // Carryover indicator (top-right triangle)
  const carryoverIndicator = effectiveCategory.carryover ? (
    <span
      className="absolute top-0 right-0 border-[5px] border-transparent border-t-blue-400/80 border-r-blue-400/80"
      title="Rollover enabled"
      aria-hidden="true"
    />
  ) : null;

  // Hover tooltip: show spent/balance when in budgeted view (they aren't directly visible).
  const hoverTitle =
    isReadOnlyMonth && !hasMonthData
      ? "No budget exists for this past month; budget cells are read-only."
      : cellView === "budgeted"
      ? `Spent: ${formatMinor(effectiveCategory.actuals)} | Balance: ${formatMinor(effectiveCategory.balance)}`
      : undefined;

  // ─── Non-editable cell ───────────────────────────────────────────────────────
  if (blocked || viewBlocked || isReadOnlyMonth) {
    const blockedLabel = isReadOnlyMonth
      ? `${category.name} budget for ${month} - no budget exists for this past month`
      : blocked
      ? `${category.name} budget for ${month} — income editing blocked in envelope mode`
      : `${category.name} ${cellView} for ${month}`;
    const displayText =
      isReadOnlyMonth && !hasMonthData ? "--" : formatMinor(displayMinor);

    let blockedCellClass =
      "relative h-7 px-2 flex items-center justify-end text-xs font-sans tabular-nums select-none outline-none border-r border-b border-border/50 transition-colors";

    blockedCellClass += blocked || isReadOnlyMonth ? " cursor-not-allowed" : " cursor-default";

    if (isAnchor) {
      blockedCellClass += " bg-muted/30 ring-2 ring-inset ring-foreground/80";
    } else if (isSelected) {
      blockedCellClass += " bg-primary/10";
    } else {
      blockedCellClass += " bg-muted/30 hover:bg-muted/40 focus:bg-muted/40";
    }

    return (
      <div
        className={`${blockedCellClass}${dimClass}`}
        role="gridcell"
        aria-label={blockedLabel}
        aria-selected={isSelected}
        aria-readonly="true"
        aria-disabled={blocked || isReadOnlyMonth ? "true" : undefined}
        onPointerDown={handlePointerDown}
        onPointerEnter={handlePointerEnter}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onClick={handleClick}
        onKeyDown={handleCellKeyDown}
        onContextMenu={handleContextMenu}
        tabIndex={0}
        title={hoverTitle}
        data-month={month}
        data-category-id={category.id}
      >
        {carryoverIndicator}
        <span
          className={
            isReadOnlyMonth && !hasMonthData
              ? "text-muted-foreground"
              : cellView === "balance" && displayMinor < 0
              ? "text-destructive"
              : cellView === "spent"
              ? "text-foreground"
              : "text-muted-foreground"
          }
        >
          {displayText}
        </span>
      </div>
    );
  }

  // ─── Editing cell ────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div
        className={`relative h-7 px-0.5 flex items-center border-r border-b border-border/50 bg-background ring-2 ring-inset ring-foreground/80 z-10${dimClass}`}
        role="gridcell"
        onPointerEnter={handlePointerEnter}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
        data-month={month}
        data-category-id={category.id}
      >
        {carryoverIndicator}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setInputError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          className="w-full h-full px-1.5 text-xs font-sans tabular-nums bg-transparent outline-none text-right"
          aria-label={`Edit budget for ${category.name} in ${month}`}
          autoComplete="off"
          spellCheck={false}
        />
        {inputError && (
          <div
            className="absolute top-full left-0 z-20 bg-destructive text-destructive-foreground text-xs px-2 py-1 rounded shadow"
            role="alert"
          >
            {inputError}
          </div>
        )}
      </div>
    );
  }

  // ─── Normal cell ─────────────────────────────────────────────────────────────
  let cellClass =
    "relative h-7 px-2 flex items-center justify-end text-xs font-sans tabular-nums select-none outline-none border-r border-b border-border/50 cursor-default transition-colors";

  if (isAnchor) {
    cellClass += " ring-2 ring-inset ring-foreground/80";
  } else if (isSelected) {
    cellClass += " bg-primary/10";
  } else {
    cellClass += " hover:bg-muted/40 focus:bg-muted/40";
  }

  if (stagedEdit) {
    cellClass += " bg-amber-50 dark:bg-amber-950/20";
  }

  if (hasSaveError) {
    cellClass += " bg-red-50 dark:bg-red-950/20";
  }

  return (
    <div
      className={`${cellClass}${dimClass}`}
      role="gridcell"
      tabIndex={0}
      aria-label={`${category.name} budget for ${month}${stagedEdit ? " (unsaved)" : ""}${hasSaveError ? " — save error" : ""}`}
      aria-selected={isSelected}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      onKeyDown={handleCellKeyDown}
      onContextMenu={handleContextMenu}
      title={hoverTitle}
      data-month={month}
      data-category-id={category.id}
    >
      {carryoverIndicator}
      <span
        className={
          stagedEdit
            ? "text-amber-700 dark:text-amber-400 font-semibold"
            : hasSaveError
            ? "text-destructive"
            : "text-foreground"
        }
      >
        {formatMinor(displayMinor)}
      </span>

      {hasLargeChange && (
        <span
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-orange-400"
          aria-hidden="true"
          title="Large change"
        />
      )}

      {hasSaveError && (
        <span
          className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-destructive"
          aria-hidden="true"
          title={stagedEdit?.saveError}
        />
      )}
    </div>
  );
}
