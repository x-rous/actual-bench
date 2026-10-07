import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { readMatchingHistory } from "../actual/ledgerPort";
import { ACCOUNTS, createScenario } from "../testing/postingScenario";
import { backtestDraftMatchingRule } from "./matchingService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** The matching editor's live check (T280 rev 2): the same backtest as a saved rule, and nothing is stored. */
describe("checking an unsaved matching rule", () => {
  it("finds the repayment like a saved rule would, without creating or changing any rule", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const before = listDebtMatchRules(s.db, s.debtId).map((r) => [r.id, r.lastBacktestJson, r.updatedAt]);
    const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking], from: "2024-01-01", to: "2024-02-29" });
    const result = backtestDraftMatchingRule(s.db, s.debtId, {
      purpose: "repayment",
      conditions: { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "source-account", accountId: ACCOUNTS.checking }, { kind: "expected-date", daysBefore: 3, daysAfter: 3 }, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] },
      actions: { format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] },
    }, { from: "2024-01-01", to: "2024-02-29", snapshots });
    expect(result.periods.find((p) => p.expected.date === "2024-02-01")?.status).toBe("unique");
    expect(listDebtMatchRules(s.db, s.debtId).map((r) => [r.id, r.lastBacktestJson, r.updatedAt])).toEqual(before);
  });
});
