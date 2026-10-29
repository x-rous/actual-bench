import { apiRequest } from "@/lib/api/client";
import type { LoanModelSnapshot } from "@/lib/financial-models/loan/model";
import { planTracking, proposalContext, type TrackingInput } from "@/lib/assets-debt/tracking/plan";
import { createFakeActual } from "@/lib/assets-debt/testing/fakeActual";
import { HARNESS_MODES, transportFor, type HarnessMode } from "@/lib/assets-debt/testing/transportHarness";
import { SIMULATOR_DEFAULT_PROFILE } from "./simulatorModel";
import { readTracking } from "./trackingReads";
import { applyProposals } from "./trackingWrites";
import { finishWrite, startWrite } from "./trackingApi";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
jest.mock("./trackingApi", () => ({ startWrite: jest.fn(), finishWrite: jest.fn() }));
jest.mock("./debugTiming", () => ({ startTiming: () => ({ step: () => undefined, end: () => undefined }) }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
const mockStart = startWrite as jest.Mock;
const mockFinish = finishWrite as jest.Mock;

/** 500,000 at 5.4% over 20 years from 15 Jan 2024, repaid on the 15th. */
const model = {
  debtId: "d1", revision: 1, currency: { code: "USD", minorDigits: 2 }, behaviorClass: "term-loan", lenderPattern: "embedded-interest",
  terms: { openingDate: "2024-01-15", openingPrincipalMinor: 500_000_00, maturityDate: "2044-01-15", contractualTermMonths: 240, amortizationTermMonths: 240, contractualPaymentMinor: null, creditLimitMinor: null, firstPaymentDate: "2024-02-15", firstInterestChargeDate: "2024-02-15" },
  profile: SIMULATOR_DEFAULT_PROFILE, rates: [{ accrualEffectiveFrom: "2024-01-15", annualRateDecimal: "0.054" }],
  phases: [], offsets: [], components: [], paymentRecasts: [], assumptions: [], revolving: null,
} as unknown as LoanModelSnapshot;

const TODAY = "2024-03-20";

function setup(mode: HarnessMode) {
  const fake = createFakeActual({
    accounts: [{ id: "checking", name: "Checking" }, { id: "loan", name: "Mortgage", offbudget: true }],
    categories: [{ id: "cat-loan", name: "Loan payments" }, { id: "cat-interest", name: "Interest" }],
  });
  // The loan received, then two monthly payments made as whole transfers from checking.
  const transfer = (date: string, amount: number) => {
    const bank = fake.seed({ account: "checking", date, amount: -amount, payee: fake.transferPayeeId("loan"), cleared: true });
    const loan = fake.seed({ account: "loan", date, amount, payee: fake.transferPayeeId("checking"), transfer_id: bank, cleared: true });
    fake.row(bank)!.transfer_id = loan;
  };
  transfer("2024-01-15", -500_000_00);
  transfer("2024-02-15", 3_411_26);
  transfer("2024-03-15", 3_411_26);
  const transport = transportFor(mode, fake, mockApiRequest);
  const accounts = [{ id: "checking", name: "Checking", offBudget: false, closed: false }, { id: "loan", name: "Mortgage", offBudget: true, closed: false }];
  const debt: TrackingInput["debt"] = {
    id: "d1", budgetSyncId: "budget-1", liabilityAccountId: "loan", trackingStartDueDate: "2024-02-15", representation: "split",
    loanPaymentCategoryId: "cat-loan", interestCategoryId: "cat-interest", feeCategoryId: null, principalNoteSuffix: "", interestNoteSuffix: "#interest", toleranceMinor: 100, missingGraceDays: 5,
  };
  async function plan() {
    const reads = await readTracking(transport, { loanAccountId: "loan", from: "2024-01-15", today: TODAY, ruleAccountIds: [] });
    const result = planTracking({ debt, model, today: TODAY, accounts, transferPayeeByAccount: reads.transferPayeeByAccount, loanRows: reads.loanRows, bankRows: reads.bankRows, entries: [], rules: [] });
    if (!result.ok) throw new Error(result.message);
    return { result, reads };
  }
  const ctx = (transferPayeeByAccount: Record<string, string>) => ({
    connectionId: `conn-${mode}`, debtId: "d1", transport, liabilityAccountId: "loan", transferPayeeByAccount, offBudgetAccountIds: new Set(["loan"]),
  });
  return { fake, plan, ctx, proposalContext: () => proposalContext(debt, accounts, {}) };
}

beforeEach(() => {
  let n = 0;
  mockStart.mockReset().mockImplementation(async () => ({ id: `w${++n}` }));
  mockFinish.mockReset().mockResolvedValue(undefined);
});

describe.each(HARNESS_MODES)("applying loan tracking writes (%s)", (mode) => {
  it("splits each Unrecorded payment into principal and interest; the next read shows them Recorded and proposes nothing", async () => {
    const s = setup(mode);
    const before = await s.plan();
    const unrecorded = before.result.installments.filter((i) => i.status === "unrecorded");
    expect(unrecorded.map((i) => i.dueDate)).toEqual(["2024-02-15", "2024-03-15"]);

    const { outcomes, clearingProblem } = await applyProposals(s.ctx(before.reads.transferPayeeByAccount), unrecorded.map((i) => i.proposal!));
    expect(outcomes.map((o) => [o.status, o.message])).toEqual([["applied", null], ["applied", null]]);
    expect(clearingProblem).toBeNull();

    // Each write is journaled before it runs and closed with its outcome.
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(mockFinish.mock.calls.map((c) => c[2].status)).toEqual(["applied", "applied"]);

    // The paying side is a split: interest to its category, principal still a transfer into the loan.
    const parents = s.fake.rows().filter((r) => r.account === "checking" && r.is_parent);
    expect(parents).toHaveLength(2);
    for (const parent of parents) {
      const lines = s.fake.rows().filter((r) => r.parent_id === parent.id);
      expect(lines.reduce((sum, l) => sum + l.amount, 0)).toBe(parent.amount);
      expect(lines.find((l) => l.category === "cat-interest")).toMatchObject({ notes: "#interest" });
      expect(lines.filter((l) => l.payee === s.fake.transferPayeeId("loan"))).toHaveLength(1);
    }

    const after = await s.plan();
    const installments = after.result.installments.filter((i) => i.dueDate <= TODAY);
    expect(installments.map((i) => i.status)).toEqual(["recorded", "recorded"]);
    expect(installments.map((i) => i.principalMinor)).toEqual(unrecorded.map((i) => i.principalMinor));
    // The loan account holds only the principal: the opening debt less what was repaid.
    const owed = -s.fake.accountRows("loan").reduce((sum, r) => sum + r.amount, 0);
    expect(owed).toBe(500_000_00 - unrecorded[0].principalMinor - unrecorded[1].principalMinor);
  });

  it("stops at the first write that does not apply and leaves the rest unstarted", async () => {
    const s = setup(mode);
    const { result, reads } = await s.plan();
    const proposals = result.installments.filter((i) => i.status === "unrecorded").map((i) => i.proposal!);
    // The first payment changed in Actual after the plan was made: its write is refused before any change.
    const changed = proposals[0].targetIds[0];
    s.fake.editInActual(changed, { amount: -3_500_00 });
    const { outcomes } = await applyProposals(s.ctx(reads.transferPayeeByAccount), proposals);
    expect(outcomes.map((o) => o.status)).toEqual(["failed", "not-started"]);
    expect(outcomes[0].message).toBeTruthy();
    expect(s.fake.rows().filter((r) => r.is_parent)).toHaveLength(0);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });
});
