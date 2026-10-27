import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { testAsset, testRow } from "./testing";
import { readBook } from "./ledger";
import { prepareCapital, executeCapital, capitalMetadata, type CapitalContext } from "./capitalActions";
import { UncertainAssetWrite } from "./actions";
import type { Registry } from "./models";

async function fixture(mode: "browser-api" | "http-api", extraBook: SyncSourceTransaction[] = [], externalAmount = 11000000) {
  const rows = [testRow("opening", 10000000, { date: "2025-01-01", notes: null }), ...extraBook];
  const externalRows = [testRow("receipt", externalAmount, { accountId: "bank", date: "2026-10-01", categoryId: "sale" }), testRow("cost", -200000, { accountId: "bank", date: "2026-11-01", categoryId: "fees" }), testRow("capex", -2000000, { accountId: "bank", date: "2026-09-01", categoryId: "renovation" })];
  const asset = testAsset("asset", { assetTag: null }); const registry: Registry = { assets: [asset], metadata: [{ actualTransactionId: "opening", actualAccountId: "vehicles", assetId: null, classification: "opening-balance", revision: 1 }] };
  const transport = { mode, sync: jest.fn(async () => {}), getPayees: async () => [{ id: "to-asset", name: "Asset", transferAccountId: "vehicles" }], getCategoryGroups: async () => ({ categories: [{ id: "purchase", isIncome: false }], groups: [] }),
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true, createTransaction: true, createTransactionWithImportedId: true } }),
    convertToTransfer: jest.fn(async (input: { expected: { id: string }; transferPayeeId: string }) => {
      const source = externalRows.find((r) => r.id === input.expected.id)!;
      Object.assign(source, { payeeId: input.transferPayeeId, transferId: "converted" });
      rows.push(testRow("converted", -source.amount, { date: source.date, transferId: source.id }));
    }),
    getAccounts: async () => [{ id: "vehicles", name: "Asset", offBudget: true, closed: false }, { id: "bank", name: "Bank", offBudget: false, closed: false }],
    getAccountBalances: async () => new Map([["vehicles", rows.reduce((s, r) => s + r.amount, 0) / 100]]), canVerifyTransferLinks: async () => true,
    listTransactionsForSync: async ({ accountId }: { accountId: string }) => accountId === "vehicles" ? rows : externalRows,
    createTransactionsForSync: jest.fn(async (inputs) => {
      const input = inputs[0];
      if (input.accountId === "vehicles") rows.push(testRow("adjustment", input.amount, { date: input.date, notes: input.notes, importedId: input.importedId }));
      else { externalRows.push(testRow("payment", input.amount, { ...input, accountId: "bank", transferId: "acquisition" })); rows.push(testRow("acquisition", -input.amount, { date: input.date, notes: input.notes, transferId: "payment" })); }
      return { created: [{ transactionId: input.accountId === "vehicles" ? "adjustment" : "payment" }] };
    }),
  } as unknown as ActualBenchTransport;
  const fresh = async (): Promise<CapitalContext> => ({ asset, registry, transport, snapshot: await readBook(transport, "vehicles", "2026-10-01"), external: { rows: normalizeActivity(externalRows).rows, issues: [], accounts: await transport.getAccounts(), fetchedAt: "read" } });
  return { transport, registry, fresh, rows: () => rows, externalRows };
}
it.each(["browser-api", "http-api"] as const)("turns an existing expense into the transfer into the asset once, changing only its payee, in %s", async (mode) => {
  const f = await fixture(mode); const before = f.externalRows.map((r) => ({ ...r }));
  const p = prepareCapital(await f.fresh(), { kind: "convert", sourceId: "capex", date: "2026-10-01", notes: "" });
  const result = await executeCapital(p, f.fresh);
  expect(p.deltaMinor).toBe(2000000); expect(result).toMatchObject({ transactionId: "converted" });
  expect(f.transport.convertToTransfer).toHaveBeenCalledTimes(1);
  expect(f.transport.convertToTransfer).toHaveBeenCalledWith(expect.objectContaining({ allowReconciled: true, transferPayeeId: "to-asset", counterpartAccountId: "vehicles" }));
  const after = f.externalRows.find((r) => r.id === "capex")!; const was = before.find((r) => r.id === "capex")!;
  expect({ ...after, payeeId: was.payeeId, transferId: was.transferId }).toEqual(was); // amount, date, category and Notes untouched
  const changes = capitalMetadata(p, result); expect(changes).toEqual([expect.objectContaining({ role: "book", actualTransactionId: "converted", classification: "acquisition" })]);
  expect(() => prepareCapital({ ...p.context, external: { ...p.context.external, rows: normalizeActivity(f.externalRows).rows } }, p.input)).toThrow(/not a transfer/); // it is a transfer now
});
it("refuses a deposit, an uncategorized on-budget expense, and a connection that cannot convert", async () => {
  const f = await fixture("http-api");
  const ctx = await f.fresh();
  expect(() => prepareCapital(ctx, { kind: "convert", sourceId: "receipt", date: "2026-10-01", notes: "" })).toThrow(/expense/);
  f.externalRows.push(testRow("bare", -1000, { accountId: "bank", date: "2026-09-02", categoryId: null }));
  expect(() => prepareCapital({ ...ctx, external: { ...ctx.external, rows: normalizeActivity(f.externalRows).rows } }, { kind: "convert", sourceId: "bare", date: "2026-10-01", notes: "" })).toThrow(/category/);
  const noConvert = { ...ctx, transport: { ...ctx.transport, convertToTransfer: undefined } as unknown as CapitalContext["transport"] };
  expect(() => prepareCapital(noConvert, { kind: "convert", sourceId: "capex", date: "2026-10-01", notes: "" })).toThrow(/cannot turn an expense/);
});
it.each([11000000, 9000000, 4000000])("treats receipt and transfer proceeds %s without duplicate cash", async (proceeds) => {
  for (const representation of ["external-receipt", "asset-transfer"] as const) {
    const transfer = testRow("sale-transfer", -proceeds, { date: "2026-10-01", transferId: "receipt" });
    const f = await fixture("http-api", representation === "asset-transfer" ? [transfer] : [], proceeds);
    if (representation === "asset-transfer") f.externalRows[0].transferId = "sale-transfer";
    const before = JSON.stringify(f.externalRows);
    const p = prepareCapital(await f.fresh(), { kind: "dispose", representation, sourceId: representation === "external-receipt" ? "receipt" : "sale-transfer", date: "2026-10-01", carryingMinor: proceeds === 4000000 ? 4000000 : 10000000, proceedsBasis: "gross", feeIds: ["cost"], notes: "Sale" });
    const result = await executeCapital(p, f.fresh);
    expect(p.afterMinor).toBe(proceeds === 4000000 ? 6000000 : 0);
    expect(JSON.stringify(f.externalRows)).toBe(before);
    expect(f.transport.createTransactionsForSync).toHaveBeenCalledTimes(p.deltaMinor ? 1 : 0);
    expect(capitalMetadata(p, result).filter((c) => c.context?.data.kind === "disposal")).toHaveLength(1);
  }
});
it("writes off carrying value, rejects excess/duplicate sources, and refuses stale previews", async () => {
  const f = await fixture("http-api");
  const p = prepareCapital(await f.fresh(), { kind: "dispose", representation: "write-off", sourceId: "", date: "2026-10-01", carryingMinor: 10000000, proceedsBasis: "gross", feeIds: [], notes: "Write off" });
  expect(capitalMetadata(p, await executeCapital(p, f.fresh))[0].context?.data).toMatchObject({ representation: "write-off", bookAdjustmentTransactionId: null });
  expect(() => prepareCapital(p.context, { ...p.input, carryingMinor: 20000000 } as typeof p.input)).toThrow(/exceeds/);
  const stale = await fixture("http-api"); const preview = prepareCapital(await stale.fresh(), { kind: "convert", sourceId: "capex", date: "2026-10-01", notes: "" });
  stale.externalRows[2].amount = -3000000;
  await expect(executeCapital(preview, stale.fresh)).rejects.toThrow(/changed/);
  expect(stale.transport.convertToTransfer).not.toHaveBeenCalled();
});
it.each(["browser-api", "http-api"] as const)("creates one genuine acquisition transfer and verifies its category/counterpart in %s", async (mode) => {
  const f = await fixture(mode);
  const p = prepareCapital(await f.fresh(), { kind: "acquire", sourceAccountId: "bank", amountMinor: 2500000, categoryId: "purchase", paymentNotRecorded: true, date: "2026-10-01", notes: "Purchase" });
  expect(await executeCapital(p, f.fresh)).toMatchObject({ transactionId: "acquisition" });
  expect(f.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
  expect(f.externalRows.find((r) => r.id === "payment")?.categoryId).toBe("purchase");
  expect(f.rows().find((r) => r.id === "acquisition")?.amount).toBe(2500000);
  expect(() => prepareCapital(awaitNever(), p.input)).toThrow(/matching payment/);
  function awaitNever() { return { ...p.context, external: { ...p.context.external, rows: normalizeActivity(f.externalRows).rows } }; }
});
it("never repeats a conversion after a lost response", async () => {
  const f = await fixture("http-api"); const p = prepareCapital(await f.fresh(), { kind: "convert", sourceId: "capex", date: "2026-10-01", notes: "" });
  f.transport.convertToTransfer = jest.fn(async () => { throw new Error("lost response"); });
  await expect(executeCapital(p, f.fresh)).rejects.toBeInstanceOf(UncertainAssetWrite);
  expect(f.transport.convertToTransfer).toHaveBeenCalledTimes(1);
});
