import type { ActualBenchTransport } from "@/lib/actual/transport";
import { testAsset, testRow } from "@/lib/asset-registry/testing";
import type { Registry } from "@/lib/asset-registry/models";
import { startPurchase, type RunContext } from "./wizardRun";
import type { PickedTransaction } from "@/components/transactions/transactionPickerQuery";
import { registryRequest } from "./api";

jest.mock("./api", () => ({ registryRequest: jest.fn() }));
const picked = (id: string, amountMinor: number, extra: Partial<PickedTransaction> = {}): PickedTransaction => ({ id, accountId: "vehicles", accountName: "Asset", date: "2026-02-01", amountMinor, payeeId: null, payeeName: "Dealer", categoryId: null, categoryName: null, notes: null, transferId: null, ...extra });

/** A saved asset with an empty or pre-filled own account, a bank account, and a transport that records its writes. */
function fixture(book: ReturnType<typeof testRow>[] = []) {
  const rows = [...book]; const bank = [testRow("car", -8000000, { accountId: "bank", date: "2026-02-01", categoryId: "vehicles-cat", payeeName: "Dealer" })];
  const asset = testAsset("asset", { assetTag: null });
  const registry: Registry = { assets: [asset], metadata: [] };
  const transport = {
    mode: "http-api", sync: jest.fn(async () => {}), getPayees: async () => [{ id: "to-asset", name: "Asset", transferAccountId: "vehicles" }], getCategoryGroups: async () => ({ categories: [{ id: "vehicles-cat", isIncome: false }, { id: "purchase", isIncome: false }], groups: [] }),
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true, createTransaction: true, createTransactionWithImportedId: true, updateTransaction: true } }),
    getAccounts: async () => [{ id: "vehicles", name: "Asset", offBudget: true, closed: false }, { id: "bank", name: "Bank", offBudget: false, closed: false }],
    getAccountBalances: async () => new Map([["vehicles", rows.reduce((s, r) => s + r.amount, 0) / 100], ["bank", bank.reduce((s, r) => s + r.amount, 0) / 100]]), canVerifyTransferLinks: async () => true,
    listTransactionsForSync: async ({ accountId }: { accountId: string }) => accountId === "vehicles" ? rows : bank,
    createTransactionsForSync: jest.fn(async (inputs) => { const input = inputs[0]; rows.push(testRow("created", input.amount, { date: input.date, notes: input.notes, importedId: input.importedId })); return { created: [{ transactionId: "created" }] }; }),
    updateTransactionForSync: jest.fn(async (input) => { const i = rows.findIndex((r) => r.id === input.transactionId); rows[i] = { ...rows[i], notes: input.notes }; return null; }),
  } as unknown as ActualBenchTransport;
  jest.mocked(registryRequest).mockImplementation(async () => registry);
  const ctx: RunContext = { transport, assetId: "asset", budgetSyncId: "budget", shared: false };
  return { ctx, rows, transport, calls: () => jest.mocked(registryRequest).mock.calls.filter((c) => c[1] !== "GET" && c[1] !== undefined) };
}
beforeEach(() => jest.clearAllMocks());

it("records a starting value as one tagged row in an empty account, then classifies it", async () => {
  const f = fixture();
  const started = await startPurchase({ kind: "opening-new", amountMinor: 25000000, date: "2026-01-10", notes: "Starting value" }, f.ctx);
  expect(f.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
  expect(f.rows[0]).toMatchObject({ amount: 25000000, notes: "Starting value #opening-balance" });
  await started!.commit();
  expect(f.calls()).toEqual([["budget", "PATCH", { changes: [{ actualTransactionId: "created", actualAccountId: "vehicles", assetId: null, classification: "opening-balance", revision: 0 }] }]]);
});
it("uses an existing row as the starting value: Notes tag in Actual, classification in Bench, no new row", async () => {
  const f = fixture([testRow("start", 25000000, { date: "2025-01-01", notes: "Opening" })]);
  const started = await startPurchase({ kind: "opening-existing", row: picked("start", 25000000) }, f.ctx);
  await started!.commit();
  expect(f.transport.createTransactionsForSync).not.toHaveBeenCalled();
  expect(f.rows[0].notes).toBe("Opening #opening-balance");
  expect(f.calls()[0][2]).toMatchObject({ changes: [{ actualTransactionId: "start", classification: "opening-balance" }] });
});
it("marks an existing transfer as the purchase without editing it", async () => {
  const f = fixture([testRow("buy", 8000000, { date: "2026-02-01", transferId: "payment" })]);
  await (await startPurchase({ kind: "transfer", row: picked("buy", 8000000, { transferId: "payment" }) }, f.ctx))!.commit();
  expect(f.transport.updateTransactionForSync).not.toHaveBeenCalled(); // transfers are protected: Bench-only
  expect(f.calls()[0][2]).toMatchObject({ changes: [{ actualTransactionId: "buy", classification: "acquisition" }] });
});
it("capitalizes a purchase recorded as an expense: one adjustment, the expense untouched, the pair recorded", async () => {
  const f = fixture();
  const started = await startPurchase({ kind: "expense", source: picked("car", -8000000, { accountId: "bank", accountName: "Bank", categoryId: "vehicles-cat", categoryName: "Vehicles" }) }, f.ctx);
  expect(f.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
  expect(f.rows[0]).toMatchObject({ amount: 8000000, date: "2026-02-01" });
  expect(f.rows[0].notes).toMatch(/#capex/); // the type tag is written with the row
  await started!.commit();
  const [, method, body] = f.calls()[0]; expect(method).toBe("PUT");
  expect((body as { changes: { capitalizedFromTransactionId?: string; role: string }[] }).changes.some((c) => c.role === "book" && c.capitalizedFromTransactionId === "car")).toBe(true);
});
it("does nothing when skipped", async () => {
  const f = fixture(); expect(await startPurchase({ kind: "skip" }, f.ctx)).toBeNull(); expect(f.calls()).toEqual([]);
});
