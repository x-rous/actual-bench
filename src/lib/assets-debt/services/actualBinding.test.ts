import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { getFinancialPosting } from "@/lib/app-db/financialPostingRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { paidOffState } from "./payoffState";
import { releaseChangedInActual } from "./actualBinding";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** Applied changes follow Actual (owner decision 2026-10-07): Actual is the truth. */
describe("applied changes kept in step with Actual", () => {
  const window = { from: "2024-02-01", to: "2024-02-29", today: "2024-02-29" };

  async function applied() {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const lines = s.fake.rows().filter((r) => r.parent_id === payment);
    return { s, payment, split, lines };
  }

  it("a moved repayment date releases the old interest allocation for review", async () => {
    const { s, payment, split } = await applied();
    s.fake.editInActual(payment, { date: "2024-01-30" });
    const result = await s.preview(window);
    expect(result.changedInActual).toContainEqual(expect.objectContaining({ postingId: split.id, detail: expect.stringContaining("repayment date changed") }));
    expect(getFinancialPosting(s.db, split.id)?.status).toBe("reversed");
  });

  it("does not release a payment absent from a date range without identity evidence", async () => {
    const { s, split } = await applied();
    expect(releaseChangedInActual(s.db, s.debtId, new Map(), () => false)).toEqual([]);
    expect(getFinancialPosting(s.db, split.id)?.status).toBe("applied");
  });

  it.each(["category", "payee", "account"])("releases a split when its %s changes in Actual", async (field) => {
    const { s, payment, split, lines } = await applied();
    if (field === "account") s.fake.editInActual(payment, { account: ACCOUNTS.mortgage });
    else {
      const line = lines.find((row) => field === "category" ? !row.transfer_id : !!row.transfer_id)!;
      s.fake.editInActual(line.id, { [field]: "changed-in-actual" });
    }
    const result = await s.preview(window);
    expect(result.changedInActual).toContainEqual(expect.objectContaining({ postingId: split.id }));
    expect(getFinancialPosting(s.db, split.id)?.status).toBe("reversed");
  });

  it("split amounts edited in Actual: stops counting, and the split is recorded with Actual's figures", async () => {
    const { s, split, lines } = await applied();
    const interest = lines.find((l) => !l.transfer_id)!;
    const principal = lines.find((l) => l.transfer_id)!;
    const interestBefore = Math.abs(interest.amount);
    s.fake.editInActual(interest.id, { amount: interest.amount + 5_000 });
    s.fake.editInActual(principal.id, { amount: principal.amount - 5_000 });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: split.id, periodKey: "2024-02-01", detail: "the split's amounts were changed in Actual" })]);
    expect(getFinancialPosting(s.db, split.id)).toMatchObject({ status: "reversed" });
    const [recorded] = byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(recorded.output).toMatchObject({ kind: "claim", recordedSplit: expect.objectContaining({ interestMinor: interestBefore - 5_000 }) });
  });

  it("split removed in Actual: the payment needs splitting again", async () => {
    const { s, split, lines } = await applied();
    for (const line of lines) await s.transport.deleteTransactionForSync({ transactionId: line.id });
    const result = await s.preview(window);
    expect(result.changedInActual.map((c) => c.postingId)).toEqual([split.id]);
    const [again] = byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(again.output.kind).toBe("restructure");
  });

  it("payment deleted in Actual: its due date is missed again", async () => {
    const { s, payment, split } = await applied();
    await s.transport.deleteTransactionForSync({ transactionId: payment });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: split.id, detail: "the payment is no longer in Actual" })]);
    expect(result.notices.find((n) => n.periodKey === "2024-02-01")?.code).toBe("repayment-missing");
  });

  it("a payment outside what was read is never judged missing", async () => {
    const { s, split } = await applied();
    const result = await s.preview(window, { readRanges: [{ accountId: ACCOUNTS.checking, from: "2024-02-20", to: "2024-02-29" }] });
    expect(result.changedInActual).toEqual([]);
    expect(getFinancialPosting(s.db, split.id)?.status).toBe("applied");
  });

  it("a payoff deleted in Actual reopens the loan", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    s.seedPayment("2024-01-29");
    const wide = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };
    const [feb] = byKind((await s.preview(wide)).postings, "repayment-split");
    await s.apply(feb);
    const owed = feb.output.kind === "restructure" ? feb.output.closing!.principalMinor : 0;
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-20", amount: owed + 200_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-02-20", -(owed + 200_000), { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    const [payoff] = byKind((await s.preview(wide)).postings, "repayment-split").filter((p) => p.status === "proposed");
    await s.apply(payoff);
    expect(paidOffState(s.db, s.debtId)).not.toBeNull();
    await s.transport.deleteTransactionForSync({ transactionId: paid });
    const after = await s.preview(wide);
    expect(after.changedInActual.map((c) => c.postingId)).toContain(payoff.id);
    expect(paidOffState(s.db, s.debtId)).toBeNull();
  });
});

