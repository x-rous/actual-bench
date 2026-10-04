import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { ACCOUNTS, LENDER, byKind, createScenario } from "../testing/postingScenario";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** T134: the existing-transaction safety matrix end to end (FR-070–FR-073, FR-095, SC-008). */
describe("existing-transaction safety matrix", () => {
  const embedded = () => createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
  const window = { from: "2024-02-01", to: "2024-02-29" };

  it("uncategorized imported payment: Review restructure", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01");
    expect(byKind((await s.preview(window)).postings, "repayment-split")[0]).toMatchObject({ classification: "review" });
  });

  it("categorized payment: Review, and the reason says the category is replaced", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01", -242915, { category: "cat-loan" });
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split.classification).toBe("review");
    expect(split.reasons.map((r) => r.code)).toContain("user-category-would-be-replaced");
  });

  it("full transfer already (embedded interest): Blocked, an existing transfer is never restructured", async () => {
    const s = embedded();
    const counterpart = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 242915, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    s.seedPayment("2024-02-01", -242915, { payee: s.fake.transferPayeeId(ACCOUNTS.mortgage), transfer_id: counterpart });
    s.fake.row(counterpart)!.transfer_id = s.fake.rows().find((r) => r.imported_id === "bank:2024-02-01")!.id;
    s.db.prepare("UPDATE debt_match_rules SET conditions_json = replace(conditions_json, ?, ?) WHERE purpose = 'repayment'").run(`"payeeId":"${LENDER}"`, `"payeeId":"${s.fake.transferPayeeId(ACCOUNTS.mortgage)}"`);
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    expect(split).toMatchObject({ classification: "blocked" });
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

  it("ambiguous match (two candidates): no posting, a notice asks the user to resolve it", async () => {
    const s = embedded();
    s.seedPayment("2024-02-01");
    s.fake.seed({ account: ACCOUNTS.checking, date: "2024-02-02", amount: -242915, payee: LENDER, imported_id: "bank:dup" });
    const result = await s.preview(window);
    expect(byKind(result.postings, "repayment-split")).toHaveLength(0);
    expect(result.notices.map((n) => n.code)).toContain("repayment-ambiguous");
  });

  it("evidence-only / Pattern B existing full transfer: a safe claim that writes nothing to Actual", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "separate-interest" });
    const counterpart = s.fake.seed({ account: ACCOUNTS.mortgage, date: "2024-02-01", amount: 242915, payee: s.fake.transferPayeeId(ACCOUNTS.checking) });
    const bank = s.seedPayment("2024-02-01", -242915, { transfer_id: counterpart });
    s.fake.row(counterpart)!.transfer_id = bank;
    const [claim] = byKind((await s.preview(window)).postings, "repayment-link");
    expect(claim).toMatchObject({ classification: "safe", output: expect.objectContaining({ kind: "claim" }) });
    const writes = s.fake.writes().length;
    expect((await s.apply(claim)).posting.status).toBe("applied");
    expect(s.fake.writes().length).toBe(writes);
  });
});
