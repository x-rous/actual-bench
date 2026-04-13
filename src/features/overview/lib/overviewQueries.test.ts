import type { ConnectionInstance } from "@/store/connection";
import {
  COUNT_QUERIES,
  fetchAllOverviewStats,
  fetchEntityCount,
  OLDEST_TRANSACTION_QUERY,
  REFLECT_BUDGET_COUNT_QUERY,
  ZERO_BUDGET_COUNT_QUERY,
} from "./overviewQueries";

jest.mock("../../../lib/api/query", () => ({
  runQuery: jest.fn(),
}));

import { runQuery } from "../../../lib/api/query";

const mockRunQuery = runQuery as jest.MockedFunction<typeof runQuery>;

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "Test Budget",
  baseUrl: "http://localhost:5006",
  apiKey: "test-key",
  budgetSyncId: "budget-1",
};

describe("overviewQueries", () => {
  beforeEach(() => {
    mockRunQuery.mockReset();
    jest.restoreAllMocks();
  });

  it("returns a scalar count when runQuery resolves with a number", async () => {
    mockRunQuery.mockResolvedValueOnce({ data: 42 });

    await expect(fetchEntityCount(connection, COUNT_QUERIES.transactions)).resolves.toBe(42);
    expect(mockRunQuery).toHaveBeenCalledWith(connection, COUNT_QUERIES.transactions);
  });

  it("returns null when runQuery rejects", async () => {
    mockRunQuery.mockRejectedValueOnce(new Error("invalid table"));

    await expect(fetchEntityCount(connection, COUNT_QUERIES.transactions)).resolves.toBeNull();
  });

  it("retries a failed stat once before returning the final overview stats", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let scheduleAttempts = 0;

    mockRunQuery.mockImplementation(async (_connection, query) => {
      if (query === COUNT_QUERIES.transactions) return { data: 100 };
      if (query === COUNT_QUERIES.accounts) return { data: 5 };
      if (query === COUNT_QUERIES.payees) return { data: 12 };
      if (query === COUNT_QUERIES.categoryGroups) return { data: 4 };
      if (query === COUNT_QUERIES.categories) return { data: 18 };
      if (query === COUNT_QUERIES.rules) return { data: 7 };
      if (query === COUNT_QUERIES.schedules) {
        scheduleAttempts += 1;
        if (scheduleAttempts === 1) {
          throw new Error("temporary schedules failure");
        }
        return { data: 3 };
      }
      if (query === ZERO_BUDGET_COUNT_QUERY) return { data: 2 };
      if (query === REFLECT_BUDGET_COUNT_QUERY) return { data: 1 };
      if (query === OLDEST_TRANSACTION_QUERY) {
        return { data: [{ date: "2019-01-01", id: "tx-1" }] };
      }
      throw new Error("Unexpected query");
    });

    await expect(fetchAllOverviewStats(connection)).resolves.toEqual({
      stats: {
        transactions: 100,
        accounts: 5,
        payees: 12,
        categoryGroups: 4,
        categories: 18,
        rules: 7,
        schedules: 3,
      },
      budgetMode: "Envelope",
      budgetingSince: "Jan 2019",
    });

    expect(scheduleAttempts).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[overview] Failed to fetch schedules count (attempt 1/2)",
      expect.any(Error)
    );
  });

  it("returns No transactions when there is no oldest transaction row", async () => {
    mockRunQuery
      .mockResolvedValueOnce({ data: 100 })
      .mockResolvedValueOnce({ data: 5 })
      .mockResolvedValueOnce({ data: 12 })
      .mockResolvedValueOnce({ data: 4 })
      .mockResolvedValueOnce({ data: 18 })
      .mockResolvedValueOnce({ data: 7 })
      .mockResolvedValueOnce({ data: 3 })
      .mockResolvedValueOnce({ data: 2 })
      .mockResolvedValueOnce({ data: 2 })
      .mockResolvedValueOnce({ data: [] });

    await expect(fetchAllOverviewStats(connection)).resolves.toEqual({
      stats: {
        transactions: 100,
        accounts: 5,
        payees: 12,
        categoryGroups: 4,
        categories: 18,
        rules: 7,
        schedules: 3,
      },
      budgetMode: "Unidentified",
      budgetingSince: "No transactions",
    });
  });

  it("returns null budget mode when the budget-mode queries fail after retries", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    let zeroBudgetAttempts = 0;

    mockRunQuery.mockImplementation(async (_connection, query) => {
      if (query === COUNT_QUERIES.transactions) return { data: 100 };
      if (query === COUNT_QUERIES.accounts) return { data: 5 };
      if (query === COUNT_QUERIES.payees) return { data: 12 };
      if (query === COUNT_QUERIES.categoryGroups) return { data: 4 };
      if (query === COUNT_QUERIES.categories) return { data: 18 };
      if (query === COUNT_QUERIES.rules) return { data: 7 };
      if (query === COUNT_QUERIES.schedules) return { data: 3 };
      if (query === ZERO_BUDGET_COUNT_QUERY) {
        zeroBudgetAttempts += 1;
        throw new Error("temporary zero_budgets failure");
      }
      if (query === REFLECT_BUDGET_COUNT_QUERY) return { data: 1 };
      if (query === OLDEST_TRANSACTION_QUERY) {
        return { data: [{ date: "2019-01-01", id: "tx-1" }] };
      }
      throw new Error("Unexpected query");
    });

    await expect(fetchAllOverviewStats(connection)).resolves.toEqual({
      stats: {
        transactions: 100,
        accounts: 5,
        payees: 12,
        categoryGroups: 4,
        categories: 18,
        rules: 7,
        schedules: 3,
      },
      budgetMode: null,
      budgetingSince: "Jan 2019",
    });

    expect(zeroBudgetAttempts).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      "[overview] Failed to fetch budgetMode (attempt 1/2)",
      expect.any(Error)
    );
  });

  it("fetches all overview stats and returns the normalized record", async () => {
    mockRunQuery
      .mockResolvedValueOnce({ data: 100 })
      .mockResolvedValueOnce({ data: 5 })
      .mockResolvedValueOnce({ data: 12 })
      .mockResolvedValueOnce({ data: 4 })
      .mockResolvedValueOnce({ data: 18 })
      .mockResolvedValueOnce({ data: 7 })
      .mockResolvedValueOnce({ data: 3 })
      .mockResolvedValueOnce({ data: 1 })
      .mockResolvedValueOnce({ data: 4 })
      .mockResolvedValueOnce({ data: [{ date: "2019-01-01", id: "tx-1" }] });

    await expect(fetchAllOverviewStats(connection)).resolves.toEqual({
      stats: {
        transactions: 100,
        accounts: 5,
        payees: 12,
        categoryGroups: 4,
        categories: 18,
        rules: 7,
        schedules: 3,
      },
      budgetMode: "Tracking",
      budgetingSince: "Jan 2019",
    });

    expect(mockRunQuery.mock.calls).toEqual([
      [connection, COUNT_QUERIES.transactions],
      [connection, COUNT_QUERIES.accounts],
      [connection, COUNT_QUERIES.payees],
      [connection, COUNT_QUERIES.categoryGroups],
      [connection, COUNT_QUERIES.categories],
      [connection, COUNT_QUERIES.rules],
      [connection, COUNT_QUERIES.schedules],
      [connection, ZERO_BUDGET_COUNT_QUERY],
      [connection, REFLECT_BUDGET_COUNT_QUERY],
      [connection, OLDEST_TRANSACTION_QUERY],
    ]);
  });
});
