import type { LoadedMonthState } from "../../types";
import {
  EMPTY_CELL,
  normalizeCategoryCell,
  pctOfBudget,
  shareOfSide,
  splitGross,
  unfavourableAmount,
  vocabulary,
  type CategoryCell,
  type GrossSplit,
  type VarianceMode,
  type VarianceSide,
  type VarianceVocabulary,
} from "./varianceMath";

/**
 * The one view model behind the Variance Drivers dialog.
 *
 * The headline, waterfall, monthly chart, driver list and investigation panel
 * all read from it, so no two of them can disagree about a total. It is built
 * from the monthly budget payload only: no transactions go in, and none can
 * change a figure here.
 */

export type VarianceLevel = "group" | "category";

export type VarianceInput = {
  mode: VarianceMode;
  side: VarianceSide;
  /** The period shown, oldest first. */
  months: readonly string[];
  /**
   * Every loaded month the calculation may read, the period and any context
   * (recent months, history). Months outside `months` are never summed into
   * the period's totals.
   */
  statesByMonth: ReadonlyMap<string, LoadedMonthState>;
  /**
   * Category ids in scope. With no ids and no groups, every category on the
   * side is in scope.
   */
  categoryIds?: readonly string[] | null;
  /**
   * Groups in scope, whole. A group stands for every category in it in every
   * loaded month, including hidden ones when the mode counts them, which a
   * list of visible category ids would leave out.
   */
  groupIds?: readonly string[] | null;
  /** `auto` shows groups when the scope spans more than one, else categories. */
  level?: VarianceLevel | "auto";
};

export type ScopedCategory = {
  id: string;
  name: string;
  groupId: string;
  groupName: string;
  hidden: boolean;
  cells: ReadonlyMap<string, CategoryCell>;
};

export type EnvelopeAggregate = {
  /** Money brought into the first month of the period. */
  carriedIn: number;
  /** Sum of category balances at the end of the last month. Can be negative. */
  closing: number;
  /** Sum of negative closing balances, as a positive amount. */
  deficit: number;
  /** Sum of positive closing balances. */
  available: number;
  /**
   * Deficits wiped at a month end because the category does not carry over,
   * excluding the last month (those are still open). They reduce the next
   * month's To Budget instead of staying in the envelope.
   */
  clearedFromToBudget: number;
  /** Whatever the bridge cannot explain. Zero when the payload is consistent. */
  otherAdjustments: number;
  closingByMonth: number[];
  availableByMonth: number[];
  deficitByMonth: number[];
  /** Deficit that does not carry over, per month. */
  clearedByMonth: number[];
  /** Deficit that carries into the next month, per month. */
  rolledByMonth: number[];
  deficitMonths: number;
  /** Categories with carryover on in the last month. */
  carryoverCount: number;
};

export type Aggregate = {
  months: readonly string[];
  budget: number;
  actual: number;
  /** Signed; positive = unfavourable. */
  variance: number;
  budgetByMonth: number[];
  actualByMonth: number[];
  varianceByMonth: number[];
  /** Months whose variance was unfavourable. */
  monthsOver: number;
  /** Months that had a loaded state. */
  monthsPresent: number;
  envelope: EnvelopeAggregate | null;
};

export type DriverDirection = "unfavourable" | "favourable" | "neutral";
export type EnvelopeStatus = "deficit" | "covered" | "available" | "none";

export type Driver = {
  id: string;
  name: string;
  kind: VarianceLevel;
  groupId: string;
  groupName: string;
  hidden: boolean;
  categoryIds: string[];
  aggregate: Aggregate;
  budget: number;
  actual: number;
  /** Signed unfavourable amount. */
  variance: number;
  direction: DriverDirection;
  /** Share of the gross side it belongs to; `null` when undefined. */
  share: number | null;
  /** Variance as a fraction of budget; `null` when the budget is zero. */
  pctOfBudget: number | null;
  /** Budget is zero and money moved. */
  unbudgeted: boolean;
  status: EnvelopeStatus;
};

export type MonthPoint = {
  month: string;
  present: boolean;
  budget: number;
  actual: number;
  variance: number;
  /** Running total of `variance` through this month, within the period. */
  cumulative: number;
  envelope: {
    available: number;
    deficit: number;
    closing: number;
    clearedFromToBudget: number;
    rolledOver: number;
  } | null;
};

export type VarianceModel = {
  mode: VarianceMode;
  side: VarianceSide;
  vocab: VarianceVocabulary;
  months: readonly string[];
  /** Period months with no loaded state. */
  missingMonths: string[];
  /** False for Envelope income, which has no budgets to compare against. */
  supported: boolean;
  level: VarianceLevel;
  /** More than one group in scope, so a Groups | Categories choice is meaningful. */
  canChooseLevel: boolean;
  groupCount: number;
  categories: ScopedCategory[];
  drivers: Driver[];
  total: Aggregate;
  gross: GrossSplit;
  monthly: MonthPoint[];
  statesByMonth: ReadonlyMap<string, LoadedMonthState>;
};

/**
 * Tracking leaves hidden categories and groups out of variance analysis, as
 * Actual's own totals do. Envelope keeps them: hidden money is still assigned.
 */