/** Loans that record interest as its own transaction, and lender feeds: bound to Actual the same way. */
describe("charges and lender rows kept in step with Actual", () => {
  const window = { from: "2024-02-01", to: "2024-02-29", today: "2024-02-29" };

  it("an interest charge Bench added and then deleted in Actual stops counting; adding it again waits for Review", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    const { posting } = await s.apply(charge);
    await s.transport.deleteTransactionForSync({ transactionId: posting.actualIds![0] });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: charge.id, detail: "the charge Bench added is no longer in Actual" })]);
    const [again] = byKind(result.postings, "interest-charge").filter((p) => p.status === "proposed");
    expect(again.classification).toBe("review");
    expect(again.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "removed-in-actual", text: expect.stringContaining("Apply it again only if that was a mistake") })]));
  });

  it("an interest charge whose amount was edited in Actual keeps counting (Actual's figure is in the balance), and nothing is added twice", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const [charge] = byKind((await s.preview(window)).postings, "interest-charge");
    const { posting } = await s.apply(charge);
    const row = s.fake.row(posting.actualIds![0])!;
    s.fake.editInActual(row.id, { amount: row.amount - 1_000 });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([]);
    expect(getFinancialPosting(s.db, charge.id)?.status).toBe("applied");
    expect(byKind(result.postings, "interest-charge").filter((p) => p.status === "proposed")).toEqual([]);
  });

  it("the lender's interest charge taken by Bench and then deleted in Actual stops counting; the period waits for the lender again", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest", lenderFeed: true });
    const lenderRow = s.seedLenderRow("2024-02-28", -387857);
    const [claim] = byKind((await s.preview(window)).postings, "interest-link");
    await s.apply(claim);
    await s.transport.deleteTransactionForSync({ transactionId: lenderRow });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: claim.id, detail: "the lender's row is no longer in Actual" })]);
    expect(result.notices.find((n) => n.periodKey === "2024-02-28")?.code).toMatch(/waiting-for-lender|lender-charge-missing/);
  });

  it("the lender's interest charge with a new amount in Actual: taken again with Actual's amount", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest", lenderFeed: true });
    const lenderRow = s.seedLenderRow("2024-02-28", -387857);
    const [claim] = byKind((await s.preview(window)).postings, "interest-link");
    await s.apply(claim);
    s.fake.editInActual(lenderRow, { amount: -390000 });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: claim.id, detail: "the lender's row's amount was changed in Actual" })]);
    const [again] = byKind(result.postings, "interest-link").filter((p) => p.status === "proposed");
    expect(again.output).toMatchObject({ kind: "claim", rows: [expect.objectContaining({ id: lenderRow, amountMinor: -390000 })] });
  });

  it("the transfer link to the lender's repayment row removed in Actual: stops counting; linking again waits for Review", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor);
    await s.apply(split);
    const [link] = byKind((await s.preview(window)).postings, "repayment-link");
    await s.apply(link);
    if (link.output.kind !== "link") throw new Error("link");
    // In Actual, the principal line stops being a transfer (its payee set back to the lender).
    s.fake.editInActual(link.output.sourceBefore.id, { transfer_id: null, payee: "p-lender" });
    s.fake.editInActual(link.output.counterpartBefore.id, { transfer_id: null, payee: "p-lender" });
    const result = await s.preview(window);
    expect(result.changedInActual).toEqual([expect.objectContaining({ postingId: link.id, detail: "the transfer link to the lender's row was removed in Actual" })]);
    const [again] = byKind(result.postings, "repayment-link").filter((p) => p.status === "proposed");
    expect(again?.classification).toBe("review");
    expect(again?.reasons.map((r) => r.code)).toContain("removed-in-actual");
  });
});
