import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { readMatchingHistory } from "../actual/ledgerPort";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { runDebtBacktest } from "./backtestService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
afterEach(() => resetAppDbForTests());

describe("backtest: periods already handled by an applied change (T287)", () => {
  it("flags a period whose payment Bench already split as already handled, not plain missing", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const rule = listDebtMatchRules(s.db, s.debtId).find((r) => r.purpose === "repayment")!;
    const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking], from: "2024-01-15", to: "2024-03-15" });
    const result = runDebtBacktest(s.db, s.debtId, { ...rule, purpose: "repayment" } as never, { from: "2024-01-15", to: "2024-03-15", snapshots });
    const period = result.periods.find((p) => p.expected.date === "2024-02-01")!;
    expect(["missing", "unsafe"]).toContain(period.status);
    expect(period.flags).toContain("already-handled");
    // Not counted as unsafe or missing, so re-enabling the rule is not refused by its own applied period.
    expect(result.summary.unsafe).toBe(0);
    const other = result.periods.find((p) => p.expected.date === "2024-03-01");
    expect(other?.flags ?? []).not.toContain("already-handled");
  });
});
