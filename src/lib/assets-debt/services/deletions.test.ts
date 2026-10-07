import { apiRequest } from "@/lib/api/client";
import { resetAppDbForTests } from "@/lib/app-db/connection";
import { listModelRevisions } from "@/lib/app-db/modelRevisionRepository";
import { insertDebtMatchRule, listDebtMatchRules } from "@/lib/app-db/debtMatchRuleRepository";
import { listDebtTransactionLinks } from "@/lib/app-db/debtTransactionLinkRepository";
import { ACCOUNTS, byKind, createScenario } from "../testing/postingScenario";
import { saveInput } from "../testing/debtFixtures";
import { readMatchingHistory } from "../actual/ledgerPort";
import { anchorDebtAtObservation } from "./anchorService";
import { archiveDebtConfiguration, createDebtConfiguration, deleteArchivedDebtPermanently, getDebtDetail } from "./debtConfigService";
import { listDebtPostings, previewDebtPostings } from "./proposalService";
import { approveAndRecordClaim } from "./postingWorkflowService";
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
  it.each(["direct", "http"] as const)("releases applied repayment claims for a recreated loan, but retains an archived loan's claims (%s)", async (mode) => {
    const s = createScenario({ mode, apiRequestMock: mockApiRequest, pattern: "embedded-interest" });
    const window = { from: "2024-02-01", to: "2024-04-30" };
    s.seedPayment("2024-02-01");
    s.seedPayment("2024-03-01");
    const [first] = byKind((await s.preview(window)).postings, "repayment-split");
    expect((await s.apply(first)).posting.status).toBe("applied");
    const old = getDebtDetail(s.db, s.debtId)!;
    if (!old.config.ok) throw new Error("Expected supported config");
    const config = old.config.config;
    const rules = listDebtMatchRules(s.db, s.debtId);
    const oldClaim = listDebtTransactionLinks(s.db, s.debtId).find((l) => l.role === "repayment")!;
    const recreate = () => {
      const detail = createDebtConfiguration(s.db, saveInput({
        lenderPattern: "embedded-interest", executionStrategy: "bench-daily",
        liabilityAccountId: ACCOUNTS.mortgage, paymentAccountId: ACCOUNTS.checking,
        loanPaymentCategoryId: old.debt.loanPaymentCategoryId, config,
      }), s.directory);
      for (const rule of rules) insertDebtMatchRule(s.db, detail.debt.id, {
        purpose: rule.purpose as "repayment", enabled: true, ruleFormatVersion: rule.ruleFormatVersion,
        conditionsJson: rule.conditionsJson, actionsJson: rule.actionsJson,
      });
      return detail;
    };
    const preview = async (id: string) => {
      const snapshots = await readMatchingHistory(s.transport, { accountIds: [ACCOUNTS.checking, ACCOUNTS.mortgage], from: "2024-01-01", to: window.to });
      const result = previewDebtPostings(s.db, id, { ...window, today: window.to, snapshots,
        accountDirectory: s.directory, transferPayees: s.transferPayees,
        capabilities: { canRestructure: true, canVerifyTransferLinks: true } });
      if (!result.ok) throw new Error("Expected preview");
      return result;
    };
    archiveDebtConfiguration(s.db, s.debtId);
    const competing = recreate();
    const [blockedClaim] = byKind((await preview(competing.debt.id)).postings, "repayment-split");
    expect(blockedClaim.output.kind).toBe("claim");
    const fresh = await s.fresh(blockedClaim);
    expect(() => approveAndRecordClaim(s.db, blockedClaim.id, { fresh, now: "2024-06-01T00:00:00Z" })).toThrow(/already claimed in this role/);
    expect(() => approveAndRecordClaim(s.db, blockedClaim.id, { fresh, now: "2024-06-01T00:00:00Z" })).toThrow(`The claim belongs to the loan ${JSON.stringify(old.debt.name)} (archived).`);
    expect(listDebtTransactionLinks(s.db, s.debtId)).toContainEqual(oldClaim);
    archiveDebtConfiguration(s.db, competing.debt.id);
    deleteArchivedDebtPermanently(s.db, competing.debt.id);
    const before = structuredClone(s.fake.rows());
    deleteArchivedDebtPermanently(s.db, s.debtId);
    expect(listDebtTransactionLinks(s.db, s.debtId)).toEqual([]);
    const replacement = recreate();
    const result = await preview(replacement.debt.id);
    expect(result.unscheduled).toEqual([]);
    const claims = listDebtTransactionLinks(s.db, replacement.debt.id).filter((l) => l.role === "repayment");
    expect(claims.map((l) => l.actualTransactionId)).toEqual([oldClaim.actualTransactionId]);
    expect(byKind(listDebtPostings(s.db, replacement.debt.id), "repayment-split").some((p) => p.status === "applied" && p.output.kind === "claim")).toBe(true);
    const next = await preview(replacement.debt.id);
    expect(next.paymentOptions.map((p) => p.id)).not.toContain(oldClaim.actualParentId);
    expect(listDebtTransactionLinks(s.db, replacement.debt.id).filter((l) => l.role === "repayment")).toEqual(claims);
    expect(s.fake.rows()).toEqual(before);
    // Recreate again with changed interest: this time recognition needs Review and explicit Apply,
    // which is where the owner saw the claim error (not the automatic no-write claim path).
    archiveDebtConfiguration(s.db, replacement.debt.id);
    deleteArchivedDebtPermanently(s.db, replacement.debt.id);
    const reviewed = recreate();
    const principal = s.fake.row(oldClaim.actualTransactionId)!;
    const interest = s.fake.rows().find((r) => r.parent_id === oldClaim.actualParentId && !r.transfer_id)!;
    s.fake.editInActual(principal.id as string, { amount: (principal.amount as number) + 500 });
    s.fake.editInActual(interest.id as string, { amount: (interest.amount as number) - 500 });
    const reviewRows = structuredClone(s.fake.rows());
    const [proposal] = byKind((await preview(reviewed.debt.id)).postings, "repayment-split");
    expect(proposal).toMatchObject({ classification: "review", output: { kind: "claim" } });
    const applied = approveAndRecordClaim(s.db, proposal.id, { fresh: await s.fresh(proposal), now: "2024-06-01T00:00:00Z" });
    expect(applied.status).toBe("applied");
    expect(listDebtTransactionLinks(s.db, reviewed.debt.id).filter((l) => l.role === "repayment").map((l) => l.actualTransactionId)).toEqual([oldClaim.actualTransactionId]);
    expect(s.fake.rows()).toEqual(reviewRows);
  });

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
