import { runQuery } from "@/lib/api/query";
import { fetchBudgetPreferences } from "@/lib/api/preferences";
import type { ConnectionInstance } from "@/store/connection";
import type { BudgetMode, BudgetOverviewDetails, BudgetOverviewSnapshot, OverviewDetailKey, OverviewStatKey } from "../types";
import { BudgetNotOpenError } from "@/lib/actual/browser/runtime";

type ScalarCountQuery = {
  ActualQLquery: {
    table: string;
    filter?: Record<string, unknown>;
    calculate: { $count: "$id" };
  };
};

type OldestTransactionQuery = {
  ActualQLquery: {
    table: "transactions";
    select: ["date"];
    orderBy: [{ date: "asc" }, "id"];
    limit: 1;
  };
};

type OldestTransactionRow = {
  date: string;
  id?: string;
};

type OverviewCountKey = keyof typeof COUNT_QUERIES;

const OVERVIEW_QUERY_MAX_ATTEMPTS = 2;

export const TRANSACTION_COUNT_QUERY = {
  ActualQLquery: { table: "transactions", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const ACCOUNT_COUNT_QUERY = {
  ActualQLquery: { table: "accounts", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const PAYEE_COUNT_QUERY = {
  ActualQLquery: { table: "payees", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const CATEGORY_COUNT_QUERY = {
  ActualQLquery: { table: "categories", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const RULE_COUNT_QUERY = {
  ActualQLquery: { table: "rules", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const SCHEDULE_COUNT_QUERY = {
  ActualQLquery: { table: "schedules", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const OLDEST_TRANSACTION_QUERY = {
  ActualQLquery: {
    table: "transactions",
    select: ["date"],
    orderBy: [{ date: "asc" }, "id"],
    limit: 1,
  },
} as const satisfies OldestTransactionQuery;

export const COUNT_QUERIES = {
  transactions: TRANSACTION_COUNT_QUERY,
  accounts: ACCOUNT_COUNT_QUERY,
  payees: PAYEE_COUNT_QUERY,
  categories: CATEGORY_COUNT_QUERY,
  rules: RULE_COUNT_QUERY,
  schedules: SCHEDULE_COUNT_QUERY,
} as const;

const COUNT_QUERY_KEYS = Object.keys(COUNT_QUERIES) as OverviewCountKey[];

/** The parts of a headline count worth naming beside it. Cheap filtered counts, read with the rest. */
export const DETAIL_QUERIES = {
  closedAccounts: { ActualQLquery: { table: "accounts", filter: { closed: true }, calculate: { $count: "$id" } } },
  transferPayees: { ActualQLquery: { table: "payees", filter: { transfer_acct: { $ne: null } }, calculate: { $count: "$id" } } },
  hiddenCategories: { ActualQLquery: { table: "categories", filter: { hidden: true }, calculate: { $count: "$id" } } },
  completedSchedules: { ActualQLquery: { table: "schedules", filter: { completed: true }, calculate: { $count: "$id" } } },
} as const satisfies Record<OverviewDetailKey, ScalarCountQuery>;

const DETAIL_QUERY_KEYS = Object.keys(DETAIL_QUERIES) as OverviewDetailKey[];

async function runScalarCountQuery(
  connection: ConnectionInstance,
  query: ScalarCountQuery
): Promise<number> {
  const result = await runQuery<{ data: number }>(connection, query);

  if (typeof result.data !== "number") {
    throw new Error("Overview count query returned a non-numeric result");
  }

  return result.data;
}

function logOverviewQueryFailure(
  label: string,
  attempt: number,
  error: unknown
) {
  // The page is being left for another budget: expected, and not worth a line.
  if (error instanceof BudgetNotOpenError) return;
  console.warn(
    `[overview] Failed to fetch ${label} (attempt ${attempt}/${OVERVIEW_QUERY_MAX_ATTEMPTS})`,
    error
  );
}

function formatBudgetingSince(dateString: string): string {
  const [year, month] = dateString.split("-");
  const monthIndex = Number(month) - 1;
  const parsedYear = Number(year);

  if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Number.isInteger(parsedYear)) {
    throw new Error("Oldest transaction query returned an invalid date");
  }

  return new Date(Date.UTC(parsedYear, monthIndex, 1)).toLocaleString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function fetchOverviewCountWithRetry(
  connection: ConnectionInstance,
  statKey: OverviewCountKey | OverviewDetailKey
): Promise<number | null> {
  const query: ScalarCountQuery = statKey in COUNT_QUERIES
    ? COUNT_QUERIES[statKey as OverviewCountKey]
    : DETAIL_QUERIES[statKey as OverviewDetailKey];

  for (let attempt = 1; attempt <= OVERVIEW_QUERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runScalarCountQuery(connection, query);
    } catch (error) {
      logOverviewQueryFailure(`${statKey} count`, attempt, error);
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS || error instanceof BudgetNotOpenError) {
        return null;
      }
    }
  }

  return null;
}

async function fetchBudgetModeWithRetry(
  connection: ConnectionInstance
): Promise<BudgetMode | null> {
  for (let attempt = 1; attempt <= OVERVIEW_QUERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      // Detected from the `budgetType` preference (see fetchBudgetPreferences),
      // not from budget-table row counts - correct even for empty budgets.
      const { budgetMode } = await fetchBudgetPreferences(connection);
      return budgetMode === "tracking" ? "Tracking" : "Envelope";
    } catch (error) {
      logOverviewQueryFailure("budgetMode", attempt, error);
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS || error instanceof BudgetNotOpenError) {
        return null;
      }
    }
  }

  return null;
}

async function fetchBudgetingSinceWithRetry(
  connection: ConnectionInstance
): Promise<string | null> {
  for (let attempt = 1; attempt <= OVERVIEW_QUERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await runQuery<{ data: OldestTransactionRow[] }>(connection, OLDEST_TRANSACTION_QUERY);
      const oldest = result.data[0];

      if (!oldest) {
        return "No transactions";
      }

      return formatBudgetingSince(oldest.date);
    } catch (error) {
      logOverviewQueryFailure("budgetingSince", attempt, error);
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS || error instanceof BudgetNotOpenError) {
        return null;
      }
    }
  }

  return null;
}

export async function fetchEntityCount(
  connection: ConnectionInstance,
  query: ScalarCountQuery
): Promise<number | null> {
  try {
    return await runScalarCountQuery(connection, query);
  } catch {
    return null;
  }
}

export async function fetchAllOverviewStats(
  connection: ConnectionInstance
): Promise<BudgetOverviewSnapshot> {
  const [entries, detailEntries, budgetMode, budgetingSince] = await Promise.all([
    Promise.all(
      COUNT_QUERY_KEYS.map(async (statKey) => {
        const value = await fetchOverviewCountWithRetry(connection, statKey);
        return [statKey, value] as const;
      })
    ),
    Promise.all(
      DETAIL_QUERY_KEYS.map(async (key) => [key, await fetchOverviewCountWithRetry(connection, key)] as const)
    ),
    fetchBudgetModeWithRetry(connection),
    fetchBudgetingSinceWithRetry(connection),
  ]);

  return {
    stats: Object.fromEntries(entries) as Record<OverviewStatKey, number | null>,
    details: Object.fromEntries(detailEntries) as BudgetOverviewDetails,
    budgetMode,
    budgetingSince,
  };
}
