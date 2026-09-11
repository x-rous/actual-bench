/**
 * PR-055: bulk actions used to read source months with `getQueryData` — a cache
 * peek that never fetched, so the answer depended on what happened to be warm.
 * These tests pin the two properties that replace it: a warm month costs no
 * request, and a month the budget file does not have is never requested at all.
 */

const getBudgetMonth = jest.fn();
jest.mock("../../../lib/actual", () => ({
  getTransport: () => ({ getBudgetMonth }),
}));
jest.mock("../../../store/connection", () => ({
  useConnectionStore: jest.fn(),
  selectActiveInstance: jest.fn(),
}));

import { QueryClient } from "@tanstack/react-query";
import { ensureMonthsData } from "./ensureMonthsData";
import { budgetMonthDataQueryOptions } from "./monthDataQuery";

type Connection = Parameters<typeof ensureMonthsData>[1];
const connection = { id: "conn-1" } as unknown as Connection;

function monthPayload(month: string) {
  return {
    month,
    categoryGroups: [
      {
        id: "g1",
        name: "Group",
        is_income: false,
        hidden: false,
        categories: [
          {
            id: "c1",
            name: "Groceries",
            group_id: "g1",
            is_income: false,
            hidden: false,
            budgeted: 12345,
            spent: 0,
            balance: 0,
            carryover: false,
          },
        ],
      },
    ],
    incomeAvailable: 0,
    lastMonthOverspent: 0,
    forNextMonth: 0,
    totalBudgeted: 0,
    totalSpent: 0,
    totalIncome: 0,
    toBudget: 0,
    fromLastMonth: 0,
    totalBalance: 0,
  };
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

beforeEach(() => {
  getBudgetMonth.mockReset();
  getBudgetMonth.mockImplementation((month: string) =>
    Promise.resolve(monthPayload(month))
  );
});

describe("ensureMonthsData", () => {
  it("fetches a cold month and returns its categories", async () => {
    const client = newClient();
    const res = await ensureMonthsData(client, connection, ["2025-03"], [
      "2025-03",
    ]);

    expect(getBudgetMonth).toHaveBeenCalledTimes(1);
    expect(res.monthDataMap["2025-03"]?.[0]?.budgeted).toBe(12345);
    expect(res.unavailable).toEqual([]);
    expect(res.failed).toEqual([]);
  });

  it("serves a warm month from the cache without fetching", async () => {
    const client = newClient();
    // Warm it exactly the way the grid's own queries would.
    await client.fetchQuery(budgetMonthDataQueryOptions(connection, "2025-03"));
    expect(getBudgetMonth).toHaveBeenCalledTimes(1);

    const res = await ensureMonthsData(client, connection, ["2025-03"], [
      "2025-03",
    ]);

    expect(getBudgetMonth).toHaveBeenCalledTimes(1); // no second request
    expect(res.monthDataMap["2025-03"]).toBeDefined();
  });

  it("never requests a month the budget file does not have", async () => {
    const client = newClient();
    const res = await ensureMonthsData(
      client,
      connection,
      ["2024-01", "2025-03"],
      ["2025-03"]
    );

    expect(getBudgetMonth).toHaveBeenCalledTimes(1);
    expect(getBudgetMonth).toHaveBeenCalledWith("2025-03");
    expect(res.unavailable).toEqual(["2024-01"]);
    expect(res.monthDataMap["2024-01"]).toBeUndefined();
  });

  it("reports a month that exists but fails to load", async () => {
    const client = newClient();
    getBudgetMonth.mockRejectedValueOnce(new Error("network"));

    const res = await ensureMonthsData(client, connection, ["2025-03"], [
      "2025-03",
    ]);

    expect(res.failed).toEqual(["2025-03"]);
    expect(res.monthDataMap["2025-03"]).toBeUndefined();
  });

  it("de-duplicates repeated months", async () => {
    const client = newClient();
    await ensureMonthsData(
      client,
      connection,
      ["2025-03", "2025-03", "2025-03"],
      ["2025-03"]
    );
    expect(getBudgetMonth).toHaveBeenCalledTimes(1);
  });

  it("attempts every month when the available list is unknown", async () => {
    const client = newClient();
    const res = await ensureMonthsData(client, connection, ["2025-03"], undefined);
    expect(getBudgetMonth).toHaveBeenCalledTimes(1);
    expect(res.unavailable).toEqual([]);
  });

  it("reports everything as failed when there is no connection", async () => {
    const client = newClient();
    const res = await ensureMonthsData(client, null, ["2025-03"], ["2025-03"]);
    expect(getBudgetMonth).not.toHaveBeenCalled();
    expect(res.failed).toEqual(["2025-03"]);
  });
});
