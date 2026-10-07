import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listModelRevisions } from "@/lib/app-db/modelRevisionRepository";
import { byKind, createScenario } from "../testing/postingScenario";
import { anchorDebtAtObservation } from "./anchorService";
import { archiveDebtConfiguration, deleteArchivedDebtPermanently, getDebtDetail } from "./debtConfigService";
import { currentDebtObservations, debtObservationHistory, recordManualDebtObservation, removeDebtObservation } from "./observationService";

jest.mock("@/lib/api/client", () => ({ apiRequest: jest.fn() }));
const mockApiRequest = apiRequest as unknown as jest.Mock;
afterEach(() => resetAppDbForTests());

const statement = (s: ReturnType<typeof createScenario>, observedOn: string, principalMinor: number, supersedesObservationId: string | null = null) =>
  recordManualDebtObservation(s.db, { debtId: s.debtId, observedOn, recordedAt: `${observedOn}T00:00:00Z`, principalMinor, accruedInterestMinor: null, note: null, supersedesObservationId }, `${observedOn}T00:00:00Z`);

describe("removing a lender statement (owner decision 2026-10-05)", () => {
  it("removes the statement with its corrections and any restart made from it; other statements stay", () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
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
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    expect(() => removeDebtObservation(s.db, s.debtId, "not-a-statement")).toThrow(/does not belong to this loan/);
  });
});

describe("deleting a loan permanently (owner decision 2026-10-05)", () => {
  it("only an archived loan; then everything Bench stored for it is gone", async () => {
    const s = createScenario({ mode: "http", apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    s.seedPayment("2024-02-01");
    const [split] = byKind((await s.preview({ from: "2024-02-01", to: "2024-02-29" })).postings, "repayment-split");
    const applied = (await s.apply(split)).posting;
    s.undo(applied);
    const first = statement(s, "2024-02-15", 38_500_000);
    const fixed = statement(s, "2024-02-15", 38_400_000, first.id);
    anchorDebtAtObservation(s.db, s.debtId, fixed.id);
    expect(() => deleteArchivedDebtPermanently(s.db, s.debtId)).toThrow(/Archive the loan/);
    archiveDebtConfiguration(s.db, s.debtId);
    deleteArchivedDebtPermanently(s.db, s.debtId);
    expect(getDebtDetail(s.db, s.debtId)).toBeNull();
    for (const table of ["debt_observations", "debt_anchors", "debt_transaction_links", "debt_match_rules", "debt_rate_periods"]) {
      expect(s.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE debt_id = ?`).get<{ n: number }>(s.debtId)?.n).toBe(0);
    }
    expect(s.db.prepare("SELECT COUNT(*) AS n FROM financial_postings WHERE subject_id = ?").get<{ n: number }>(s.debtId)?.n).toBe(0);
    expect(listModelRevisions(s.db, "debt", s.debtId)).toEqual([]);
  });
});
