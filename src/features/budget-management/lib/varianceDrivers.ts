import type { LoadedMonthState } from "../types";

/**
 * RD-070 Top Variance Drivers — pure ranking + reconciliation (Tracking budgets).
 *
 * The feature ranks the categories that drive the gap between **budgeted** and
 * **actual** amounts, separately for expenses and income. All amounts are integer
 * **minor units** and every returned total reconciles **exactly** (no rounding
 * tolerance) — the sum of driver variances (+ Other) equals the scope total.
 *
 * Sign conventions (mirrors `budgetDetailsMetrics` / `getTrackingTargetValues`):
 * - Expense category budgets are returned as signed negative amounts; if an API
 *   surface provides a positive budget, we normalize it back to negative.
 * - Expense actuals preserve the API sign, so refunds can make actuals positive.
 * - Income budgeted/actual amounts are positive.
 *
 * Variance (favourable = positive) is `actual − budgeted` for both sides.
 */

export type VarianceSide = "expense" | "income";

/** A category normalized to the signed display contract for its side. */
export type VarianceCategoryInput = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  budgetedMinor: number;
  actualMinor: number;
};

export type VarianceDriver = VarianceCategoryInput & {
  /** Signed minor units; positive = favourable (under budget / above budget). */
  varianceMinor: number;
  favourable: boolean;
  /**
   * Share of this driver within its **own side** of the variance
   * (favourable drivers vs total favourable; unfavourable vs total unfavourable),
   * so opposing drivers never cancel. `null` when that side sums to zero.
   */
  contribution: number | null;
};

export type VarianceOther = {
  count: number;
  budgetedMinor: number;
  actualMinor: number;
  varianceMinor: number;
};

export type VarianceDriversResult = {
  side: VarianceSide;
  totalBudgetedMinor: number;
  totalActualMinor: number;
  /** Σ of every category's variance — exact, reconciles to drivers + other. */
  totalVarianceMinor: number;
  /** Direction of the total (favourable = under/above budget). */
  favourable: boolean;
  /** Top-N by absolute variance (or all when `showAll`), favourable + unfavourable. */
  drivers: VarianceDriver[];
  /** Remaining categories beyond top-N; `null` when none or `showAll`. */
  other: VarianceOther | null;
};

export const DEFAULT_TOP_N = 5;

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  let total = 0;
  for (const item of items) total += pick(item);
  return total;
}

function signedVariance(budgetedMinor: number, actualMinor: number): number {
  return actualMinor - budgetedMinor;
}

/**
 * Sum each category's budgeted/actual across the given month states (already
 * filtered to the in-scope closed months by the caller), for one side. Excludes
 * hidden categories and hidden groups (Tracking-budget variance analysis
 * convention), like the Budget page and details panel display.
 */
export function aggregateCategoryVariances(
  states: readonly LoadedMonthState[],
  side: VarianceSide
): VarianceCategoryInput[] {
  const wantIncome = side === "income";
  const byId = new Map<string, VarianceCategoryInput>();

  for (const state of states) {
    for (const category of Object.values(state.categoriesById)) {
      if (category.isIncome !== wantIncome || category.hidden) continue;
      if (state.groupsById[category.groupId]?.hidden) continue;
      const budgetedMinor = wantIncome
        ? category.budgeted
        : category.budgeted === 0
          ? 0
          : -Math.abs(category.budgeted);
      const actualMinor = category.actuals;

      const existing = byId.get(category.id);
      if (existing) {
        existing.budgetedMinor += budgetedMinor;
        existing.actualMinor += actualMinor;
      } else {
        byId.set(category.id, {
          id: category.id,
          name: category.name,
          groupId: category.groupId,
          groupName: category.groupName,
          budgetedMinor,
          actualMinor,
        });
      }
    }
  }

  return [...byId.values()];
}

/**
 * Rank drivers by absolute variance, split the "% of side" segregated so
 * favourable and unfavourable drivers never cancel, and bucket the tail as Other.
 * The returned totals are exact sums — callers assert reconciliation against them.
 */
