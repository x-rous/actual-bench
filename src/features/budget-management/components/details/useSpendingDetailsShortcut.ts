"use client";

import { useEffect } from "react";
import type { BudgetTransactionsDrilldown } from "../../lib/budgetTransactionBrowser";

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.matches("input, textarea, select, [contenteditable='true']") ||
    target.closest("[contenteditable='true']") != null
  );
}

export function useSpendingDetailsShortcut({
  target,
  onOpen,
}: {
  target: BudgetTransactionsDrilldown | null | undefined;
  onOpen: (target: BudgetTransactionsDrilldown) => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!target) return;
      if (event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== "d") return;
      if (isTextEntryTarget(event.target)) return;
      if (document.querySelector("[role='dialog']")) return;

      event.preventDefault();
      onOpen(target);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onOpen, target]);
}
