import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { clearRepaymentChoice, setRepaymentChoice } from "./repaymentChoiceService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** Sync Repayments matches across the whole loan in one pass (owner decision 2026-10-07). */
describe("repayments lined up across the loan", () => {
  const window = { from: "2024-02-01", to: "2024-03-31", today: "2024-03-31" };

  it("a repayment paid outside the rule's days is still found, and goes to Review saying it was late", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    // The rule allows 3 days either side and about the repayment; March is a transfer into the loan,
    // 6 days late and for more (transfers count whatever the rule says).
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-03-07", amount: 300_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-03-07", -300_000, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    const result = await s.preview(window);
    const march = byKind(result.postings, "repayment-split").find((p) => p.periodKey === "2024-03-01");
    expect(march).toBeDefined();
    expect(march!.classification).toBe("review");
    expect(march!.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "alignment-late", text: "Paid 6 days after the due date." })]));
    expect(result.paymentOptions.map((o) => [o.date, o.pairedTo])).toEqual([["2024-01-29", "2024-02-01"], ["2024-03-07", "2024-03-01"]]);
  });

  it("a month with no payment is missed, and says between which payments", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const result = await s.preview({ from: "2024-02-01", to: "2024-04-30", today: "2024-04-30" });
    expect(result.notices.find((n) => n.periodKey === "2024-03-01")?.text).toMatch(/No payment to this loan was found for this due date after the payment on 2024-01-29\. If it was paid, choose the payment/);
  });

  it("'This is the payment' moves a payment to the due date the user names; forgetting it lets matching decide again", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const payment = s.seedPayment("2024-02-11");
    setRepaymentChoice(s.db, s.debtId, { dueDate: "2024-03-01", transactionId: payment });
    const chosen = await s.preview(window);
    const splits = byKind(chosen.postings, "repayment-split");
    expect(splits.map((p) => p.periodKey)).toEqual(["2024-03-01"]);
    expect(chosen.repaymentChoices).toEqual([{ key: "2024-03-01", paymentId: payment }]);
    expect(chosen.notices.some((n) => n.periodKey === "2024-02-01" && n.code === "repayment-missing")).toBe(true);
    clearRepaymentChoice(s.db, s.debtId, "2024-03-01");
    expect(byKind((await s.preview(window)).postings, "repayment-split").map((p) => p.periodKey)).toEqual(["2024-02-01"]);
  });

  it("a split worked out while an earlier repayment was missing is flagged to redo once that repayment turns up", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    // February is missed; March pays enough to cover two months of interest.
    const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-03-01", amount: 500_000, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const paid = s.seedPayment("2024-03-01", -500_000, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
    s.fake.row(loanSide)!.transfer_id = paid;
    const march = byKind((await s.preview(window)).postings, "repayment-split").find((p) => p.periodKey === "2024-03-01")!;
    expect(march.output).toMatchObject({ kind: "restructure", missedDueDates: ["2024-02-01"] });
    expect(march.reasons.map((r) => r.code)).toContain("earlier-repayment-missed");
    expect((await s.apply(march)).posting.status).toBe("applied");
    // February's payment is entered in Actual afterwards.
    s.seedPayment("2024-01-30");
    const after = await s.preview(window);
    expect(after.notices.find((n) => n.code === "redo-after-found")).toMatchObject({ periodKey: "2024-03-01", text: expect.stringMatching(/counted the repayment due 2024-02-01 as not paid, but it has been found since/) });
    expect(byKind(after.postings, "repayment-split").some((p) => p.periodKey === "2024-02-01" && p.status === "proposed")).toBe(true);
  });

  it("a choice cannot be made for a due date that already has an applied change", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [feb] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(feb)).posting.status).toBe("applied");
    const other = s.seedPayment("2024-02-27");
    expect(() => setRepaymentChoice(s.db, s.debtId, { dueDate: "2024-02-01", transactionId: other })).toThrow(/already has an applied change/);
  });
});
