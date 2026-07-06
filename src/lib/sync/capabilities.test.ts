import { getBudgetFileSyncCapabilities, hasSyncCapabilities, missingSyncCapabilities } from "./capabilities";

describe("budget file sync capabilities", () => {
  it("marks HTTP API mode unsupported for the Direct-only MVP", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "http-api" });

    expect(report.supported).toBe(false);
    expect(report.reason).toMatch(/Direct mode/i);
    expect(report.capabilities.createPayee).toBe(false);
  });

  it("reports the current Direct-mode sync foundation capabilities", () => {
    const report = getBudgetFileSyncCapabilities({ mode: "browser-api" });

    expect(report.supported).toBe(true);
    expect(report.capabilities.listTransactions).toBe(true);
    expect(report.capabilities.readSplitLines).toBe(true);
    expect(report.capabilities.createPayee).toBe(true);
    expect(report.capabilities.createTransaction).toBe(false);
    expect(missingSyncCapabilities(report, ["listTransactions", "createTransaction"])).toEqual(["createTransaction"]);
    expect(hasSyncCapabilities(report, ["listTransactions", "readSplitLines"])).toBe(true);
  });
});