export function computeVarianceDrivers(
  categories: readonly VarianceCategoryInput[],
  side: VarianceSide,
  options: { topN?: number; showAll?: boolean } = {}
): VarianceDriversResult {
  const topN = options.topN ?? DEFAULT_TOP_N;

  const scored = categories.map((category) => {
    const varianceMinor = signedVariance(
      category.budgetedMinor,
      category.actualMinor
    );
    return { ...category, varianceMinor, favourable: varianceMinor >= 0 };
  });

  const totalBudgetedMinor = sum(scored, (row) => row.budgetedMinor);
  const totalActualMinor = sum(scored, (row) => row.actualMinor);
  const totalVarianceMinor = sum(scored, (row) => row.varianceMinor);

  // Side-segregated denominators (positive magnitudes).
  const favourableTotal = sum(
    scored.filter((row) => row.varianceMinor > 0),
    (row) => row.varianceMinor
  );
  const unfavourableTotal = -sum(
    scored.filter((row) => row.varianceMinor < 0),
    (row) => row.varianceMinor
  );

  const withContribution: VarianceDriver[] = scored.map((row) => ({
    ...row,
    contribution:
      row.varianceMinor > 0
        ? favourableTotal > 0
          ? row.varianceMinor / favourableTotal
          : null
        : row.varianceMinor < 0
          ? unfavourableTotal > 0
            ? -row.varianceMinor / unfavourableTotal
            : null
          : null,
  }));

  // Sort by |variance| desc, then name for a stable, deterministic order.
  const sorted = [...withContribution].sort(
    (a, b) =>
      Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor) ||
      a.name.localeCompare(b.name)
  );

  const base = {
    side,
    totalBudgetedMinor,
    totalActualMinor,
    totalVarianceMinor,
    favourable: totalVarianceMinor >= 0,
  };

  if (options.showAll || sorted.length <= topN) {
    return { ...base, drivers: sorted, other: null };
  }

  const drivers = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const other: VarianceOther = {
    count: rest.length,
    budgetedMinor: sum(rest, (row) => row.budgetedMinor),
    actualMinor: sum(rest, (row) => row.actualMinor),
    varianceMinor: sum(rest, (row) => row.varianceMinor),
  };

  return { ...base, drivers, other };
}

// ── Group tree (RD-070 v3 analysis view) ─────────────────────────────────────

/** A category row inside a group. */
export type VarianceLeaf = {
  id: string;
  name: string;
  budgetedMinor: number;
  actualMinor: number;
  varianceMinor: number;
  favourable: boolean;
  /** variance ÷ budget (signed); `null` when the category has no budget. */
  pctOfBudget: number | null;
  /** Share within the parent group's same-direction variance; `null` if that side is 0. */
  contribution: number | null;
};

/** A category group with its child categories and a per-month variance series. */
export type VarianceGroup = Omit<VarianceLeaf, "contribution"> & {
  /** Share within all groups' same-direction variance; `null` if that side is 0. */
  contribution: number | null;
  /** Per-month variance (favourable-positive), one entry per in-scope month, ordered. */
  monthly: number[];
  children: VarianceLeaf[];
};

export type VarianceTotals = {
  budgetedMinor: number;
  actualMinor: number;
  varianceMinor: number;
  /** Σ |variance| of unfavourable groups (magnitude). */
  overspendMinor: number;
  /** Σ variance of favourable groups (magnitude). */
  savedMinor: number;
};

export type VarianceTree = {
  side: VarianceSide;
  /** Groups sorted by absolute variance, descending. Each keeps its children. */
  groups: VarianceGroup[];
  /** Number of in-scope months backing the per-group `monthly` series. */
  monthCount: number;
  totals: VarianceTotals;
};

function normalizeAmount(
  wantIncome: boolean,
  budgeted: number,
  actuals: number
): { budgetedMinor: number; actualMinor: number } {
  return {
    budgetedMinor: wantIncome
      ? budgeted
      : budgeted === 0
        ? 0
        : -Math.abs(budgeted),
    actualMinor: actuals,
  };
}

function pctOfBudget(varianceMinor: number, budgetedMinor: number): number | null {
  return budgetedMinor !== 0 ? varianceMinor / Math.abs(budgetedMinor) : null;
}

/**
 * Roll categories up to their groups across the in-scope months, keeping the
 * child categories and a per-group per-month variance series (for sparklines).
 * Every level reconciles exactly: Σ children = group, Σ monthly = group variance,
 * Σ groups = totals. Hidden categories are excluded (Tracking-budget convention).
 */
