import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { readMatchingHistory } from "../actual/ledgerPort";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { listNeedsAttention } from "./attentionService";
import { runDebtBacktest } from "./backtestService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
afterEach(() => resetAppDbForTests());

describe("needs attention across loans (T293)", () => {
  it("lists a loan with changes to review, worst state first; nothing when there is nothing to do", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    expect(listNeedsAttention(s.db, "budget-1")).toEqual([]);
    s.seedPayment("2024-02-01");
    await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    const [item] = listNeedsAttention(s.db, "budget-1");
    expect(item).toMatchObject({ subjectKind: "debt", id: s.debtId, filter: "action", reasons: [{ code: "review", count: 1 }] });
  });

  it("flags an active loan whose repayment matching is not enabled", () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.db.prepare("UPDATE debt_match_rules SET enabled = 0 WHERE debt_id = ?").run(s.debtId);
    const items = listNeedsAttention(s.db, "budget-1");
    expect(items[0]?.reasons).toEqual([{ code: "matching-not-enabled" }]);
  });
});

describe("backtest uses the same actual-date split as Activity (T292)", () => {
  it("an early payment's expected interest equals the proposal's, not the scheduled calculation", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-01-01", to: "2024-02-29" })).postings, "repayment-split");
    const proposalInterest = Math.abs((split.output as unknown as { operations: { economicKind: string; amountMinor: number }[] }).operations.find((c) => c.economicKind === "interest")!.amountMinor);
    const rule = listDebtMatchRules(s.db, s.debtId).find((r) => r.purpose === "repayment")!;
    const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking], from: "2024-01-01", to: "2024-02-29" });
    const result = runDebtBacktest(s.db, s.debtId, { ...rule, purpose: "repayment" } as never, { from: "2024-01-01", to: "2024-02-29", snapshots });
    const period = result.periods.find((p) => p.expected.date === "2024-02-01")!;
    expect(period.status).toBe("unique");
    expect(period.expected.interestMinor).toBe(proposalInterest);
  });
});
