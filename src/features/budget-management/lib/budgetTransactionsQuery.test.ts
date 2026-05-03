import {
  buildBudgetTransactionsQuery,
  fetchBudgetTransactions,
} from "./budgetTransactionsQuery";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("../../../lib/api/client", () => ({
  apiRequest: jest.fn(),
}));

import { apiRequest } from "../../../lib/api/client";

const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "Test",
  baseUrl: "http://localhost:5006",
  apiKey: "test-key",
  budgetSyncId: "budget-1",
};

describe("budget transaction queries", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("builds a month/category ActualQL query for inline transaction rows", () => {
    expect(
      buildBudgetTransactionsQuery({
        month: "2026-04",
        categoryIds: ["cat-1", "cat-2"],
      })
    ).toEqual({
      ActualQLquery: {
        table: "transactions",
        options: { splits: "inline" },
        filter: {
          $and: [
            { date: { $transform: "$month", $eq: "2026-04" } },
            { category: { $oneof: ["cat-1", "cat-2"] } },
            { "account.offbudget": false },
          ],
        },
        select: [
          "id",
          "date",
          "amount",
          "payee.name",
          "category.name",
          "notes",
        ],
        orderBy: [{ date: "desc" }],
        limit: 500,
      },
    });
  });

  it("returns no rows without calling the API when no categories are provided", async () => {
    await expect(
      fetchBudgetTransactions(connection, {
        month: "2026-04",
        categoryIds: [],
      })
    ).resolves.toEqual([]);

    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("normalizes transaction rows returned by ActualQL", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        {
          id: "tx-1",
          date: "2026-04-15",
          amount: -1234,
          "payee.name": "Grocery",
          "category.name": "Food",
          notes: "weekly shop",
        },
        {
          id: null,
          date: "2026-04-16",
          amount: -500,
          "payee.name": "Skipped",
        },
        null,
      ],
    });

    await expect(
      fetchBudgetTransactions(connection, {
        month: "2026-04",
        categoryIds: ["cat-1"],
      })
    ).resolves.toEqual([
      {
        id: "tx-1",
        date: "2026-04-15",
        amount: -1234,
        payeeName: "Grocery",
        categoryName: "Food",
        notes: "weekly shop",
      },
    ]);
    expect(mockApiRequest).toHaveBeenCalledWith(
      connection,
      "/run-query",
      expect.objectContaining({
        method: "POST",
      })
    );
  });

  it("throws a clear error when the ActualQL response is missing a data array", async () => {
    mockApiRequest.mockResolvedValueOnce({});

    await expect(
      fetchBudgetTransactions(connection, {
        month: "2026-04",
        categoryIds: ["cat-1"],
      })
    ).rejects.toThrow(
      "Budget transactions query returned an invalid response: missing data array"
    );
  });
});