function isCounted(
  state: LoadedMonthState,
  categoryHidden: boolean,
  groupId: string,
  mode: VarianceMode
): boolean {
  if (mode === "envelope") return true;
  if (categoryHidden) return false;
  return !state.groupsById[groupId]?.hidden;
}

export function collectScopedCategories(
  input: Pick<VarianceInput, "mode" | "side" | "statesByMonth" | "categoryIds" | "groupIds">
): ScopedCategory[] {
  const wantIncome = input.side === "income";
  const ids = new Set(input.categoryIds ?? []);
  const groups = new Set(input.groupIds ?? []);
  const scoped = ids.size > 0 || groups.size > 0;
  const byId = new Map<
    string,
    {
      id: string;
      name: string;
      groupId: string;
      groupName: string;
      hidden: boolean;
      cells: Map<string, CategoryCell>;
    }
  >();

  // Oldest first, so the newest state names the category if it was renamed.
  const months = [...input.statesByMonth.keys()].sort();
  for (const month of months) {
    const state = input.statesByMonth.get(month)!;
    for (const category of Object.values(state.categoriesById)) {
      if (category.isIncome !== wantIncome) continue;
      if (scoped && !ids.has(category.id) && !groups.has(category.groupId)) continue;
      if (!isCounted(state, category.hidden, category.groupId, input.mode)) continue;

      let entry = byId.get(category.id);
      if (!entry) {
        entry = {
          id: category.id,
          name: category.name,
          groupId: category.groupId,
          groupName: category.groupName,
          hidden: category.hidden,
          cells: new Map(),
        };
        byId.set(category.id, entry);
      }
      entry.name = category.name;
      entry.groupId = category.groupId;
      entry.groupName = category.groupName;
      entry.hidden = category.hidden;
      entry.cells.set(month, normalizeCategoryCell(category, input.side));
    }
  }
  return [...byId.values()];
}

const zeros = (n: number): number[] => new Array<number>(n).fill(0);

/** Sum a set of categories over any run of months. */
export function aggregateCategories(
  categories: readonly ScopedCategory[],
  months: readonly string[],
  side: VarianceSide,
  mode: VarianceMode
): Aggregate {
  const n = months.length;
  const budgetByMonth = zeros(n);
  const actualByMonth = zeros(n);
  const presentByMonth = zeros(n);
  const envelope = mode === "envelope" && side === "expense";
  const closingByMonth = zeros(n);
  const availableByMonth = zeros(n);
  const deficitByMonth = zeros(n);
  const clearedByMonth = zeros(n);
  const rolledByMonth = zeros(n);
  let carriedIn = 0;
  let carryoverCount = 0;

  for (const category of categories) {
    months.forEach((month, k) => {
      const cell = category.cells.get(month) ?? EMPTY_CELL;
      if (!cell.present) return;
      presentByMonth[k] = 1;
      budgetByMonth[k] += cell.budget;
      actualByMonth[k] += cell.actual;
      if (!envelope) return;
      closingByMonth[k] += cell.balance;
      if (cell.balance < 0) {
        deficitByMonth[k] += -cell.balance;
        if (cell.carryover) rolledByMonth[k] += -cell.balance;
        else clearedByMonth[k] += -cell.balance;
      } else {
        availableByMonth[k] += cell.balance;
      }
      if (k === 0) carriedIn += cell.carriedIn;
      if (k === n - 1 && cell.carryover) carryoverCount += 1;
    });
  }

  const varianceByMonth = budgetByMonth.map((budget, k) =>
    unfavourableAmount(side, budget, actualByMonth[k])
  );
  const budget = budgetByMonth.reduce((a, b) => a + b, 0);
  const actual = actualByMonth.reduce((a, b) => a + b, 0);

  let env: EnvelopeAggregate | null = null;
  if (envelope && n > 0) {
    const cleared = clearedByMonth.slice(0, n - 1).reduce((a, b) => a + b, 0);
    const closing = closingByMonth[n - 1];
    env = {
      carriedIn,
      closing,
      deficit: deficitByMonth[n - 1],
      available: availableByMonth[n - 1],
      clearedFromToBudget: cleared,
      otherAdjustments: closing - (carriedIn + budget - actual + cleared),
      closingByMonth,
      availableByMonth,
      deficitByMonth,
      clearedByMonth,
      rolledByMonth,
      deficitMonths: deficitByMonth.filter((x) => x > 0).length,
      carryoverCount,
    };
  }

  return {
    months,
    budget,
    actual,
    variance: unfavourableAmount(side, budget, actual),
    budgetByMonth,
    actualByMonth,
    varianceByMonth,
    monthsOver: varianceByMonth.filter((x) => x > 0).length,
    monthsPresent: presentByMonth.reduce((a, b) => a + b, 0),
    envelope: env,
  };
}

function directionOf(variance: number): DriverDirection {
  return variance > 0 ? "unfavourable" : variance < 0 ? "favourable" : "neutral";
}

