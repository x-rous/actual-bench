import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { byKind, createScenario } from "../testing/postingScenario";
import { getLatestModelRevision, insertModelRevision } from "@/lib/app-db/modelRevisionRepository";
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

  it("a save that changes only bookkeeping (a new revision for the name, accounts or activation) keeps the applied splits as paid; a calculation change does not", async () => {
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
    expect(rerated.asPaidFrom).toBeNull();
  });
});
