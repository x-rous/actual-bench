import { resetAppDbForTests } from "@/lib/app-db/connection";
import { getDebt, insertDebt, setDebtDriftAcceptedRevision } from "@/lib/app-db/debtRepository";
import { insertDebtObservation, listCurrentDebtObservations, listDebtObservationHistory } from "@/lib/app-db/debtObservationRepository";
import { getEffectiveDebtAnchor, insertDebtAnchor, listDebtAnchors } from "@/lib/app-db/debtAnchorRepository";
import { listDebtOffsetLinks, replaceDebtOffsetLinks } from "@/lib/app-db/debtOffsetLinkRepository";
import { tempDebtDb } from "../testing/debtFixtures";
import { compareDebtBalances, debtDriftState } from "../classification/drift";
import { reconciliationHealth } from "./health";
import type { SqliteDatabase } from "@/lib/app-db/types";

let db: SqliteDatabase;
beforeEach(() => { db = tempDebtDb(); });
afterEach(() => resetAppDbForTests());

function debt() {
  return insertDebt(db, {
    budgetSyncId: "budget", name: "Loan", debtType: "mortgage", behaviorClass: "term-loan",
    currency: "AED", currencyMinorDigits: 2, liabilityAccountId: "loan", paymentAccountId: "cash",
    signConvention: "negative-is-debt", lenderPattern: "embedded-interest", executionStrategy: "bench-daily",
    lenderChargeGraceDays: 3, onboardingDate: null, loanPaymentCategoryId: null, drawCategoryId: null,
    expectedObservationIntervalDays: 30, currentConfigJson: "{}", status: "active", currentRevision: 2,
  }, "2026-01-01T00:00:00.000Z");
}

describe("RD-084 P1.5 evidence persistence", () => {
  it("upgrades offsets with Actual tracking off and persists an explicit opt-in", () => {
    const d = debt();
    replaceDebtOffsetLinks(db, d.id, [{ actualAccountId: "offset", effectiveFrom: "2026-01-01", effectiveTo: null, offsetPercentageBps: 10_000, balanceBasis: "total", capMinor: null }]);
    expect(listDebtOffsetLinks(db, d.id)[0].useActualBalance).toBe(false);
    replaceDebtOffsetLinks(db, d.id, [{ actualAccountId: "offset", effectiveFrom: "2026-01-01", effectiveTo: null, offsetPercentageBps: 10_000, balanceBasis: "total", capMinor: null, useActualBalance: true }]);
    expect(listDebtOffsetLinks(db, d.id)[0].useActualBalance).toBe(true);
  });

  it("keeps corrections and anchors append-only", () => {
    const d = debt();
    const first = insertDebtObservation(db, { debtId: d.id, observedOn: "2026-02-01", recordedAt: "2026-02-02T00:00:00Z", principalMinor: 99_000, accruedInterestMinor: 100, source: "manual-statement", supersedesObservationId: null, note: null }, "2026-02-02T00:00:00Z");
    const correction = insertDebtObservation(db, { debtId: d.id, observedOn: "2026-02-01", recordedAt: "2026-02-03T00:00:00Z", principalMinor: 98_900, accruedInterestMinor: 100, source: "manual-statement", supersedesObservationId: first.id, note: "corrected" }, "2026-02-03T00:00:00Z");
    expect(listCurrentDebtObservations(db, d.id).map((row) => row.id)).toEqual([correction.id]);
    expect(listDebtObservationHistory(db, d.id)).toHaveLength(2);
    insertDebtAnchor(db, { debtId: d.id, anchorDate: "2026-02-01", principalMinor: 99_000, accruedInterestMinor: 100, carriedRemainderDecimal: null, source: "first", observationKind: "manual-statement", observationId: first.id, configRevision: 2 }, "2026-02-02T00:00:00Z");
    const latest = insertDebtAnchor(db, { debtId: d.id, anchorDate: "2026-02-01", principalMinor: 98_900, accruedInterestMinor: 100, carriedRemainderDecimal: "0.004", source: "correction", observationKind: "manual-statement", observationId: correction.id, configRevision: 2 }, "2026-02-03T00:00:00Z");
    expect(getEffectiveDebtAnchor(db, d.id)?.id).toBe(latest.id);
    expect(listDebtAnchors(db, d.id)).toHaveLength(2);
  });

  it("persists the exact accepted comparison alongside its revision", () => {
    const d = debt();
    setDebtDriftAcceptedRevision(db, d.id, 2, "comparison-v1", "2026-02-01T00:00:00Z");
    expect(getDebt(db, d.id)).toMatchObject({ driftAcceptedRevision: 2, driftAcceptedFingerprint: "comparison-v1" });
    expect(() => setDebtDriftAcceptedRevision(db, d.id, 2, null)).toThrow(/both a revision and comparison fingerprint/);
  });
});

describe("RD-084 P1.5 drift and health", () => {
  it("keeps all three differences on the same date and invalidates acceptance when evidence changes", () => {
    const comparison = compareDebtBalances({ comparisonDate: "2026-02-01", modelMinor: 100_000, actualMinor: 99_500, lenderMinor: 99_600 });
    expect(comparison).toMatchObject({ modelVsActualMinor: 500, modelVsLenderMinor: 400, actualVsLenderMinor: -100 });
    expect(debtDriftState({ comparison, toleranceMinor: 100, currentRevision: 2, acceptedRevision: 2, acceptedFingerprint: "old", currentFingerprint: "new" })).toBe("material");
    expect(debtDriftState({ comparison, toleranceMinor: 100, currentRevision: 2, acceptedRevision: 2, acceptedFingerprint: "same", currentFingerprint: "same" })).toBe("accepted");
  });

  it("only reports overdue when an interval is configured", () => {
    expect(reconciliationHealth({ expectedIntervalDays: null, graceDays: 3, latestObservationDate: "2026-01-01", asOfDate: "2027-01-01" })).toEqual({ overdue: false, dueDate: null });
    expect(reconciliationHealth({ expectedIntervalDays: 30, graceDays: 3, latestObservationDate: "2026-01-01", asOfDate: "2026-02-04" })).toEqual({ overdue: true, dueDate: "2026-02-03" });
  });
});
