"use client";

import { createContext, useContext } from "react";

/**
 * Display preferences the budget workspace owns and detail dialogs follow.
 * Today that is the decimals toggle in the grid toolbar.
 */
export type BudgetDisplay = {
  /** Show cents instead of whole numbers. */
  showDecimals: boolean;
};

const DEFAULT_DISPLAY: BudgetDisplay = { showDecimals: false };

const BudgetDisplayContext = createContext<BudgetDisplay>(DEFAULT_DISPLAY);

export const BudgetDisplayProvider = BudgetDisplayContext.Provider;

export function useBudgetDisplay(): BudgetDisplay {
  return useContext(BudgetDisplayContext);
}
