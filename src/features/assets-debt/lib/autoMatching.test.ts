import { afterMatchingSetup, setUpRepaymentMatching } from "./autoMatching";
import * as api from "./debtsApi";
import { repaymentDays } from "./matchingRuleBuilder";

jest.mock("./debtsApi", () => ({ listMatchRules: jest.fn(), getSchedule: jest.fn(), checkDraftMatchRule: jest.fn(), createMatchRule: jest.fn() }));
jest.mock("./freshHistory", () => ({ readFreshMatchingHistory: jest.fn(async () => [{ accountId: "chk", transactions: [] }]) }));
const mocked = api as jest.Mocked<typeof api>;

const detail = (patch: Record<string, unknown> = {}) => ({
  debt: { id: "d1", status: "active", paymentAccountId: "chk", liabilityAccountId: "loan", signConvention: "negative-is-debt", driftToleranceMinor: 100, ...patch },
  config: { ok: true, config: { terms: { openingDate: "2026-07-03", contractualPaymentMinor: 837891 }, profile: { repaymentFrequency: "monthly" } } },
}) as never;
const check = (summary: Partial<{ unique: number; missing: number; multiple: number; unsafe: number }>) => ({ summary: { expectedPeriods: 3, unique: 3, missing: 0, multiple: 0, unsafe: 0, ...summary } }) as never;
const transport = {} as never;

beforeEach(() => {
  jest.clearAllMocks();
  mocked.listMatchRules.mockResolvedValue([]);
  mocked.createMatchRule.mockImplementation(async () => ({ record: { id: "rule-1" } }) as never);
});

/** Repayment matching set up with a new loan (owner decision 2026-10-06). */
describe("automatic repayment matching for a new loan", () => {
  it("a clean check turns the suggested rule on (with the check) and lands on Sync Repayments", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(check({}));
    const result = await setUpRepaymentMatching(detail(), transport, "2026-10-05");
    expect(result.status).toBe("on");
    const [, rule, backtest] = mocked.createMatchRule.mock.calls[0];
    expect(rule.enabled).toBe(true);
    expect(backtest).toMatchObject({ from: "2026-07-03", to: "2026-10-05" });
    // Monthly: ten days either side; the contractual repayment as the amount.
    expect(JSON.stringify(rule.conditions)).toContain('"daysBefore":10');
    expect(JSON.stringify(rule.conditions)).toContain('"tolerance":{"kind":"absolute","amountMinor":83789}');
    expect(JSON.stringify(rule.conditions)).toContain('"amountMinor":837891');
    expect(afterMatchingSetup(result, "d1", (id, q) => `/loans/${id}?${q}`)).toMatchObject({ href: "/loans/d1?view=repayments", message: "Repayment matching is on: 3 repayments found in Actual.", tone: "success" });
  });

  it("a missed due date still turns it on (the due date shows on Sync Repayments), saying so", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(check({ unique: 2, missing: 1 }));
    const result = await setUpRepaymentMatching(detail(), transport, "2026-10-05");
    expect(result.status).toBe("on");
    expect(mocked.createMatchRule.mock.calls[0][1].enabled).toBe(true);
    expect(afterMatchingSetup(result, "d1", (id, q) => `/loans/${id}?${q}`)).toMatchObject({ href: "/loans/d1?view=repayments", tone: "success", message: expect.stringContaining("1 due date has no payment yet") });
  });

  it("a payment Bench could never change saves the rule off and opens it in the matching editor", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(check({ unique: 2, unsafe: 1 }));
    const result = await setUpRepaymentMatching(detail(), transport, "2026-10-05");
    expect(result.status).toBe("needs-review");
    expect(mocked.createMatchRule.mock.calls[0][1].enabled).toBe(false);
    expect(afterMatchingSetup(result, "d1", (id, q) => `/loans/${id}?${q}`)).toMatchObject({ href: "/loans/d1?view=link&rule=rule-1", tone: "warning" });
  });

  it("the server refusing to turn it on still saves it, off", async () => {
    mocked.checkDraftMatchRule.mockResolvedValue(check({}));
    mocked.createMatchRule.mockRejectedValueOnce(new Error("This rule cannot be enabled: weak")).mockResolvedValueOnce({ record: { id: "rule-2" } } as never);
    const result = await setUpRepaymentMatching(detail(), transport, "2026-10-05");
    expect(result).toMatchObject({ status: "needs-review", ruleId: "rule-2", message: expect.stringContaining("weak") });
  });

  it("does nothing without both accounts, for a draft, or when the loan already has a rule", async () => {
    expect(await setUpRepaymentMatching(detail({ paymentAccountId: null }), transport)).toEqual({ status: "skipped", reason: "accounts-missing" });
    expect(await setUpRepaymentMatching(detail({ status: "draft" }), transport)).toEqual({ status: "skipped", reason: "not-active" });
    mocked.listMatchRules.mockResolvedValue([{}] as never);
    expect(await setUpRepaymentMatching(detail(), transport)).toEqual({ status: "skipped", reason: "has-rules" });
    expect(mocked.createMatchRule).not.toHaveBeenCalled();
  });

  it("looks a sensible number of days either side for each frequency", () => {
    expect(repaymentDays("monthly")).toEqual({ early: 10, late: 10 });
    expect(repaymentDays("fortnightly")).toEqual({ early: 4, late: 4 });
    expect(repaymentDays("weekly")).toEqual({ early: 2, late: 2 });
    expect(repaymentDays("custom-dated")).toEqual({ early: 3, late: 3 });
  });
});
