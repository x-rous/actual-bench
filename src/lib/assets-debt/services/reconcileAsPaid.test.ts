import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { byKind, createScenario } from "../testing/postingScenario";
import { getLatestModelRevision, insertModelRevision } from "@/lib/app-db/modelRevisionRepository";
import { saveBaselineAssumptions } from "./debtConfigService";
import { reconcileDebt } from "./reconciliationService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

/** T309: "Calculated" follows the repayments as paid; the scheduled figure stays alongside. */
describe("calculated as paid", () => {
  it("before any applied split it is the schedule; after one it starts from that split's closing balance", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const before = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!before.ok) throw new Error("reconcile");
    expect(before.asPaidFrom).toBeNull();
    expect(before.comparison.modelMinor).toBe(before.scheduledMinor);

    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure" || !split.output.closing) throw new Error("closing");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const after = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!after.ok) throw new Error("reconcile");
    expect(after.asPaidFrom).toBe(split.output.closing.date);
    expect(after.comparison.modelMinor).toBe(split.output.closing.principalMinor);
    expect(after.scheduledMinor).toBe(before.scheduledMinor);

    // A month on, exactly one more scheduled repayment counts (the early one is not scheduled again).
    const later = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-03-15", actualBalanceMinor: 0 });
    if (!later.ok) throw new Error("reconcile");
    const oneScheduledPrincipal = before.scheduledMinor - later.scheduledMinor;
    const asPaidStep = split.output.closing.principalMinor - (later.comparison.modelMinor ?? 0);
    expect(asPaidStep).toBeGreaterThan(oneScheduledPrincipal * 0.5);
    expect(asPaidStep).toBeLessThan(oneScheduledPrincipal * 1.5);
  });

  it("a new revision (bookkeeping or a calculation change) keeps the repayments applied in Actual as paid: they are facts", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const latest = getLatestModelRevision(s.db, "debt", s.debtId)!;
    const snapshot = JSON.parse(latest.configJson) as { debt: Record<string, unknown>; rates: Array<Record<string, unknown>> };
    const bump = (next: unknown, revision: number) => {
      insertModelRevision(s.db, { subjectKind: "debt", subjectId: s.debtId, revision, configFormat: latest.configFormat, configVersion: latest.configVersion, snapshot: next, changeSummary: "test" });
      s.db.prepare("UPDATE debts SET current_revision = ? WHERE id = ?").run(revision, s.debtId);
    };
    bump({ ...snapshot, debt: { ...snapshot.debt, name: "Renamed" } }, latest.revision + 1);
    const renamed = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!renamed.ok) throw new Error("reconcile");
    expect(renamed.asPaidFrom).not.toBeNull();
    bump({ ...snapshot, rates: snapshot.rates.map((r) => ({ ...r, annualRateDecimal: "0.09" })) }, latest.revision + 2);
    const rerated = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!rerated.ok) throw new Error("reconcile");
    expect(rerated.asPaidFrom).not.toBeNull();
  });
});

describe("an extra payment added after the last applied repayment", () => {
  it("keeps the calculation as paid and takes the extra payment off the balance", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure" || !split.output.closing) throw new Error("closing");
    expect((await s.apply(split)).posting.status).toBe("applied");
    saveBaselineAssumptions(s.db, s.debtId, [{ kind: "extra-repayment", effectiveFrom: "2024-02-10", recurrence: null, amountMinor: 2_000_000, feeTreatment: null, offsetAccountId: null, note: "Extra payment" }], "Extra payment made");
    const after = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!after.ok) throw new Error("reconcile");
    expect(after.asPaidFrom).toBe(split.output.closing.date);
    expect(after.comparison.modelMinor).toBe(split.output.closing.principalMinor - 2_000_000);
  });
});

describe("an extra payment made between a repayment and its due date", () => {
  it("is taken off the balance both before and after that due date", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    if (split.output.kind !== "restructure" || !split.output.closing) throw new Error("closing");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const before = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!before.ok) throw new Error("reconcile");
    saveBaselineAssumptions(s.db, s.debtId, [{ kind: "extra-repayment", effectiveFrom: "2024-01-30", recurrence: null, amountMinor: 2_000_000, feeTreatment: null, offsetAccountId: null, note: null }], "Extra payment made");
    const early = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-01-31", actualBalanceMinor: 0 });
    const after = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!early.ok || !after.ok) throw new Error("reconcile");
    expect(early.comparison.modelMinor).toBe(split.output.closing.principalMinor - 2_000_000);
    expect(after.asPaidFrom).toBe(split.output.closing.date);
    expect(after.comparison.modelMinor).toBe((before.comparison.modelMinor ?? 0) - 2_000_000);
  });
});

describe("an extra payment dated before a repayment that was applied later", () => {
  it("still comes off the balance (the owner's Sep 4 extra payment before the Sep 25 repayment)", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-01-29");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    expect((await s.apply(split)).posting.status).toBe("applied");
    const before = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    saveBaselineAssumptions(s.db, s.debtId, [{ kind: "extra-repayment", effectiveFrom: "2024-01-10", recurrence: null, amountMinor: 2_000_000, feeTreatment: null, offsetAccountId: null, note: null }], "Extra payment made earlier");
    const after = reconcileDebt(s.db, { debtId: s.debtId, comparisonDate: "2024-02-15", actualBalanceMinor: 0 });
    if (!before.ok || !after.ok) throw new Error("reconcile");
    expect(after.asPaidFrom).toBe("2024-01-29");
    expect(after.comparison.modelMinor).toBe((before.comparison.modelMinor ?? 0) - 2_000_000);
  });
});

