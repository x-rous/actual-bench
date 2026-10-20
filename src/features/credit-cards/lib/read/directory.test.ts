import { eligibleCardAccount, readCardDirectory } from "./directory";
import { getBudgetFileSyncCapabilities } from "@/lib/sync/capabilities";
import type { ConnectionInstance } from "@/store/connection";
import type { ActualBenchTransport } from "@/lib/actual/transport";

const accounts = [{ id: "card", name: "Card", offBudget: false, closed: false, groupId: "group" }, { id: "missing", name: "Missing balance", offBudget: false, closed: false }];

it("respects group inheritance and on-budget/open eligibility", () => {
  const maps = { accounts: new Map([["card", "bank" as const]]), groups: new Map([["group", "credit-card" as const]]) };
  expect(eligibleCardAccount(accounts[0], maps)).toBe(true);
  expect(eligibleCardAccount({ ...accounts[0], offBudget: true }, maps)).toBe(false);
  expect(eligibleCardAccount({ ...accounts[0], closed: true }, maps)).toBe(false);
  expect(eligibleCardAccount(accounts[0], { ...maps, groups: new Map([["group", "bank" as const]]) })).toBe(false);
});

it.each(["http-api", "browser-api"] as const)("normalizes %s directory inputs with no reachable Actual writes", async (mode) => {
  const connection = { mode, id: "connection", budgetSyncId: "budget" } as ConnectionInstance;
  const transport: Pick<ActualBenchTransport, "getAccounts" | "getAccountBalances" | "getSyncCapabilities"> = {
    getSyncCapabilities: () => getBudgetFileSyncCapabilities(connection),
    getAccounts: jest.fn().mockResolvedValue(accounts),
    getAccountBalances: jest.fn().mockResolvedValue(new Map([["card", -3150]])),
  };
  const result = await readCardDirectory(transport);
  expect(result.balances.get("card")).toEqual({ signedBalanceMinor: -315000, debtMinor: 315000, creditMinor: 0 });
  expect(result.balances.has("missing")).toBe(false);
  expect(transport.getAccounts).toHaveBeenCalledTimes(1);
  expect(transport.getAccountBalances).toHaveBeenCalledTimes(1);
});
