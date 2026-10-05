import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, CATEGORIES, byKind, createScenario } from "../testing/postingScenario";
import { readMatchingHistory } from "../actual/ledgerPort";
import { runDebtBacktest } from "./backtestService";
import { approveAndRecordClaim } from "./postingWorkflowService";
import { reconcileDebt } from "./reconciliationService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * Repayments already split in Actual (owner decision 2026-10-06): matched as one payment, recorded
 * as they are (nothing written to Actual), Actual's figures used like a user's edit, and compared
 * with Bench's calculation.
 */
describe("a repayment already split in Actual", () => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  /** The calculated split for the period, then the same payment split by hand in Actual. */
  async function splitByHand(extraInterestMinor: number) {
    const probe = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    probe.seedPayment("2024-01-29");
    const [proposed] = byKind((await probe.preview(window)).postings, "repayment-split");
    if (proposed.output.kind !== "restructure") throw new Error("restructure");
    const calculatedInterest = proposed.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-01-29");
    const interest = calculatedInterest + extraInterestMinor;
    s.fake.editInActual(payment, { subtransactions: [
      { amount: -(242915 - interest), payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), notes: "Principal" },
      { amount: -interest, category: CATEGORIES.interest, notes: "Interest" },
    ] });
    return { s, payment, calculatedInterest, interest };
  }

  it("is recorded as it is and Recommended when it matches the calculation; applying writes nothing and records the link", async () => {
    const { s, payment, calculatedInterest } = await splitByHand(0);
    const first = await s.preview(window);
    expect(first.unscheduled).toEqual([]);
    const [recorded] = byKind(first.postings, "repayment-split");
    expect(recorded).toMatchObject({ classification: "safe", output: { kind: "claim", recordedSplit: expect.objectContaining({ interestMinor: calculatedInterest, calculatedInterestMinor: calculatedInterest }) } });
    if (recorded.output.kind !== "claim" || !recorded.output.recordedSplit) throw new Error("recorded split");
    expect(recorded.output.recordedSplit.parent.id).toBe(payment);
    const writesBefore = s.fake.writes().length;
    expect((await s.apply(recorded)).posting.status).toBe("applied");
    expect(s.fake.writes().length).toBe(writesBefore);
    expect(listDebtTransactionLinks(s.db, s.debtId).map((l) => l.actualTransactionId)).toEqual([recorded.output.rows[0].id]);
    // The principal part's loan-side row belongs to this repayment: never listed as a payment not in the schedule.
    expect((await s.preview(window)).unscheduled).toEqual([]);
  });

  it("differs from the calculation: Review, shown as edited, and later figures build on Actual's interest", async () => {
    const { s, calculatedInterest, interest } = await splitByHand(500);
    const [recorded] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(recorded.classification).toBe("review");
    expect(recorded.reasons.map((r) => r.code)).toContain("recorded-split-differs");
    if (recorded.output.kind !== "claim" || !recorded.output.recordedSplit || !recorded.output.closing) throw new Error("recorded split");
    expect(recorded.output.recordedSplit).toMatchObject({ interestMinor: interest, calculatedInterestMinor: calculatedInterest });
    expect((await s.apply(recorded)).posting.status).toBe("applied");
    const rec = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-01-30", actualBalanceMinor: 0 });
    if (!rec.ok) throw new Error("reconcile");
    expect(rec.asPaidFrom).toBe("2024-01-29");
    expect(rec.comparison.modelMinor).toBe(recorded.output.closing.principalMinor);
  });

  it("the history check counts it as found, not unsafe, so the rule can be turned on", async () => {
    const { s } = await splitByHand(0);
    const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking], from: "2024-01-01", to: "2024-02-29" });
    const rule = s.db.prepare("SELECT purpose, rule_format_version AS ruleFormatVersion, conditions_json AS conditionsJson, actions_json AS actionsJson FROM debt_match_rules WHERE debt_id = ? AND purpose = 'repayment'").get<{ purpose: "repayment"; ruleFormatVersion: number; conditionsJson: string; actionsJson: string }>(s.debtId)!;
    const result = runDebtBacktest(s.db, s.debtId, rule, { from: "2024-01-01", to: "2024-02-29", snapshots });
    const feb = result.periods.find((p) => p.expected.date === "2024-02-01");
    expect(feb?.status).toBe("unique");
    expect(result.summary.unsafe).toBe(0);
  });
});

describe("recording a claim in one step (speed)", () => {
  it("approves and records a split already in Actual in one call, and refuses a change that writes to Actual", async () => {
    const probe = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    probe.seedPayment("2024-01-29");
    const [write] = byKind((await probe.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const writeRows = await probe.fresh(write);
    expect(() => approveAndRecordClaim(probe.db, write.id, { fresh: writeRows, now: "2024-06-02T00:00:00Z" })).toThrow(/Only a claim/);
    if (write.output.kind !== "restructure") throw new Error("restructure");
    const interest = write.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-01-29");
    s.fake.editInActual(payment, { subtransactions: [
      { amount: -(242915 - interest), payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), notes: "Principal" },
      { amount: -interest, category: CATEGORIES.interest, notes: "Interest" },
    ] });
    const [claim] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const recorded = approveAndRecordClaim(s.db, claim.id, { fresh: await s.fresh(claim), now: "2024-06-02T00:00:00Z" });
    expect(recorded.status).toBe("applied");
    expect(listDebtTransactionLinks(s.db, s.debtId)).toHaveLength(1);
  });
});