function statusOf(aggregate: Aggregate, variance: number): EnvelopeStatus {
  const env = aggregate.envelope;
  if (!env) return "none";
  if (env.deficit > 0) return "deficit";
  if (variance > 0) return "covered";
  return env.available > 0 ? "available" : "none";
}

/** Unfavourable first (largest first), then neutral, then favourable (largest first). */
function compareDrivers(a: Driver, b: Driver): number {
  const rank = (d: Driver) => (d.variance > 0 ? 0 : d.variance === 0 ? 1 : 2);
  return (
    rank(a) - rank(b) ||
    Math.abs(b.variance) - Math.abs(a.variance) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * One point per month for a set of categories. `cumulative` is the running
 * total of variance from the first month listed, so it is only meaningful over
 * the period itself.
 */
export function monthPoints(
  categories: readonly ScopedCategory[],
  months: readonly string[],
  side: VarianceSide,
  mode: VarianceMode,
  statesByMonth: ReadonlyMap<string, LoadedMonthState>
): MonthPoint[] {
  const total = aggregateCategories(categories, months, side, mode);
  let cumulative = 0;
  return months.map((month, k) => {
    cumulative += total.varianceByMonth[k];
    const env = total.envelope;
    return {
      month,
      present: statesByMonth.has(month),
      budget: total.budgetByMonth[k],
      actual: total.actualByMonth[k],
      variance: total.varianceByMonth[k],
      cumulative,
      envelope: env
        ? {
            available: env.availableByMonth[k],
            deficit: env.deficitByMonth[k],
            closing: env.closingByMonth[k],
            clearedFromToBudget: env.clearedByMonth[k],
            rolledOver: env.rolledByMonth[k],
          }
        : null,
    };
  });
}

/** Points for any run of months over the model's own scope, e.g. the recent months. */
export function buildMonthPoints(
  model: VarianceModel,
  months: readonly string[]
): MonthPoint[] {
  return monthPoints(model.categories, months, model.side, model.mode, model.statesByMonth);
}

export function buildVarianceModel(input: VarianceInput): VarianceModel {
  const { mode, side, months, statesByMonth } = input;
  const vocab = vocabulary(mode, side);
  // Envelope plans no income: categories carry only `received`, so there is
  // nothing to compare it with.
  const supported = !(mode === "envelope" && side === "income");

  const categories = supported
    ? collectScopedCategories({
        mode,
        side,
        statesByMonth,
        categoryIds: input.categoryIds,
        groupIds: input.groupIds,
      })
    : [];
  const groupIds = new Set(categories.map((c) => c.groupId));
  const canChooseLevel = groupIds.size > 1;
  const level: VarianceLevel =
    canChooseLevel && (input.level ?? "auto") !== "category" ? "group" : "category";

  const makeDriver = (
    id: string,
    name: string,
    kind: VarianceLevel,
    members: ScopedCategory[]
  ): Driver => {
    const aggregate = aggregateCategories(members, months, side, mode);
    return {
      id,
      name,
      kind,
      groupId: members[0].groupId,
      groupName: members[0].groupName,
      hidden: members.every((m) => m.hidden),
      categoryIds: members.map((m) => m.id),
      aggregate,
      budget: aggregate.budget,
      actual: aggregate.actual,
      variance: aggregate.variance,
      direction: directionOf(aggregate.variance),
      share: null,
      pctOfBudget: pctOfBudget(aggregate.variance, aggregate.budget),
      unbudgeted: aggregate.budget === 0 && aggregate.actual > 0,
      status: statusOf(aggregate, aggregate.variance),
    };
  };

  let drivers: Driver[];
  if (level === "group") {
    const byGroup = new Map<string, ScopedCategory[]>();
    for (const category of categories) {
      const list = byGroup.get(category.groupId) ?? [];
      list.push(category);
      byGroup.set(category.groupId, list);
    }
    drivers = [...byGroup.entries()].map(([id, members]) =>
      makeDriver(id, members[0].groupName, "group", members)
    );
  } else {
    drivers = categories.map((c) => makeDriver(c.id, c.name, "category", [c]));
  }

  // A driver with no budget and no movement has nothing to explain.
  drivers = drivers.filter((d) => d.budget !== 0 || d.actual !== 0);

  const gross = splitGross(drivers.map((d) => d.variance));
  drivers = drivers
    .map((d) => ({ ...d, share: shareOfSide(d.variance, gross) }))
    .sort(compareDrivers);

  const total = aggregateCategories(categories, months, side, mode);
  const monthly = monthPoints(categories, months, side, mode, statesByMonth);

  return {
    mode,
    side,
    vocab,
    months,
    missingMonths: months.filter((m) => !statesByMonth.has(m)),
    supported,
    level,
    canChooseLevel,
    groupCount: groupIds.size,
    categories,
    drivers,
    total,
    gross,
    monthly,
    statesByMonth,
  };
}

/** Aggregate any subset of the scoped categories over any run of months. */
export function aggregateFor(
  model: VarianceModel,
  categoryIds: readonly string[],
  months: readonly string[]
): Aggregate {
  const wanted = new Set(categoryIds);
  return aggregateCategories(
    model.categories.filter((c) => wanted.has(c.id)),
    months,
    model.side,
    model.mode
  );
}
