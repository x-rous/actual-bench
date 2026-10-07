import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { liabilityEffectMinor } from "./pendingEffect";
import { reconcileDebt } from "./reconciliationService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * FR-170c: material drift that the pending changes themselves close is explained. The routine
 * split is then Recommended; a gap the changes do not close keeps it in Review.
 */
describe("drift explained by pending changes (FR-170c)", () => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  async function gapCase(extraMinor: number) {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    // Actual has not recorded the repayment on the loan account yet: it shows the model's balance
    // plus the principal the split would transfer, plus `extraMinor` the changes cannot explain.
    const first = await s.preview(window);
    const [split] = byKind(first.postings, "repayment-split");
    // Negative-is-debt: the split's transfer raises the loan account by the principal, so the debt
    // Actual shows today is that much higher than after the change.
    const principal = liabilityEffectMinor(split.output, ACCOUNTS.mortgage);
    expect(principal).toBeGreaterThan(0);
    const model = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: window.to, actualBalanceMinor: 0 });
    if (!model.ok) throw new Error("reconcile");
    const actual = (model.comparison.modelMinor ?? 0) + principal + extraMinor;
    return s.preview(window, { comparison: { comparisonDate: window.to, actualBalanceMinor: actual } });
  }

  it("explained: Recommended, and the result says so", async () => {
    const result = await gapCase(0);
    expect(result).toMatchObject({ driftMaterial: true, driftExplained: true });
    expect(byKind(result.postings, "repayment-split")[0].classification).toBe("safe");
  });

  it("not explained: stays Review with the drift note", async () => {
    const result = await gapCase(5_000_00);
    expect(result).toMatchObject({ driftMaterial: true, driftExplained: false });
    const [split] = byKind(result.postings, "repayment-split");
    expect(split.classification).toBe("review");
    expect(split.reasons.map((r) => r.code)).toContain("drift-material");
  });
});
