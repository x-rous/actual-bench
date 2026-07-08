import { getBudgetFileSyncCapabilities, hasSyncCapabilities, missingSyncCapabilities } from "./capabilities";

describe("budget file sync capabilities", () => {
  it("marks HTTP API mode unsupported for the Direct-only MVP", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });

    expect(report.supported).toBe(false);
    expect(report.reason).toMatch(/Direct mode/i);
    expect(report.capabilities.createPayee).toBe(false);
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

  it("reports HTTP API mode with no sync capabilities at all", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });
    expect(Object.values(report.capabilities).every((v) => v === false)).toBe(true);
  });
});
