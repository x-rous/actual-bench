import { readLoanCostRows, readMovement, readStartingBalances } from "./reads";
import type { ConnectionInstance } from "@/store/connection";

const runQuery = jest.fn();
jest.mock("@/lib/api/query", () => ({ runQuery: (...args: unknown[]) => runQuery(...args) }));

const connection = {} as ConnectionInstance;
const filterOf = (call: number) => (runQuery.mock.calls[call][1] as { ActualQLquery: { filter: unknown } }).ActualQLquery.filter;

describe("financial insights: starting balances are found by Actual's flag", () => {
  beforeEach(() => { runQuery.mockReset(); runQuery.mockResolvedValue({ data: [] }); });

  it("reads them as flagged rows or, for a budget imported without the flag, rows whose payee is named Starting Balance", async () => {
    await readStartingBalances(connection, "2026-11-18");
    expect(filterOf(0)).toEqual({ $and: [{ date: { $lte: "2026-11-18" } }, { $or: [{ starting_balance_flag: true }, { "payee.name": "Starting Balance" }] }] });
  });

  it("leaves them out of everything else with the opposite condition, so a renamed payee with the flag is opening, not income", async () => {
    await readMovement(connection, "2026-11-18");
    expect(filterOf(0)).toEqual({
      $and: [
        { date: { $lte: "2026-11-18" } },
        { $and: [{ $or: [{ starting_balance_flag: false }, { starting_balance_flag: null }] }, { $or: [{ payee: null }, { "payee.name": { $ne: "Starting Balance" } }] }] },
      ],
    });
  });

  it("carries whether a loan cost row was charged by the lender", async () => {
    runQuery.mockResolvedValue({ data: [{ id: "a", date: "2026-10-05", amount: -20_000, account: "loan", category: null }] });
    const rows = await readLoanCostRows(connection, [{ id: "a", loanAccountId: "loan", kind: "interest", charged: true }], "2026-11-18");
    expect(rows).toEqual([{ id: "a", month: "2026-10", accountId: "loan", categoryId: null, amountMinor: -20_000, loanAccountId: "loan", kind: "interest", charged: true }]);
  });
});
