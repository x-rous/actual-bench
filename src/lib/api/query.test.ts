import { getTransactionCountsForIds } from "./query";
import type { ConnectionInstance } from "@/store/connection";

// ─── Mock apiRequest ──────────────────────────────────────────────────────────

jest.mock("./client", () => ({
  apiRequest: jest.fn(),
}));

import { apiRequest } from "./client";
const mockApiRequest = apiRequest as jest.MockedFunction<typeof apiRequest>;

const connection: ConnectionInstance = {
  id: "conn-1",
  label: "Test",
  baseUrl: "http://localhost:5006",
  apiKey: "test-key",
  budgetSyncId: "budget-1",
};

// ─── getTransactionCountsForIds ───────────────────────────────────────────────

describe("getTransactionCountsForIds", () => {
  beforeEach(() => {
    mockApiRequest.mockReset();
  });

  it("returns empty Map immediately when ids is empty — no network call", async () => {
    const result = await getTransactionCountsForIds(connection, "payee", []);
    expect(result.size).toBe(0);
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("maps each row in the response to entityId → count", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        { payee: "p1", "payee.name": "Amazon", transactionCount: 10 },
        { payee: "p2", "payee.name": "Netflix", transactionCount: 3 },
      ],
    });

    const result = await getTransactionCountsForIds(connection, "payee", ["p1", "p2"]);
    expect(result.get("p1")).toBe(10);
    expect(result.get("p2")).toBe(3);
    expect(result.size).toBe(2);
  });

  it("returns an empty Map when the server returns no matching rows", async () => {
    mockApiRequest.mockResolvedValueOnce({ data: [] });

    const result = await getTransactionCountsForIds(connection, "payee", ["p1"]);
    expect(result.size).toBe(0);
  });

  it("handles category groupField correctly", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        { category: "cat1", "category.name": "Groceries", transactionCount: 7 },
      ],
    });

    const result = await getTransactionCountsForIds(connection, "category", ["cat1"]);
    expect(result.get("cat1")).toBe(7);
  });

  it("handles schedule groupField correctly", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        { schedule: "sched1", "schedule.name": "Rent", transactionCount: 12 },
      ],
    });

    const result = await getTransactionCountsForIds(connection, "schedule", ["sched1"]);
    expect(result.get("sched1")).toBe(12);
  });

  it("handles account groupField correctly", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        { account: "acc1", "account.name": "Checking", transactionCount: 42 },
      ],
    });

    const result = await getTransactionCountsForIds(connection, "account", ["acc1"]);
    expect(result.get("acc1")).toBe(42);
  });

  it("skips rows where the groupField value is not a string", async () => {
    mockApiRequest.mockResolvedValueOnce({
      data: [
        { payee: null, "payee.name": null, transactionCount: 5 },
        { payee: "p1", "payee.name": "Amazon", transactionCount: 2 },
      ],
    });

    const result = await getTransactionCountsForIds(connection, "payee", ["p1"]);
    expect(result.size).toBe(1);
    expect(result.get("p1")).toBe(2);
  });

  it("sends the correct ActualQL query body", async () => {
    mockApiRequest.mockResolvedValueOnce({ data: [] });

    await getTransactionCountsForIds(connection, "payee", ["p1", "p2"]);

    expect(mockApiRequest).toHaveBeenCalledWith(
      connection,
      "/run-query",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          ActualQLquery: expect.objectContaining({
            table: "transactions",
            filter: { payee: { $oneof: ["p1", "p2"] } },
            groupBy: ["payee", "payee.name"],
          }),
        }),
      })
    );
  });

  it("includes $count transactionCount in the select", async () => {
    mockApiRequest.mockResolvedValueOnce({ data: [] });

    await getTransactionCountsForIds(connection, "account", ["acc1"]);

    const callBody = mockApiRequest.mock.calls[0][2] as { method: string; body: { ActualQLquery: { select: unknown[] } } };
    const selectField = callBody.body.ActualQLquery.select.find(
      (s: unknown) => typeof s === "object" && s !== null && "transactionCount" in (s as object)
    );
    expect(selectField).toEqual({ transactionCount: { $count: "$id" } });
  });
});
