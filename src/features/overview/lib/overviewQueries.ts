import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { BudgetMode, BudgetOverviewSnapshot, OverviewStatKey } from "../types";

type ScalarCountQuery = {
  ActualQLquery: {
    table: string;
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

export const CATEGORY_GROUP_COUNT_QUERY = {
  ActualQLquery: { table: "category_groups", calculate: { $count: "$id" } },
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

export const ZERO_BUDGET_COUNT_QUERY = {
  ActualQLquery: { table: "zero_budgets", calculate: { $count: "$id" } },
} as const satisfies ScalarCountQuery;

export const REFLECT_BUDGET_COUNT_QUERY = {
  ActualQLquery: { table: "reflect_budgets", calculate: { $count: "$id" } },
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
  categoryGroups: CATEGORY_GROUP_COUNT_QUERY,
  categories: CATEGORY_COUNT_QUERY,
  rules: RULE_COUNT_QUERY,
  schedules: SCHEDULE_COUNT_QUERY,
} as const;

const COUNT_QUERY_KEYS = Object.keys(COUNT_QUERIES) as OverviewCountKey[];

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

function deriveBudgetMode(
  zeroBudgetCount: number,
  reflectBudgetCount: number
): BudgetMode {
  if (zeroBudgetCount > reflectBudgetCount) {
    return "Envelope";
  }

  if (reflectBudgetCount > zeroBudgetCount) {
    return "Tracking";
  }

  return "Unidentified";
}

async function fetchOverviewCountWithRetry(
  connection: ConnectionInstance,
  statKey: OverviewCountKey
): Promise<number | null> {
  const query = COUNT_QUERIES[statKey];

  for (let attempt = 1; attempt <= OVERVIEW_QUERY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await runScalarCountQuery(connection, query);
    } catch (error) {
      logOverviewQueryFailure(`${statKey} count`, attempt, error);
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS) {
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
      const [zeroBudgetCount, reflectBudgetCount] = await Promise.all([
        runScalarCountQuery(connection, ZERO_BUDGET_COUNT_QUERY),
        runScalarCountQuery(connection, REFLECT_BUDGET_COUNT_QUERY),
      ]);

      return deriveBudgetMode(zeroBudgetCount, reflectBudgetCount);
    } catch (error) {
      logOverviewQueryFailure("budgetMode", attempt, error);
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS) {
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
      if (attempt === OVERVIEW_QUERY_MAX_ATTEMPTS) {
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
  const [entries, budgetMode, budgetingSince] = await Promise.all([
    Promise.all(
      COUNT_QUERY_KEYS.map(async (statKey) => {
        const value = await fetchOverviewCountWithRetry(connection, statKey);
        return [statKey, value] as const;
      })
    ),
    fetchBudgetModeWithRetry(connection),
    fetchBudgetingSinceWithRetry(connection),
  ]);

  return {
    stats: Object.fromEntries(entries) as Record<OverviewStatKey, number | null>,
    budgetMode,
    budgetingSince,
  };
}
