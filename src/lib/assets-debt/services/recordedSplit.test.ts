import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, CATEGORIES, byKind, createScenario } from "../testing/postingScenario";
import { readMatchingHistory } from "../actual/ledgerPort";
import { runDebtBacktest } from "./backtestService";
import { approveAndRecordClaim, overrideRepaymentSplit, proposeUnsplit } from "./postingWorkflowService";
import { reconcileDebt } from "./reconciliationService";
import { listDebtPostings } from "./proposalService";

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
  async function splitByHand(extraInterestMinor: number, mode: "http" | "direct" = "http") {
    const probe = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    probe.seedPayment("2024-01-29");
    const [proposed] = byKind((await probe.preview(window)).postings, "repayment-split");
    if (proposed.output.kind !== "restructure") throw new Error("restructure");
    const calculatedInterest = proposed.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
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
    const writesBefore = s.fake.writes().length;
    const first = await s.preview(window);
    expect(first.unscheduled).toEqual([]);
    const [recorded] = byKind(listDebtPostings(s.db, s.debtId), "repayment-split");
    // Matching the calculation, it is recorded on the refresh itself (owner decision 2026-10-07).
    expect(recorded).toMatchObject({ classification: "safe", status: "applied", output: { kind: "claim", recordedSplit: expect.objectContaining({ interestMinor: calculatedInterest, calculatedInterestMinor: calculatedInterest }) } });
    if (recorded.output.kind !== "claim" || !recorded.output.recordedSplit) throw new Error("recorded split");
    expect(recorded.output.recordedSplit.parent.id).toBe(payment);
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

/**
 * Step 2 (T314): changing the amounts of a split already in Actual. The edit becomes a Review
 * change that rewrites the split's amounts in place (every id kept, the loan-side row following the
 * principal); its undo puts Actual's amounts back exactly.
 */
describe.each(["http", "direct"] as const)("changing the amounts of a split already in Actual (%s)", (mode) => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  async function splitByHand(extraInterestMinor: number) {
    const probe = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    probe.seedPayment("2024-01-29");
    const [proposed] = byKind((await probe.preview(window)).postings, "repayment-split");
    if (proposed.output.kind !== "restructure") throw new Error("restructure");
    const calculatedInterest = proposed.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-01-29");
    const interest = calculatedInterest + extraInterestMinor;
    s.fake.editInActual(payment, { subtransactions: [
      { amount: -(242915 - interest), payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), notes: "Principal" },
      { amount: -interest, category: CATEGORIES.interest, notes: "Interest" },
    ] });
    return { s, payment, calculatedInterest, interest };
  }

  const splitInActual = (s: Awaited<ReturnType<typeof splitByHand>>["s"], payment: string) => {
    const children = s.fake.rows().filter((r) => r.parent_id === payment).sort((a, b) => a.id.localeCompare(b.id));
    const principal = children.find((c) => c.transfer_id)!;
    return { ids: children.map((c) => c.id), amounts: children.map((c) => c.amount), principal, counterpart: s.fake.row(principal.transfer_id as string)! };
  };

  it("Reset to calculated becomes a Review change; applying rewrites the amounts in place and Undo puts Actual's back", async () => {
    const { s, payment, calculatedInterest, interest } = await splitByHand(500);
    const [recorded] = byKind((await s.preview(window)).postings, "repayment-split");
    const before = splitInActual(s, payment);
    const counterpartId = before.counterpart.id;

    const edited = overrideRepaymentSplit(s.db, recorded.id, { interestMinor: calculatedInterest, reason: null }, "2024-06-01T00:00:01Z");
    expect(edited).toMatchObject({ classification: "review", output: { kind: "adjust-split", edit: { actualInterestMinor: interest, calculatedInterestMinor: calculatedInterest, interestMinor: calculatedInterest } } });
    expect(edited.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["edited-split", "adjust-split"]));
    // A fresh preview keeps the edit (the split in Actual has not changed).
    const [kept] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(kept.output).toMatchObject({ kind: "adjust-split", edit: { interestMinor: calculatedInterest } });

    expect((await s.apply(kept)).posting.status).toBe("applied");
    const after = splitInActual(s, payment);
    expect(after.ids).toEqual(before.ids);
    expect(after.counterpart.id).toBe(counterpartId);
    expect(after.principal.amount).toBe(-(242915 - calculatedInterest));
    expect(after.counterpart.amount).toBe(242915 - calculatedInterest);
    expect(s.fake.row(payment)!.amount).toBe(-242915);
    expect(listDebtTransactionLinks(s.db, s.debtId).map((l) => l.actualTransactionId)).toEqual([after.principal.id]);
    // Applied: nothing more is proposed for the period, and the calculation uses the new principal.
    expect(byKind((await s.preview(window)).postings, "repayment-split").filter((p) => p.status === "proposed")).toEqual([]);

    const applied = byKind((await s.preview(window)).postings, "repayment-split")[0] ?? (await import("./proposalService")).listDebtPostings(s.db, s.debtId).find((p) => p.id === kept.id)!;
    const reversal = s.undo(applied);
    expect(reversal).toMatchObject({ classification: "review", output: { kind: "adjust-split", edit: null } });
    expect((await s.apply(reversal)).posting.status).toBe("applied");
    const restored = splitInActual(s, payment);
    expect(restored.ids).toEqual(before.ids);
    expect(restored.amounts).toEqual(before.amounts);
    expect(restored.counterpart.id).toBe(counterpartId);
    expect(restored.counterpart.amount).toBe(242915 - interest);
    // Back to Actual's own split: recorded as it is again.
    const [again] = byKind((await s.preview(window)).postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(again.output).toMatchObject({ kind: "claim", recordedSplit: expect.objectContaining({ interestMinor: interest }) });
  });

  it("Actual's own value goes back to recording it as it is; a far value needs a reason; recovery reads what landed", async () => {
    const { s, interest, calculatedInterest } = await splitByHand(500);
    const [recorded] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(() => overrideRepaymentSplit(s.db, recorded.id, { interestMinor: calculatedInterest + 900, reason: null })).toThrow(/reason/);
    const edited = overrideRepaymentSplit(s.db, recorded.id, { interestMinor: calculatedInterest + 900, reason: "Lender statement" }, "2024-06-01T00:00:01Z");
    expect(edited.output.kind).toBe("adjust-split");
    const back = overrideRepaymentSplit(s.db, edited.id, { interestMinor: interest, reason: null }, "2024-06-01T00:00:02Z");
    expect(back.output).toMatchObject({ kind: "claim", recordedSplit: expect.objectContaining({ interestMinor: interest }) });
    // Recovery of an interrupted change: nothing landed yet, so it is reported as not applied.
    const again = overrideRepaymentSplit(s.db, back.id, { interestMinor: calculatedInterest, reason: null }, "2024-06-01T00:00:03Z");
    const { recoverAdjustSplit } = await import("./recovery");
    if (again.output.kind !== "adjust-split") throw new Error("adjust");
    expect((await recoverAdjustSplit(again.output, s.transport)).status).toBe("not-found");
  });
});

