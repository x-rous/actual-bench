import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, LENDER, byKind, createScenario } from "../testing/postingScenario";
import { listDebtPostings } from "./proposalService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** T134: the existing-transaction safety matrix end to end (FR-070–FR-073, FR-095, SC-008). */
describe("existing-transaction safety matrix", () => {
  const embedded = () => createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
  const window = { from: "2024-02-01", to: "2024-02-29" };

  it("uncategorized imported payment: a routine restructure, Recommended (FR-170c)", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01");
    expect(byKind((await s.preview(window)).postings, "repayment-split")[0]).toMatchObject({ classification: "safe", reasons: expect.arrayContaining([expect.objectContaining({ code: "routine-repayment-split" })]) });
  });

  it("categorized payment: Review, and the reason says the category is replaced", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01", -242915, { category: "cat-loan" });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split.classification).toBe("review");
    expect(split.reasons.map((r) => r.code)).toContain("user-category-would-be-replaced");
  });

  it("full transfer already (embedded interest): Recommended (routine, FR-170c) when the loan-side row is Actual's own and untouched (T279); Blocked when it was imported", async () => {
    for (const imported of [false, true]) {
      const s = embedded();
      const counterpart = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 242915, payee: s.fake.transferPayeeId(ACCOUNTS.checking), ...(imported ? { imported_id: "lender:feed", imported_payee: "LENDER", cleared: true } : {}) });
      s.seedPayment("2024-02-01", -242915, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: counterpart });
      s.fake.row(counterpart)!.transfer_id = s.fake.rows().find((r) => r.imported_id === "bank:2024-02-01")!.id;
      s.db.prepare("UPDATE debt_match_rules SET conditions_json = replace(conditions_json, ?, ?) WHERE purpose = 'repayment'").run(`"payeeId":"${LENDER}"`, `"payeeId":"${s.fake.transferPayeeId(ACCOUNTS.mortgage)}"`);
      const [split] = byKind((await s.preview(window)).postings, "repayment-split");
      if (imported) {
        expect(split).toMatchObject({ classification: "blocked", reasons: expect.arrayContaining([expect.objectContaining({ code: "imported-counterpart-protected" })]) });
      } else {
        expect(split).toMatchObject({ classification: "safe", reasons: expect.arrayContaining([expect.objectContaining({ code: "replaces-transfer-counterpart" })]) });
      }
      resetAppDbForTests();
    }
  });

  it("a rule that looks in the loan account matches the loan-side row; Bench changes the payment it came from, not that row", async () => {
    const s = embedded();
    const counterpart = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 242915, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    s.seedPayment("2024-02-01", -242915, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: counterpart });
    const payment = s.fake.rows().find((r) => r.imported_id === "bank:2024-02-01")!.id;
    s.fake.row(counterpart)!.transfer_id = payment;
    // "A payment into the loan account": the rule only ever sees the loan-side row.
    for (const [from, to] of [[`"accountId":"${ACCOUNTS.checking}"`, `"accountId":"${ACCOUNTS.mortgage}"`], [`"payeeId":"${LENDER}"`, `"payeeId":"${s.fake.transferPayeeId(ACCOUNTS.checking)}"`], [`"direction":"outflow"`, `"direction":"inflow"`]]) {
      s.db.prepare("UPDATE debt_match_rules SET conditions_json = replace(conditions_json, ?, ?) WHERE purpose = 'repayment'").run(from, to);
    }
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split).toMatchObject({ classification: "safe", reasons: expect.arrayContaining([expect.objectContaining({ code: "replaces-transfer-counterpart" })]) });
    expect(split.output).toMatchObject({ kind: "restructure", before: expect.objectContaining({ id: payment, accountId: ACCOUNTS.checking }) });
  });

  it("manual split already: never claimed as a parent and never restructured", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01", -242915, { subtransactions: [{ amount: -200000, category: "cat-loan" }, { amount: -42915, category: "cat-interest" }] });
    const result = await s.preview(window);
    expect(byKind(result.postings, "repayment-split")).toHaveLength(0);
  });

  it("reconciled payment: Blocked with no override; a reconciled row is never restructured in any path", async () => {
    const s = embedded();
    const id = s.seedPayment("2024-02-01", -242915, { reconciled: true });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split.classification).toBe("blocked");
    await expect(s.apply(split)).rejects.toThrow(/blocked/);
    expect(s.fake.row(id)!.is_parent).toBe(false);
  });

  it("lender counterpart reconciled: the link is Blocked; evidence only", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", lenderFeed: true });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    if (split.output.kind !== "restructure") throw new Error("restructure");
    s.seedLenderRow("2024-02-01", -split.output.expectedPostState.children[0].amountMinor, { reconciled: true });
    await s.apply(split);
    const [link] = byKind((await s.preview(window)).postings, "repayment-link");
    expect(link.classification).toBe("blocked");
    expect(link.reasons.map((r) => r.code)).toContain("reconciled-lender-row");
  });

  it("two possible payments for one due date: one is proposed for Review, naming the other (owner decision 2026-10-07)", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01");
    s.fake.seed({ account: ACCOUNTS.checking, date: "2024-02-02", amount: -242915, payee: LENDER, imported_id: "bank:dup" });
    const result = await s.preview(window);
    const splits = byKind(result.postings, "repayment-split");
    expect(splits).toHaveLength(1);
    expect(splits[0].classification).toBe("review");
    expect(splits[0].reasons.map((r) => r.code)).toContain("alignment-another-candidate");
  });

  it("evidence-only / Pattern B existing full transfer: a safe claim that writes nothing to Actual", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const counterpart = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 242915, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const bank = s.seedPayment("2024-02-01", -242915, { transfer_id: counterpart });
    s.fake.row(counterpart)!.transfer_id = bank;
    // Already what it should be: recorded on the refresh itself, nothing written to Actual (owner decision 2026-10-07).
    const writes = s.fake.writes().length;
    await s.preview(window);
    const [claim] = byKind(listDebtPostings(s.db, s.debtId), "repayment-link");
    expect(claim).toMatchObject({ classification: "safe", status: "applied", output: expect.objectContaining({ kind: "claim" }) });
    expect(s.fake.writes().length).toBe(writes);
  });

  describe("offset-funded repayments (FR-078a)", () => {
    // 200.00 put in the offset account in February: the model takes it towards the March repayment.
    const march = { from: "2024-03-01", to: "2024-03-31" };
    const funded = () => createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest", offsetFunding: { date: "2024-02-15", balanceMinor: 20_000 } });
    const transfer = (s: ReturnType<typeof funded>, from: string, date: string, amount: number) => {
      const loanSide = s.fake.seed({ account: ACCOUNTS.mortgage, date, amount, payee: s.fake.transferPayeeId(from) });
      const paying = s.fake.seed({ account: from, date, amount: -amount, payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: loanSide });
      s.fake.row(loanSide)!.transfer_id = paying;
      return { paying, loanSide };
    };

    it("the bank pays only the other-funds part: found, for Review, and the offset transfer is named, never an extra payment", async () => {
      const s = funded();
      transfer(s, ACCOUNTS.checking, "2024-02-01", 242915);
      const bank = transfer(s, ACCOUNTS.checking, "2024-03-01", 242915 - 20_000);
      const offset = transfer(s, ACCOUNTS.offset, "2024-03-01", 20_000);
      const result = await s.preview(march);
      const [split] = byKind(result.postings, "repayment-split");
      expect(split.output).toMatchObject({ kind: "restructure", before: expect.objectContaining({ id: bank.paying }) });
      expect(split.classification).toBe("review");
      expect(split.reasons).toEqual(expect.arrayContaining([expect.objectContaining({ code: "alignment-offset-part", text: expect.stringContaining("part the model takes from the offset account") })]));
      expect(result.unscheduled.map((p) => p.id)).not.toContain(offset.loanSide);
      expect(result.recordedExtraPayments ?? []).toEqual([]);
    });

    it("the whole repayment from the bank in one payment is routine", async () => {
      const s = funded();
      transfer(s, ACCOUNTS.checking, "2024-02-01", 242915);
      transfer(s, ACCOUNTS.checking, "2024-03-01", 242915);
      const [split] = byKind((await s.preview(march)).postings, "repayment-split");
      expect(split.reasons.map((r) => r.code)).not.toContain("alignment-offset-part");
    });
  });
});
