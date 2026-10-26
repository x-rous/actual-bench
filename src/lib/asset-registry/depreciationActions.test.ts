import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ActionContext } from "./actions";
import { prepareAction } from "./actions";
import { depreciationMetadata, executeDepreciation, prepareDepreciation } from "./depreciationActions";
import { readBook } from "./ledger";
import type { Registry } from "./models";
import { testAsset, testRow } from "./testing";

const TODAY = "2026-03-15";
function setup(extraMetadata: Registry["metadata"] = []) {
  let rows = [testRow("opening", 1200000, { date: "2025-12-01" })]; let counter = 0;
  const transport = { mode: "http-api", sync: jest.fn(async () => {}), getPayees: jest.fn(async () => []),
    getSyncCapabilities: () => ({ capabilities: { listTransactions: true, readSplitLines: true, createTransaction: true, createTransactionWithImportedId: true } }),
    listTransactionsForSync: jest.fn(async () => rows), getAccountBalances: jest.fn(async () => new Map([["vehicles", rows.reduce((s, r) => s + r.amount, 0) / 100]])), canVerifyTransferLinks: jest.fn(async () => true),
    createTransactionsForSync: jest.fn(async (inputs) => { const input = inputs[0]; const id = `dep-${++counter}`; rows = [...rows, testRow(id, input.amount, { date: input.date, notes: input.notes, importedId: input.importedId })]; return { created: [{ transactionId: id }] }; }),
  } as unknown as ActualBenchTransport;
  const registry: Registry = { assets: [testAsset("asset", { assetTag: null })], metadata: extraMetadata,
    depreciation: [{ assetId: "asset", method: "straight-line", basisMinor: 1200000, residualMinor: 0, startDate: "2026-01-01", lifeMonths: 12, annualRateBps: null, updatedAt: "t" }] };
  const fresh = (date: string) => async (): Promise<ActionContext> => ({ transport, registry, asset: registry.assets[0], snapshot: await readBook(transport, "vehicles", date) });
  return { transport, registry, fresh, rows: () => rows };
}
it("posts a January/February batch on each month end, one negative row each, and refuses an unfinished month", async () => {
  const s = setup();
  for (const [period, date] of [["2026-01", "2026-01-31"], ["2026-02", "2026-02-28"]]) {
    const prepared = prepareDepreciation(await s.fresh(date)(), period, TODAY);
    expect(prepared).toMatchObject({ date, amountMinor: -100000, replaces: null });
    const result = await executeDepreciation(prepared, s.fresh(date));
    expect(depreciationMetadata(prepared, result, await s.fresh(date)())).toEqual([expect.objectContaining({ role: "book", classification: "depreciation", depreciationPeriod: period, actualTransactionId: result.transactionId })]);
  }
  expect(s.transport.createTransactionsForSync).toHaveBeenCalledTimes(2);
  expect(s.rows().filter((r) => r.amount === -100000).map((r) => r.date)).toEqual(["2026-01-31", "2026-02-28"]);
  expect(s.rows().filter((r) => r.amount === -100000).every((r) => r.notes?.includes("#depreciation"))).toBe(true); // posted months are tagged in Actual
  const march = await s.fresh("2026-03-31")();
  expect(() => prepareDepreciation(march, "2026-03", TODAY)).toThrow(/not ended/);
  expect(() => prepareDepreciation(march, "2027-01", TODAY)).toThrow(/not in the saved schedule/);
});
it("refuses a duplicate month, and a missing Actual row needs a deliberate repost that replaces its association", async () => {
  const association = (id: string) => ({ actualTransactionId: id, actualAccountId: "vehicles", assetId: "asset", classification: "depreciation", revision: 4, depreciationPeriod: "2026-01" });
  const posted = setup([association("opening")]); // the associated Actual row exists
  await expect((async () => prepareDepreciation(await posted.fresh("2026-01-31")(), "2026-01", TODAY))()).rejects.toThrow(/already posted/);
  const missing = setup([association("deleted-in-actual")]);
  const context = await missing.fresh("2026-01-31")();
  const prepared = prepareDepreciation(context, "2026-01", TODAY);
  expect(prepared.replaces?.actualTransactionId).toBe("deleted-in-actual");
  const result = await executeDepreciation(prepared, missing.fresh("2026-01-31"));
  expect(depreciationMetadata(prepared, result, context)).toEqual([
    expect.objectContaining({ actualTransactionId: "deleted-in-actual", remove: true, revision: 4 }),
    expect.objectContaining({ actualTransactionId: result.transactionId, depreciationPeriod: "2026-01" }),
  ]);
});
it("a missing depreciation month stays flagged but does not block other months or unrelated book writes", async () => {
  const gone = { actualTransactionId: "deleted-in-actual", actualAccountId: "vehicles", assetId: "asset", classification: "depreciation", revision: 2, depreciationPeriod: "2026-01" };
  const s = setup([gone]);
  // February posts normally while January is still missing.
  const feb = prepareDepreciation(await s.fresh("2026-02-28")(), "2026-02", TODAY);
  expect(feb).toMatchObject({ date: "2026-02-28", replaces: null });
  await executeDepreciation(feb, s.fresh("2026-02-28"));
  // An unrelated Update value is not blocked either.
  const context = await s.fresh("2026-03-10")();
  expect(prepareAction(context, { kind: "set-value", date: "2026-03-10", amountMinor: 1000000, notes: "", payeeId: null }).deltaMinor).toBe(1000000 - 1100000);
  // January is reposted only when selected, replacing its stale association.
  expect(prepareDepreciation(await s.fresh("2026-01-31")(), "2026-01", TODAY).replaces?.actualTransactionId).toBe("deleted-in-actual");
});
it("does not block writes for a classified row that disappeared from Actual: Actual is the truth", async () => {
  const s = setup([{ actualTransactionId: "gone-row", actualAccountId: "vehicles", assetId: "asset", classification: "revaluation", revision: 1 }]);
  const blocked = await s.fresh("2026-03-10")();
  expect(() => prepareAction(blocked, { kind: "set-value", date: "2026-03-10", amountMinor: 1, notes: "", payeeId: null })).not.toThrow();
});
