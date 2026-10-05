import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { byKind, createScenario } from "../testing/postingScenario";
import { overrideRepaymentSplit } from "./postingWorkflowService";
import { reproducePosting } from "./reproduceService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
afterEach(() => resetAppDbForTests());

/** T291 (FR-069d): editing a proposed split's interest, through the real planner and transport. */
describe("editable split amounts (T291)", () => {
  const window = { from: "2024-02-01", to: "2024-03-31" };
  const interestOf = (p: { output: { kind: string } }) => (p.output as unknown as { operations: { economicKind: string; amountMinor: number }[] }).operations.find((c) => c.economicKind === "interest")!.amountMinor;
  const principalOf = (p: { output: { kind: string } }) => (p.output as unknown as { operations: { economicKind: string; amountMinor: number }[] }).operations.find((c) => c.economicKind === "principal")!.amountMinor;

  it("±1 minor unit needs no reason, more needs one; the edit is Review, keeps both values and survives a refresh", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-31");
    const [split] = byKind((await s.preview(window)).postings, "repayment-split");
    const calculated = -interestOf(split);
    expect(() => overrideRepaymentSplit(s.db, split.id, { interestMinor: calculated + 2 })).toThrow(/reason/);
    const edited = overrideRepaymentSplit(s.db, split.id, { interestMinor: calculated + 1 });
    expect(edited).toMatchObject({ classification: "review", status: "proposed" });
    expect(edited.reasons.map((r) => r.code)).toContain("edited-split");
    expect(-interestOf(edited)).toBe(calculated + 1);
    expect(principalOf(edited)).toBe(principalOf(split) + 1);
    expect((edited.output as { override?: unknown }).override).toEqual({ calculatedInterestMinor: calculated, interestMinor: calculated + 1, reason: null });
    const big = overrideRepaymentSplit(s.db, edited.id, { interestMinor: calculated + 500, reason: "Lender statement shows a higher figure" });
    expect((big.output as { override?: { calculatedInterestMinor: number } }).override?.calculatedInterestMinor).toBe(calculated);
    // A refresh plans the period again and keeps the user's value.
    const [again] = byKind((await s.preview(window)).postings, "repayment-split").filter((p) => p.periodKey === split.periodKey);
    expect(-interestOf(again)).toBe(calculated + 500);
    expect(again.reasons.find((r) => r.code === "edited-split")?.text).toMatch(/Lender statement shows a higher figure/);
    // Entering Bench's value again removes the edit.
    const reset = overrideRepaymentSplit(s.db, again.id, { interestMinor: calculated });
    expect((reset.output as { override?: unknown }).override).toBeUndefined();
    expect(reset.reasons.map((r) => r.code)).not.toContain("edited-split");
  });

  it("an edited split applies as edited, reproduces as 'matches your edit', and the next month builds on its principal", async () => {
    const plain = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    plain.seedPayment("2024-01-31");
    plain.seedPayment("2024-02-29");
    const plainSplits = byKind((await plain.preview(window)).postings, "repayment-split");
    const plainMarch = plainSplits.find((p) => p.periodKey === "2024-03-01")!;
    resetAppDbForTests();

    const s = createScenario({ mode: "http", apiRequestMock: apiRequest as jest.Mock, pattern: "embedded-interest" });
    s.seedPayment("2024-01-31");
    s.seedPayment("2024-02-29");
    const feb = byKind((await s.preview(window)).postings, "repayment-split").find((p) => p.periodKey === "2024-02-01")!;
    const calculated = -interestOf(feb);
    const edited = overrideRepaymentSplit(s.db, feb.id, { interestMinor: calculated + 5000, reason: "Lender charged more" });
    const applied = (await s.apply(edited)).posting;
    expect(applied.status).toBe("applied");
    const interestRow = s.fake.rows().find((r) => r.is_child && r.amount === -(calculated + 5000));
    expect(interestRow).toBeDefined();
    expect(reproducePosting(s.db, applied.id)).toMatchObject({ status: "exact-match", detail: expect.stringMatching(/matches your edit/) });
    // March starts from February's applied principal: 50.00 less principal paid, so a larger balance and more interest.
    const march = byKind((await s.preview(window)).postings, "repayment-split").find((p) => p.periodKey === "2024-03-01")!;
    expect(-interestOf(march)).toBeGreaterThan(-interestOf(plainMarch));
  });
});
