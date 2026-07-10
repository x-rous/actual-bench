import { getBudgetFileSyncCapabilities, hasSyncCapabilities, missingSyncCapabilities } from "./capabilities";

describe("budget file sync capabilities", () => {
  it("supports master-data (but not transaction) sync over HTTP API mode", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });

    expect(report.supported).toBe(true);
    // Entity sync primitives are available…
    expect(report.capabilities.createPayee).toBe(true);
    // …but transaction sync is not yet (RD-060 Phase 2).
    expect(report.capabilities.listTransactions).toBe(false);
    expect(report.capabilities.createTransactionWithImportedId).toBe(false);
  });

  it("reports the Direct-mode capabilities proven by the Slice 1 spike", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "browser-api" });

    expect(report.supported).toBe(true);
    expect(report.capabilities.listTransactions).toBe(true);
    expect(report.capabilities.readSplitLines).toBe(true);
    expect(report.capabilities.createPayee).toBe(true);
    expect(report.capabilities.createTransaction).toBe(true);
    expect(report.capabilities.createTransactionWithImportedId).toBe(true);
    expect(report.capabilities.createTransactionWithNotesMarker).toBe(true);
    expect(report.capabilities.createSplitLinesAsSeparateTransactions).toBe(true);
    // Two budgets cannot be held open at once in one JS realm (single runtime).
    expect(report.capabilities.supportsMultiRuntimeBudgetAccess).toBe(false);
    // MVP is create-only.
    expect(report.capabilities.updateTransaction).toBe(false);
    expect(report.capabilities.deleteTransaction).toBe(false);
    expect(
      missingSyncCapabilities(report, ["createTransaction", "supportsMultiRuntimeBudgetAccess"])
    ).toEqual(["supportsMultiRuntimeBudgetAccess"]);
    expect(hasSyncCapabilities(report, ["listTransactions", "createTransactionWithImportedId"])).toBe(true);
  });

  it("enables only the entity-create capabilities for HTTP API mode", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });
    // Transaction-write capabilities stay off until Phase 2.
    expect(report.capabilities.createTransaction).toBe(false);
    expect(report.capabilities.readSplitLines).toBe(false);
    expect(hasSyncCapabilities(report, ["createPayee"])).toBe(true);
    expect(hasSyncCapabilities(report, ["listTransactions"])).toBe(false);
  });
});
