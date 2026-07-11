import { getBudgetFileSyncCapabilities, hasSyncCapabilities, missingSyncCapabilities } from "./capabilities";

describe("budget file sync capabilities", () => {
  it("supports both master-data and transaction sync over HTTP API mode", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });

    expect(report.supported).toBe(true);
    // Entity sync primitives are available…
    expect(report.capabilities.createPayee).toBe(true);
    // …and so is transaction sync (RD-060 Phase 2).
    expect(report.capabilities.listTransactions).toBe(true);
    expect(report.capabilities.createTransactionWithImportedId).toBe(true);
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
    // RD-057: Direct mode can update/delete an existing transaction.
    expect(report.capabilities.updateTransaction).toBe(true);
    expect(report.capabilities.deleteTransaction).toBe(true);
    expect(report.capabilities.createTargetSplitTransaction).toBe(true);
    expect(
      missingSyncCapabilities(report, ["createTransaction", "supportsMultiRuntimeBudgetAccess"])
    ).toEqual(["supportsMultiRuntimeBudgetAccess"]);
    expect(hasSyncCapabilities(report, ["listTransactions", "createTransactionWithImportedId"])).toBe(true);
  });

  it("enables transaction sync capabilities for HTTP API mode", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });
    expect(report.capabilities.createTransaction).toBe(true);
    expect(report.capabilities.readSplitLines).toBe(true);
    expect(report.capabilities.createSplitLinesAsSeparateTransactions).toBe(true);
    // Independent servers can hold two budgets open at once (unlike Direct mode).
    expect(report.capabilities.supportsMultiRuntimeBudgetAccess).toBe(true);
    // RD-057: HTTP mode can update/delete via actual-http-api.
    expect(report.capabilities.updateTransaction).toBe(true);
    expect(report.capabilities.deleteTransaction).toBe(true);
    expect(hasSyncCapabilities(report, ["createPayee"])).toBe(true);
    expect(hasSyncCapabilities(report, ["listTransactions"])).toBe(true);
  });
});
