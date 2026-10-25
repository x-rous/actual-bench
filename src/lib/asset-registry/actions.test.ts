import { boundTreatment, executeAction, freshActionContext, prepareAction, protectedReason, UncertainAssetWrite, writeTypeTags, type ActionContext } from "./actions";
import type { Registry } from "./models";
import { readBook } from "./ledger";
import { testAsset, testRow } from "./testing";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
async function setup(mode: "browser-api" | "http-api") {
  let rows = [testRow("byd", 11000000, { notes: "#asset_byd", importedId: "ordinary-bank-import" }), testRow("toyota", 7500000, { notes: "#asset_toyota" }), testRow("other", 500000)];
  const transport = { mode, sync: jest.fn(async () => {}), getPayees: jest.fn(async () => []),
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true, createTransaction: true, createTransactionWithImportedId: true, updateTransaction: true, deleteTransaction: true } }),
    listTransactionsForSync: jest.fn(async () => rows), getAccountBalances: jest.fn(async () => new Map([["vehicles", rows.reduce((s, r) => s + r.amount, 0) / 100]])), canVerifyTransferLinks: jest.fn(async () => true),
    createTransactionsForSync: jest.fn(async (inputs) => { const input = inputs[0]; rows = [...rows, testRow("created", input.amount, { date: input.date, notes: input.notes, importedId: input.importedId })]; return { created: [{ transactionId: "created" }] }; }),
    updateTransactionForSync: jest.fn(async (input) => { rows = rows.map((r) => r.id === input.transactionId ? { ...r, date: input.date, amount: input.amount, notes: input.notes, payeeId: input.payeeId } : r); }),
    deleteTransactionForSync: jest.fn(async ({ transactionId }) => { rows = rows.filter((r) => r.id !== transactionId); }),
  } as unknown as ActualBenchTransport;
  const registry: Registry = { assets: [testAsset(), testAsset("toyota")], metadata: [] };
  const fresh = async (): Promise<ActionContext> => ({ transport, registry, asset: registry.assets[0], snapshot: await readBook(transport, "vehicles", "2026-10-24") });
  return { transport, fresh, rows: () => rows, change: (next: SyncSourceTransaction[]) => { rows = next; } };
}
it.each(["browser-api", "http-api"] as const)("guards and verifies standalone imported CRUD and shared Update value in %s", async (mode) => {
  const { transport, fresh, rows } = await setup(mode);
  const prepared = prepareAction(await fresh(), { kind: "set-value", date: "2026-10-24", amountMinor: 11500000, notes: "Appraisal", payeeId: null });
  expect(prepared.deltaMinor).toBe(500000); expect(prepared.afterMinor).toBe(11500000);
  expect(await executeAction(prepared, fresh)).toEqual({ transactionId: "created", deleted: false, noop: false });
  expect(rows().find((r) => r.id === "toyota")?.amount).toBe(7500000);
  const edited = prepareAction(await fresh(), { kind: "edit", transactionId: "byd", date: "2026-10-24", amountMinor: 10000000, notes: "#asset_byd", payeeId: null });
  await executeAction(edited, fresh); expect(transport.updateTransactionForSync).toHaveBeenCalledTimes(1);
  const deleted = prepareAction(await fresh(), { kind: "delete", transactionId: "byd", date: "2026-10-24", amountMinor: 0, notes: "", payeeId: null });
  expect((await executeAction(deleted, fresh)).deleted).toBe(true);
  expect(transport.deleteTransactionForSync).toHaveBeenCalledTimes(1);
});
it("refuses stale sums/membership, unknown structures and protected transfers before any mutation", async () => {
  const s = await setup("http-api"); const context = await s.fresh();
  const p = prepareAction(context, { kind: "set-value", date: "2026-10-24", amountMinor: 11500000, notes: "", payeeId: null });
  s.change([...s.rows(), testRow("external", 1)]);
  await expect(executeAction(p, s.fresh)).rejects.toThrow(/changed/);
  expect(s.transport.createTransactionsForSync).not.toHaveBeenCalled();
  for (const extra of [{ transferId: "peer" }, { reconciled: true }, { isParent: true }, { scheduleId: "s" }, { transferId: undefined }, { scheduleId: undefined }]) expect(protectedReason(testRow("unsafe", 1, extra), true)).not.toBeNull();
  expect(protectedReason(testRow("safe-import", 1, { importedId: "bank-import" }), true)).toBeNull();
});
it("does not retry an ambiguous create or invent zero from incomplete reads", async () => {
  const s = await setup("http-api"); const context = await s.fresh();
  const p = prepareAction(context, { kind: "create", date: "2026-10-24", amountMinor: 123, notes: "", payeeId: null });
  s.transport.createTransactionsForSync = jest.fn(async () => { throw new Error("connection lost"); });
  await expect(executeAction(p, s.fresh)).rejects.toBeInstanceOf(UncertainAssetWrite);
  expect(s.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
  expect(() => prepareAction({ ...context, snapshot: { ...context.snapshot, balanceMinor: null } }, p.edit)).toThrow(/incomplete/);
});
it("creates no row for zero Update value delta", async () => {
  const s = await setup("http-api"); const p = prepareAction(await s.fresh(), { kind: "set-value", date: "2026-10-24", amountMinor: 11000000, notes: "", payeeId: null });
  expect((await executeAction(p, s.fresh)).noop).toBe(true); expect(s.transport.createTransactionsForSync).not.toHaveBeenCalled();
});

it("syncs Direct external changes before preparing a fresh guard snapshot", async () => {
  const s = await setup("browser-api");
  const registry = (await s.fresh()).registry;
  const load = jest.fn(async () => registry);
  const context = await freshActionContext(s.transport, "byd", "2026-10-24", load);
  expect(context.snapshot.balanceMinor).toBe(19000000);
  expect(s.transport.sync).toHaveBeenCalledTimes(1);
  expect(jest.mocked(s.transport.sync).mock.invocationCallOrder[0]).toBeLessThan(load.mock.invocationCallOrder[0]);
});

it("creates dedicated-account adjustments without generating or attaching a hashtag", async () => {
  const s = await setup("http-api");
  s.change([testRow("opening", 10000, { notes: "Opening" })]);
  const context = await s.fresh();
  context.asset = testAsset("byd", { assetTag: null });
  context.registry = { assets: [context.asset], metadata: [] };
  const fresh = async () => ({ ...context, snapshot: await readBook(s.transport, "vehicles", "2026-10-24") });
  const prepared = prepareAction(await fresh(), { kind: "create", date: "2026-10-24", amountMinor: 500, notes: "Appraisal", payeeId: null });
  await executeAction(prepared, fresh);
  expect(s.rows().find((row) => row.id === "created")?.notes).toBe("Appraisal");
});

it("preserves untagged Notes when editing a shared row attributed by a Bench mapping", async () => {
  const s = await setup("http-api");
  s.change([testRow("mapped", 10000, { notes: "Original notes" })]);
  (await s.fresh()).registry.metadata.push({ actualTransactionId: "mapped", actualAccountId: "vehicles", assetId: "byd", classification: null, revision: 1 });
  const prepared = prepareAction(await s.fresh(), { kind: "edit", transactionId: "mapped", date: "2026-10-24", amountMinor: 12000, notes: "Original notes", payeeId: null });
  await executeAction(prepared, s.fresh);
  expect(s.rows()[0].notes).toBe("Original notes");
});

it.each(["browser-api", "http-api"] as const)("verifies dedicated Update value when %s returns null for blank Notes", async (mode) => {
  const s = await setup(mode);
  s.change([testRow("opening", 10000, { notes: null })]);
  const asset = testAsset("byd", { assetTag: null });
  const fresh = async (): Promise<ActionContext> => ({ ...(await s.fresh()), asset, registry: { assets: [asset], metadata: [] } });
  const create = s.transport.createTransactionsForSync;
  s.transport.createTransactionsForSync = jest.fn(async (inputs) => {
    const result = await create(inputs);
    s.change(s.rows().map((row) => row.id === "created" ? { ...row, notes: null } : row));
    return result;
  });
  const prepared = prepareAction(await fresh(), { kind: "set-value", date: "2026-10-24", amountMinor: 20000, notes: "", payeeId: null });
  expect(await executeAction(prepared, fresh)).toEqual({ transactionId: "created", deleted: false, noop: false });
  expect(s.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
});
it("keeps materially changed nonempty Notes unverified", async () => {
  const s = await setup("http-api");
  const create = s.transport.createTransactionsForSync;
  s.transport.createTransactionsForSync = jest.fn(async (inputs) => {
    const result = await create(inputs);
    s.change(s.rows().map((row) => row.id === "created" ? { ...row, notes: "Different notes #asset_byd" } : row));
    return result;
  });
  const prepared = prepareAction(await s.fresh(), { kind: "create", date: "2026-10-24", amountMinor: 500, notes: "Expected notes", payeeId: null });
  await expect(executeAction(prepared, s.fresh)).rejects.toBeInstanceOf(UncertainAssetWrite);
  expect(s.transport.createTransactionsForSync).toHaveBeenCalledTimes(1);
});
it("tags editable rows in Notes, skips protected ones and removes the tag when unclassified", async () => {
  const { transport, fresh, change, rows } = await setup("http-api");
  change([testRow("a", 100, { notes: "Appraisal" }), testRow("t", -100, { transferId: "peer" }), testRow("c", 5, { notes: "x #revaluation" })]);
  const result = await writeTypeTags(await fresh(), ["a", "t", "c"], "revaluation");
  expect(result).toEqual({ tagged: ["a"], skipped: ["t"] }); // "c" already carries the tag
  expect(rows().find((r) => r.id === "a")?.notes).toBe("Appraisal #revaluation");
  expect(transport.updateTransactionForSync).toHaveBeenCalledTimes(1);
  expect((await writeTypeTags(await fresh(), ["a"], null)).tagged).toEqual(["a"]);
  expect(rows().find((r) => r.id === "a")?.notes).toBe("Appraisal");
});

test("boundTreatment names the treatment that owns a row", () => {
  const meta = (extra: object) => ({ actualTransactionId: "r", ...extra }) as never;
  expect(boundTreatment({ metadata: [meta({ depreciationPeriod: "2026-01" })] }, "r")).toBe("depreciation");
  expect(boundTreatment({ metadata: [meta({ capitalizedFromTransactionId: "x" })] }, "r")).toBe("capital-expenditure");
  expect(boundTreatment({ metadata: [meta({})] }, "r")).toBeNull();
  const disposal = { data: { kind: "disposal", bookAdjustmentTransactionId: "companion" } };
  expect(boundTreatment({ metadata: [meta({ context: disposal })] }, "r")).toBe("disposal");
  expect(boundTreatment({ metadata: [meta({ context: disposal })] }, "companion")).toBe("disposal");
  expect(boundTreatment({ metadata: [], cashflows: [{ context: disposal } as never] }, "companion")).toBe("disposal");
});
