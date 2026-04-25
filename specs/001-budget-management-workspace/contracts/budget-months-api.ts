/**
 * Budget Months API — Typed request/response contracts
 *
 * Source: agents/budget-api-end-points-mode-aware.md
 * All amounts are in minor units (integer, 100ths of currency unit).
 *
 * Route prefix (via Next.js proxy): all paths below are relative to the budget
 * sync root — proxied as-is to actual-http-api.
 */

// ---------------------------------------------------------------------------
// GET /months
// ---------------------------------------------------------------------------

export type GetMonthsResponse = {
  data: string[]; // e.g. ["2025-01", "2025-02", ...]
};

// ---------------------------------------------------------------------------
// GET /months/{month}
// ---------------------------------------------------------------------------

export type GetMonthResponse = {
  data: {
    month: string; // "YYYY-MM"
    incomeAvailable: number;
    lastMonthOverspent: number;
    forNextMonth: number;
    totalBudgeted: number;
    toBudget: number;
    fromLastMonth: number;
    totalIncome: number;
    totalSpent: number;
    totalBalance: number;
  };
};

// ---------------------------------------------------------------------------
// GET /months/{month}/categorygroups
// ---------------------------------------------------------------------------

export type GetCategoryGroupsResponse = {
  data: Array<{
    id: string;
    name: string;
    isIncome: boolean;
    hidden: boolean;
    budgeted: number;
    spent: number;
    balance: number;
    categories: Array<{
      id: string;
      name: string;
      groupId: string;
      isIncome: boolean;
      hidden: boolean;
      budgeted: number;
      spent: number;
      balance: number;
      carryover: boolean;
    }>;
  }>;
};

// ---------------------------------------------------------------------------
// GET /months/{month}/categories  (flat list — used when groups not needed)
// ---------------------------------------------------------------------------

export type GetCategoriesResponse = {
  data: Array<{
    id: string;
    name: string;
    groupId: string;
    isIncome: boolean;
    hidden: boolean;
    budgeted: number;
    spent: number;
    balance: number;
    carryover: boolean;
  }>;
};

// ---------------------------------------------------------------------------
// PATCH /months/{month}/categories/{categoryId}
// ---------------------------------------------------------------------------

export type PatchCategoryRequest = {
  budgeted: number; // minor units, integer
};

export type PatchCategoryResponse = {
  data: null; // 200 OK, empty body
};

// ---------------------------------------------------------------------------
// POST /months/{month}/categorytransfers
// ---------------------------------------------------------------------------

export type PostCategoryTransferRequest = {
  /** Source spending category — required in v1; pool routing deferred */
  fromCategoryId: string;
  /** Destination spending category — required in v1; pool routing deferred */
  toCategoryId: string;
  /** Amount to move, minor units, must be > 0 */
  amount: number;
};

export type PostCategoryTransferResponse = {
  data: null; // 200 OK, empty body
};

// ---------------------------------------------------------------------------
// POST /months/{month}/nextmonthbudgethold
// ---------------------------------------------------------------------------

export type PostNextMonthHoldRequest = {
  /** Amount to hold for next month, minor units, must be > 0 */
  amount: number;
};

export type PostNextMonthHoldResponse = {
  data: null; // 200 OK, empty body
};

// ---------------------------------------------------------------------------
// DELETE /months/{month}/nextmonthbudgethold
// ---------------------------------------------------------------------------

// No request body.
export type DeleteNextMonthHoldResponse = {
  data: null; // 200 OK, empty body
};

// ---------------------------------------------------------------------------
// Error shape (all endpoints)
// ---------------------------------------------------------------------------

export type BudgetApiError = {
  status: number;
  message: string;
};
