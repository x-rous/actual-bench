import { linkedExternalAccountIds, readExternal } from "./cashflows";
import type { ActualBenchTransport } from "@/lib/actual/transport";

function transport(accounts: string[]) {
  const listTransactionsForSync = jest.fn(async ({ accountId }: { accountId: string }) => [{ id: `${accountId}-t`, account: accountId, date: "2026-01-02", amount: -100, payee: null, category: null, notes: null, transfer_id: null, subtransactions: [] }]);
  const t = {
    mode: "browser-api", getAccounts: async () => accounts.map((id) => ({ id, name: id, offBudget: false, closed: false })),
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true } }), listTransactionsForSync,
  } as unknown as ActualBenchTransport;
  return { t, listTransactionsForSync };
}
it("reads only the named accounts, and nothing at all when none are linked", async () => {
  const { t, listTransactionsForSync } = transport(["book", "a", "b", "c"]);
  await readExternal(t, ["book"], ["a", "c", "book"]);
  expect(listTransactionsForSync.mock.calls.map((c) => c[0].accountId)).toEqual(["a", "c"]);
  listTransactionsForSync.mockClear();
  expect((await readExternal(t, ["book"], [])).rows).toEqual([]);
  expect(listTransactionsForSync).not.toHaveBeenCalled();
});
it("lists the linked external accounts without the book accounts", () => {
  const ids = linkedExternalAccountIds({ cashflows: [{ actualAccountId: "a" }, { actualAccountId: "a" }, { actualAccountId: "book" }] }, ["book"]);
  expect(ids).toEqual(["a"]);
});
