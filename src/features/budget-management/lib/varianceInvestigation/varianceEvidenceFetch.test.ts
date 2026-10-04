import { fetchLargestTransactions } from "./varianceEvidenceFetch";
import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";

jest.mock("@/lib/api/query", () => ({ runQuery: jest.fn() }));

const connection = { id: "c1" } as ConnectionInstance;
const params = {
  monthStart: "2026-08",
  monthEnd: "2026-08",
  categoryIds: ["flights"],
  side: "expense" as const,
  limit: 8,
};
const mocked = runQuery as jest.MockedFunction<typeof runQuery>;

describe("fetchLargestTransactions", () => {
  beforeEach(() => mocked.mockReset());

  it("returns the rows and the matching count", async () => {
    mocked
      .mockResolvedValueOnce({
        data: [{ id: "t1", date: "2026-08-17", amount: -170412, "payee.name": "Fly Dubai", "category.id": "flights", "category.name": "Flights", notes: null }],
      })
      .mockResolvedValueOnce({ data: [{ count: 58, total: -1000000 }] });
    const result = await fetchLargestTransactions(connection, params);
    expect(result.total).toBe(58);
    expect(result.rows).toEqual([
      { id: "t1", date: "2026-08-17", amount: -170412, payeeName: "Fly Dubai", categoryId: "flights", categoryName: "Flights", notes: null },
    ]);
  });

  it("still returns rows when the count cannot be read", async () => {
    mocked
      .mockResolvedValueOnce({ data: [] })
      .mockRejectedValueOnce(new Error("aggregate not supported"));
    expect(await fetchLargestTransactions(connection, params)).toEqual({ rows: [], total: null });
  });

  it("rejects an invalid row response rather than showing nothing", async () => {
    mocked.mockResolvedValueOnce({}).mockResolvedValueOnce({ data: [] });
    await expect(fetchLargestTransactions(connection, params)).rejects.toThrow("missing data array");
  });

  it("does not query for an empty category set", async () => {
    expect(await fetchLargestTransactions(connection, { ...params, categoryIds: [] })).toEqual({ rows: [], total: 0 });
    expect(mocked).not.toHaveBeenCalled();
  });
});