describe.each(["http", "direct"] as const)("unsplitting a split already in Actual (%s)", (mode) => {
  const window = { from: "2024-02-01", to: "2024-02-29" };

  it("puts the payment back as one transfer to the loan for the whole amount; Bench then proposes the split again", async () => {
    const probe = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    probe.seedPayment("2024-01-29");
    const [proposed] = byKind((await probe.preview(window)).postings, "repayment-split");
    if (proposed.output.kind !== "restructure") throw new Error("restructure");
    const interest = proposed.output.components.find((c) => c.kind === "interest")!.amountMinor;
    resetAppDbForTests();
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-01-29");
    s.fake.editInActual(payment, { subtransactions: [
      { amount: -(242915 - interest), payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), notes: "Principal" },
      { amount: -interest, category: CATEGORIES.interest, notes: "Interest" },
    ] });
    await s.preview(window);
    const [claim] = byKind(listDebtPostings(s.db, s.debtId), "repayment-split");
    expect(claim.status).toBe("applied");
    const applied = listDebtPostings(s.db, s.debtId).find((p) => p.id === claim.id)!;
    const unsplit = proposeUnsplit(s.db, applied.id, { accountDirectory: s.directory, transferPayees: s.transferPayees, today: "2024-06-03" });
    expect(unsplit).toMatchObject({ classification: "review", reversalOf: claim.id, output: { kind: "restore-split" } });
    expect((await s.apply(unsplit)).posting.status).toBe("applied");
    const row = s.fake.row(payment)!;
    expect(row.is_parent).toBeFalsy();
    expect(s.fake.rows().filter((r) => r.parent_id === payment)).toEqual([]);
    expect(row.payee).toBe(s.fake.transferPayeeId(ACCOUNTS.mortgage));
    expect(s.fake.row(row.transfer_id as string)).toMatchObject({ account: ACCOUNTS.mortgage, amount: 242915 });
    const [again] = byKind((await s.preview(window)).postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(again.output.kind).toBe("restructure");
  });
});

describe("recording a claim in one step (speed)", () => {
  it("refuses a change that writes to Actual; a split already in Actual that matches is recorded on the refresh, in one step", async () => {
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
    await s.preview({ from: "2024-02-01", to: "2024-02-29" });
    const [claim] = byKind(listDebtPostings(s.db, s.debtId), "repayment-split");
    expect(claim.status).toBe("applied");
    expect(listDebtTransactionLinks(s.db, s.debtId)).toHaveLength(1);
  });
});
