/**
 * ActualQL queries used to identify the active budget mode.
 *
 * The mode is derived by `deriveBudgetMode` from the row counts of the two
 * budget storage tables: `zero_budgets` (envelope/zero-based) and
 * `reflect_budgets` (tracking).
 *
 * Lives here (not under `features/overview`) so both `overview` and
 * `budget-management` import from a shared, feature-neutral location.
 */

type ScalarCountQuery = {
  ActualQLquery: {
    table: string;
    calculate: { $count: "$id" };
  };
};

export const ZERO_BUDGET_COUNT_QUERY = {
  ActualQLquery: { table: "zero_budgets", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const REFLECT_BUDGET_COUNT_QUERY = {
  ActualQLquery: { table: "reflect_budgets", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;
