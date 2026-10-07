import { apiRequest } from "@/lib/api/client";
import { canonicalJson } from "@/lib/app-db/canonicalJson";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { getDebtDetail, listDebtSummaries } from "./debtConfigService";
import { paidOffState } from "./payoffState";
import { listDebtPostings } from "./proposalService";
import { reconcileDebt } from "./reconciliationService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/**
 * Paying the loan off (owner decisions 2026-10-07): a payment that covers the principal still owed
 * plus the interest to the day it was paid is proposed as the payoff split (always Review), the loan
 * then shows as paid off (worked out, never stored), nothing later is expected, and Undo reopens it.
 */
describe("paying a loan off", () => {
  const window = { from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" };

  /** February's repayment applied; then a transfer into the loan of `extra` above the principal still owed. */
  async function paidOffBy(date: string, extra: number, options: { anyAmount?: boolean } = {}) {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", repaymentAnyPayee: true });
    if (options.anyAmount) {
      // Any amount, 13 days either side (like a rule a user widened): the payoff can fall in a due date's window.
      const conditions = { format: "rd084.debt-match-conditions", version: 1, operator: "all", items: [{ kind: "source-account", accountId: ACCOUNTS.checking }, { kind: "expected-date", daysBefore: 13, daysAfter: 13 }, { kind: "amount", operator: "between", minMinor: 0, maxMinor: Number.MAX_SAFE_INTEGER, direction: "outflow" }, { kind: "bench-marker", value: "exclude" }, { kind: "posting-link", value: "exclude" }] };
      s.db.prepare("UPDATE debt_match_rules SET conditions_json = ? WHERE purpose = 'repayment'").run(canonicalJson(conditions));
    }
    s.seedPayment("2024-01-29");
    const [feb] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(feb)).posting.status).toBe("applied");
    if (feb.output.kind !== "restructure" || !feb.output.closing) throw new Error("closing");
    const owedPrincipal = feb.output.closing.principalMinor;
    const amount = owedPrincipal + extra;
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date, amount, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Payoff" });
    const payment = s.seedPayment(date, -amount, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), notes: "Payoff", transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = payment;
    return { s, owedPrincipal, amount, payment, loanSide };
  }

  it("found outside the matching rule: proposed as the payoff (Review), interest to the day it was paid, nothing expected after it", async () => {
    const { s, owedPrincipal, amount, payment } = await paidOffBy("2024-02-20", 200_000);
    const result = await s.preview(window);
    const payoffs = byKind(result.postings, "repayment-split").filter((p) => p.output.kind === "restructure" && p.output.payoff);
    expect(payoffs).toHaveLength(1);
    const [payoff] = payoffs;
    if (payoff.output.kind !== "restructure" || !payoff.output.payoff) throw new Error("payoff");
    expect(payoff.classification).toBe("review");
    expect(payoff.periodKey).toBe("2024-03-01");
    expect(payoff.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(["payoff", "payoff-figures"]));
    expect(payoff.output.before.id).toBe(payment);
    const figures = payoff.output.payoff;
    expect(figures).toMatchObject({ paidDate: "2024-02-20", owedPrincipalMinor: owedPrincipal });
    expect(figures.interestMinor).toBeGreaterThan(0);
    expect(figures.interestMinor + figures.excessMinor).toBe(amount - owedPrincipal);
    // The whole principal goes to the loan; the rest is interest (no fee component on this loan).
    expect(payoff.output.components).toEqual([{ kind: "principal", amountMinor: owedPrincipal }, { kind: "interest", amountMinor: amount - owedPrincipal }]);
    expect(payoff.output.closing?.principalMinor).toBe(0);
    // Nothing is expected after the payoff, and the payment is not offered as an extra payment.
    expect(result.notices.filter((n) => n.periodKey > "2024-03-01")).toEqual([]);
    expect(result.unscheduled).toEqual([]);
  });

  it("paid off after the last due date so far, before the next one is due: still the payoff, in place of that next repayment", async () => {
    const { s, owedPrincipal, payment } = await paidOffBy("2024-02-20", 200_000);
    // Today is 2024-02-25: the 2024-03-01 repayment is not due yet.
    const result = await s.preview({ from: "2024-01-01", to: "2024-02-25", today: "2024-02-25" });
    const [payoff] = byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed");
    expect(payoff).toMatchObject({ periodKey: "2024-03-01", classification: "review", output: { kind: "restructure", before: expect.objectContaining({ id: payment }), payoff: expect.objectContaining({ paidDate: "2024-02-20", owedPrincipalMinor: owedPrincipal }) } });
    expect(result.unscheduled).toEqual([]);
  });

  it("inside a due date's window under an any-amount rule: still the payoff, never a Recommended routine split", async () => {
    const { s, owedPrincipal } = await paidOffBy("2024-02-26", 250_000, { anyAmount: true });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split.classification).toBe("review");
    expect(split.output).toMatchObject({ kind: "restructure", payoff: expect.objectContaining({ paidDate: "2024-02-26", owedPrincipalMinor: owedPrincipal }), closing: expect.objectContaining({ principalMinor: 0 }) });
  });

  it("applied: the loan shows as paid off, the calculation is zero, nothing more is proposed; Undo reopens it", async () => {
    const { s } = await paidOffBy("2024-02-20", 200_000);
    const [payoff] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(payoff)).posting.status).toBe("applied");
    expect(paidOffState(s.db, s.debtId)).toMatchObject({ paidDate: "2024-02-20", dueDate: "2024-03-01" });
    expect(getDebtDetail(s.db, s.debtId)!.paidOff).toMatchObject({ paidDate: "2024-02-20" });
    expect(listDebtSummaries(s.db, "budget-1")[0].paidOffOn).toBe("2024-02-20");
    const rec = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-06-30", actualBalanceMinor: 0 });
    if (!rec.ok) throw new Error("reconcile");
    expect(rec.comparison.modelMinor).toBe(0);
    const after = await s.preview(window);
    expect(after.postings.filter((p) => p.status === "proposed")).toEqual([]);
    expect(after.notices).toEqual([]);

    const applied = listDebtPostings(s.db, s.debtId).find((p) => p.id === payoff.id)!;
    const undo = s.undo(applied);
    expect((await s.apply(undo)).posting.status).toBe("applied");
    expect(paidOffState(s.db, s.debtId)).toBeNull();
    expect(getDebtDetail(s.db, s.debtId)!.paidOff).toBeNull();
  });

  it("a large payment that does not clear the loan is no payoff and no repayment: it is an extra payment to record", async () => {
    const { s, amount } = await paidOffBy("2024-02-26", -20_000_000, { anyAmount: true });
    const result = await s.preview(window);
    expect(byKind(result.postings, "repayment-split").filter((p) => p.status === "proposed" && p.output.kind === "restructure" && p.output.payoff)).toEqual([]);
    expect(result.unscheduled).toEqual([expect.objectContaining({ date: "2024-02-26", amountMinor: amount })]);
  });


  it("a loan that records interest as its own transaction: the transfer that leaves the loan account at zero is the payoff", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    // The loan's money, then one transfer that repays it all (the lender's interest is its own row).
    s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-01-01", amount: -40_000_000, payee: null, notes: "Loan" });
    s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: -150_000, payee: null, notes: "Interest", imported_id: "lender:int" });
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-10", amount: 40_150_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking), notes: "Payoff" });
    const paid = s.seedPayment("2024-02-10", -40_150_000, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    const result = await s.preview({ from: "2024-01-01", to: "2024-06-30", today: "2024-06-30" });
    const links = byKind(result.postings, "repayment-link");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ periodKey: "2024-03-01", classification: "review", output: { kind: "claim", payoff: expect.objectContaining({ paidDate: "2024-02-10" }) } });
    // Nothing is charged or expected after it.
    expect(byKind(result.postings, "interest-charge").filter((p) => p.periodKey > "2024-02-10")).toEqual([]);
    expect(result.notices.filter((n) => n.periodKey > "2024-03-01")).toEqual([]);
    expect((await s.apply(links[0])).posting.status).toBe("applied");
    expect(paidOffState(s.db, s.debtId)).toMatchObject({ paidDate: "2024-02-10" });
  });
});
