import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, CATEGORIES, byKind, createScenario } from "../../testing/postingScenario";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

describe("planners (T118–T120)", () => {
  it("Pattern B without a lender feed proposes the interest charge in the off-budget liability, uncategorized, Safe", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const result = await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    const charges = byKind(result.postings, "interest-charge");
    expect(charges).toHaveLength(1);
    const [charge] = charges;
    expect(charge).toMatchObject({ classification: "safe", periodKey: "2024-02-28", idempotencyMarker: expect.stringMatching(/^abdebt:budget-1:.+:interest-charge:2024-02-28:g1$/) });
    expect(charge.output).toMatchObject({ kind: "create", operations: [{ accountId: ACCOUNTS.mortgage, amountMinor: -387857, categoryId: null, economicKind: "interest" }] });
  });

  it("Pattern B with a lender feed waits for the lender's charge and never posts its own; then claims it", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest", lenderFeed: true });
    const waiting = await s.preview({ from: "2024-02-01", to: "2024-02-29", today: "2024-03-01" });
    expect(byKind(waiting.postings, "interest-charge")).toHaveLength(0);
    expect(waiting.notices.map((n) => n.code)).toContain("waiting-for-lender");
    s.seedLenderRow("2024-02-28", -387857);
    const linked = await s.preview({ from: "2024-02-01", to: "2024-02-29", today: "2024-03-01" });
    expect(byKind(linked.postings, "interest-link")).toEqual([expect.objectContaining({ classification: "safe", output: expect.objectContaining({ kind: "claim", role: "lender-interest-charge" }) })]);
    expect(byKind(linked.postings, "interest-charge")).toHaveLength(0);
  });

  it("a late lender charge after Bench's applied charge proposes a Review compensating reversal (no double interest)", async () => {
    const s = createScenario({ mode: "direct", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "interest-charge");
    await s.apply(charge);
    // The lender feed starts after the fact: reconfigure by adding the rule directly.
    const s2 = s; // same DB and fake
    const { insertDebtMatchRule } = await import("@/lib/app-db/debtMatchRuleRepository");
    const { canonicalJson } = await import("@/lib/app-db/canonicalJson");
    insertDebtMatchRule(s2.db, s2.debtId, { purpose: "interest-charge", ruleFormatVersion: 1, enabled: true,
      actionsJson: canonicalJson({ format: "rd084.debt-match-actions", version: 1, items: [{ kind: "link-repayment" }] }),
      conditionsJson: canonicalJson({ format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "source-account", accountId: ACCOUNTS.mortgage }, { kind: "payee", operator: "exact", payeeId: "p-lender" }, { kind: "expected-date", daysBefore: 5, daysAfter: 5 }, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] }) });
    s.seedLenderRow("2024-02-28", -387857);
    const after = await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    const reversal = byKind(after.postings, "reversal");
    expect(reversal).toEqual([expect.objectContaining({ classification: "review", reversalOf: charge.id })]);
    expect(reversal[0].reasons.map((r) => r.code)).toContain("late-lender-charge");
  });

  it("Pattern A without a lender feed splits the matched payment: residual principal is a transfer to the liability", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect(split.classification).toBe("review");
    if (split.output.kind !== "restructure") throw new Error("expected restructure");
    const children = split.output.expectedPostState.children;
    expect(children.reduce((sum, c) => sum + c.amountMinor, 0)).toBe(-242915);
    expect(children[0]).toMatchObject({ economicKind: "principal", transferAccountId: ACCOUNTS.mortgage, categoryId: CATEGORIES.loan });
    expect(children[1]).toMatchObject({ economicKind: "interest", categoryId: CATEGORIES.interest });
  });

  it("Pattern A with a lender feed: the principal child has no transfer payee; the link is a second, reviewed proposal", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("expected restructure");
    expect(split.output.expectedPostState.children[0]).toMatchObject({ economicKind: "principal", transferAccountId: null });
    const principal = -split.output.expectedPostState.children[0].amountMinor;
    s.seedLenderRow("2024-02-01", principal);
    await s.apply(split);
    const [link] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    expect(link).toMatchObject({ classification: "review", output: expect.objectContaining({ kind: "link" }) });
  });

  it("Pattern A: a reconciled payment is Blocked; a mismatched or reconciled lender row Blocks the link", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01", -242915, { reconciled: true });
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect(split).toMatchObject({ classification: "blocked" });
    expect(split.reasons.map((r) => r.text)).toContain("The matched row is reconciled in Actual. Resolve in Actual, then re-run.");

    const t = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    t.seedPayment("2024-02-01");
    const [tsplit] = byKind((await t.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (tsplit.output.kind !== "restructure") throw new Error("expected restructure");
    t.seedLenderRow("2024-02-01", -tsplit.output.expectedPostState.children[0].amountMinor + 1);
    await t.apply(tsplit);
    const [link] = byKind((await t.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-link");
    expect(link).toMatchObject({ classification: "blocked" });
    expect(link.reasons.map((r) => r.code)).toContain("lender-amount-mismatch");
  });

  it("missing loan payment category Blocks with the plain-language next action", async () => {
    // The saved configuration requires the category; it can still go missing afterwards (e.g. the
    // category is deleted in Actual and the directory refreshes), which the planner must Block.
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.db.prepare("UPDATE debts SET loan_payment_category_id = NULL WHERE id = ?").run(s.debtId);
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect(split.classification).toBe("blocked");
    expect(split.reasons.map((r) => r.text)).toContain("Choose a loan payment category for this debt.");
  });

  it("T120: opening adjustment is Review off-budget and Blocked on-budget without the user's category; never Safe", async () => {
    const { setDebtOnboardingDate } = await import("@/lib/app-db/debtRepository");
    const { insertDebtAnchor } = await import("@/lib/app-db/debtAnchorRepository");
    for (const offBudget of [true, false]) {
      const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest", liabilityOffBudget: offBudget });
      setDebtOnboardingDate(s.db, s.debtId, "2024-01-15", "2024-01-15T00:00:00.000Z");
      insertDebtAnchor(s.db, { debtId: s.debtId, anchorDate: "2024-01-15", principalMinor: 39_900_000, accruedInterestMinor: 0, carriedRemainderDecimal: null, source: "accepted-observation", observationKind: "manual-statement", observationId: null, configRevision: 1 }, "2024-01-15T00:00:00.000Z");
      const result = await s.preview({ from: "2024-01-15", to: "2024-01-31" }, { parameters: { actualBalanceAtOnboardingMinor: 40_000_000 } });
      const [opening] = byKind(result.postings, "opening-adjustment");
      expect(opening.output).toMatchObject({ kind: "create", operations: [{ accountId: ACCOUNTS.mortgage, amountMinor: 100_000, categoryId: null }] });
      expect(opening.classification).toBe(offBudget ? "review" : "blocked");
      if (!offBudget) expect(opening.reasons.map((r) => r.code)).toContain("missing-category");
    }
  });

  it("D1: a reconciliation adjustment is always Review, never Safe", async () => {
    const { insertDebtObservation } = await import("@/lib/app-db/debtObservationRepository");
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    insertDebtObservation(s.db, { debtId: s.debtId, observedOn: "2024-02-15", recordedAt: "2024-02-16T00:00:00Z", principalMinor: 39_950_000, accruedInterestMinor: 0, source: "manual-statement", supersedesObservationId: null, note: null }, "2024-02-16T00:00:00Z");
    const result = await s.preview({ from: "2024-02-01", to: "2024-02-29" }, { comparison: { comparisonDate: "2024-02-15", actualBalanceMinor: 39_960_000 } });
    const [adjustment] = byKind(result.postings, "reconciliation-adjustment");
    expect(adjustment.classification).toBe("review");
    expect(adjustment.output).toMatchObject({ kind: "create", operations: [{ amountMinor: 10_000 }] });
  });
});