export function buildVarianceTree(
  states: readonly LoadedMonthState[],
  side: VarianceSide
): VarianceTree {
  const wantIncome = side === "income";
  const monthCount = states.length;

  type CatAcc = {
    id: string;
    name: string;
    budgetedMinor: number;
    actualMinor: number;
    varianceMinor: number;
  };
  type GroupAcc = {
    id: string;
    name: string;
    budgetedMinor: number;
    actualMinor: number;
    varianceMinor: number;
    monthly: number[];
    cats: Map<string, CatAcc>;
  };
  const groupsById = new Map<string, GroupAcc>();
  const order: string[] = [];

  states.forEach((state, monthIndex) => {
    for (const category of Object.values(state.categoriesById)) {
      // Tracking budgets exclude hidden categories — and hidden groups (with all
      // their children) — from variance analysis.
      if (category.isIncome !== wantIncome || category.hidden) continue;
      if (state.groupsById[category.groupId]?.hidden) continue;
      const { budgetedMinor, actualMinor } = normalizeAmount(
        wantIncome,
        category.budgeted,
        category.actuals
      );
      const variance = signedVariance(budgetedMinor, actualMinor);

      let group = groupsById.get(category.groupId);
      if (!group) {
        group = {
          id: category.groupId,
          name: category.groupName,
          budgetedMinor: 0,
          actualMinor: 0,
          varianceMinor: 0,
          monthly: new Array<number>(monthCount).fill(0),
          cats: new Map(),
        };
        groupsById.set(category.groupId, group);
        order.push(category.groupId);
      }
      group.budgetedMinor += budgetedMinor;
      group.actualMinor += actualMinor;
      group.varianceMinor += variance;
      group.monthly[monthIndex] += variance;

      const cat = group.cats.get(category.id);
      if (cat) {
        cat.budgetedMinor += budgetedMinor;
        cat.actualMinor += actualMinor;
        cat.varianceMinor += variance;
      } else {
        group.cats.set(category.id, {
          id: category.id,
          name: category.name,
          budgetedMinor,
          actualMinor,
          varianceMinor: variance,
        });
      }
    }
  });

  const rawGroups = order.map((id) => groupsById.get(id)!);

  // Side-segregated denominators, at the group granularity shown.
  const overspendMinor = -sum(
    rawGroups.filter((g) => g.varianceMinor < 0),
    (g) => g.varianceMinor
  );
  const savedMinor = sum(
    rawGroups.filter((g) => g.varianceMinor > 0),
    (g) => g.varianceMinor
  );

  const groups: VarianceGroup[] = rawGroups
    .map((g) => {
      const varianceMinor = g.varianceMinor;
      const favourable = varianceMinor >= 0;

      // Child contributions use the parent group's same-direction totals.
      const childRows = [...g.cats.values()];
      const childOver = -sum(childRows.filter((c) => c.varianceMinor < 0), (c) => c.varianceMinor);
      const childUnder = sum(childRows.filter((c) => c.varianceMinor > 0), (c) => c.varianceMinor);
      const children: VarianceLeaf[] = childRows
        .map((c) => ({
          id: c.id,
          name: c.name,
          budgetedMinor: c.budgetedMinor,
          actualMinor: c.actualMinor,
          varianceMinor: c.varianceMinor,
          favourable: c.varianceMinor >= 0,
          pctOfBudget: pctOfBudget(c.varianceMinor, c.budgetedMinor),
          contribution:
            c.varianceMinor > 0
              ? childUnder > 0
                ? c.varianceMinor / childUnder
                : null
              : c.varianceMinor < 0
                ? childOver > 0
                  ? -c.varianceMinor / childOver
                  : null
                : null,
        }))
        .sort(
          (a, b) =>
            Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor) ||
            a.name.localeCompare(b.name)
        );

      return {
        id: g.id,
        name: g.name,
        budgetedMinor: g.budgetedMinor,
        actualMinor: g.actualMinor,
        varianceMinor,
        favourable,
        pctOfBudget: pctOfBudget(varianceMinor, g.budgetedMinor),
        contribution:
          varianceMinor > 0
            ? savedMinor > 0
              ? varianceMinor / savedMinor
              : null
            : varianceMinor < 0
              ? overspendMinor > 0
                ? -varianceMinor / overspendMinor
                : null
              : null,
        monthly: g.monthly,
        children,
      };
    })
    .sort(
      (a, b) =>
        Math.abs(b.varianceMinor) - Math.abs(a.varianceMinor) ||
        a.name.localeCompare(b.name)
    );

  const totals: VarianceTotals = {
    budgetedMinor: sum(groups, (g) => g.budgetedMinor),
    actualMinor: sum(groups, (g) => g.actualMinor),
    varianceMinor: sum(groups, (g) => g.varianceMinor),
    overspendMinor,
    savedMinor,
  };

  return { side, groups, monthCount, totals };
}

/** True when a side has any budget or actual to show (drives tab enable/disable). */
export function treeHasData(tree: VarianceTree): boolean {
  return tree.groups.some((g) => g.budgetedMinor !== 0 || g.actualMinor !== 0);
}
