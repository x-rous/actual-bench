import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listModelRevisions } from "@/lib/app-db/modelRevisionRepository";
import type { SqliteDatabase } from "@/lib/app-db/types";
import { finishDebtWrite, saveLedgerEntries, savePaymentRule, startDebtWrite } from "@/lib/app-db/debtTrackingRepository";
import { directory, saveInput, tempDebtDb } from "../testing/debtFixtures";
import { anchorDebtAtObservation } from "./anchorService";
import { archiveDebtConfiguration, createDebtConfiguration, deleteArchivedDebtPermanently, getDebtDetail } from "./debtConfigService";
import { currentDebtObservations, debtObservationHistory, recordManualDebtObservation, removeDebtObservation } from "./observationService";

afterEach(() => resetAppDbForTests());

function loan() {
  const db = tempDebtDb();
  const { debt } = createDebtConfiguration(db, saveInput(), directory(), "2024-01-01T00:00:00.000Z");
  return { db, debtId: debt.id };
}

const statement = (s: { db: SqliteDatabase; debtId: string }, observedOn: string, principalMinor: number, supersedesObservationId: string | null = null) =>
  recordManualDebtObservation(s.db, { debtId: s.debtId, observedOn, recordedAt: `${observedOn}T00:00:00Z`, principalMinor, accruedInterestMinor: null, note: null, supersedesObservationId }, `${observedOn}T00:00:00Z`);

describe("removing a lender statement (owner decision 2026-10-05)", () => {
  it("removes the statement with its corrections and any restart made from it; other statements stay", () => {
    const s = loan();
    const keep = statement(s, "2024-01-15", 39_000_000);
    const original = statement(s, "2024-02-15", 38_500_000);
    const corrected = statement(s, "2024-02-15", 38_400_000, original.id);
    anchorDebtAtObservation(s.db, s.debtId, corrected.id);
    expect(removeDebtObservation(s.db, s.debtId, corrected.id)).toEqual({ statements: 2, restarts: 1 });
    expect(debtObservationHistory(s.db, s.debtId).map((o) => o.id)).toEqual([keep.id]);
    expect(currentDebtObservations(s.db, s.debtId).map((o) => o.id)).toEqual([keep.id]);
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM debt_anchors WHERE debt_id = ?").get<{ n: number }>(s.debtId)?.n).toBe(0);
  });

  it("refuses a statement of another loan", () => {
    const s = loan();
    expect(() => removeDebtObservation(s.db, s.debtId, "not-a-statement")).toThrow(/does not belong to this loan/);
  });
});

describe("deleting a loan permanently (owner decision 2026-10-05)", () => {
  it("only an archived loan; then everything Bench stored for it is gone", () => {
    const s = loan();
    const first = statement(s, "2024-02-15", 38_500_000);
    const fixed = statement(s, "2024-02-15", 38_400_000, first.id);
    anchorDebtAtObservation(s.db, s.debtId, fixed.id);
    saveLedgerEntries(s.db, s.debtId, [{ actualTransactionId: "t1", actualAccountId: "acc-mortgage", entryType: "extra-principal", revision: 0 }]);
    savePaymentRule(s.db, s.debtId, { kind: "save", rule: { name: "Lender", match: "all", conditions: [{ field: "payee", operator: "equals", value: "p-lender" }] } });
    const write = startDebtWrite(s.db, s.debtId, { kind: "split", installmentDueDate: "2024-02-01", targetIds: ["p1"], before: {}, after: {} });
    expect(() => archiveDebtConfiguration(s.db, s.debtId)).toThrow();
    finishDebtWrite(s.db, s.debtId, write.id, { status: "applied" });
    expect(() => deleteArchivedDebtPermanently(s.db, s.debtId)).toThrow(/Archive the loan/);
    archiveDebtConfiguration(s.db, s.debtId);
    deleteArchivedDebtPermanently(s.db, s.debtId);
    expect(getDebtDetail(s.db, s.debtId)).toBeNull();
    for (const table of ["debt_observations", "debt_anchors", "debt_rate_periods", "debt_ledger_entries", "debt_payment_rules", "debt_writes"]) {
      expect(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE debt_id = ?`).get<{ n: number }>(s.debtId)?.n).toBe(0);
    }
    expect(listModelRevisions(s.db, "debt", s.debtId)).toEqual([]);
  });
});
