import { resetAppDbForTests } from "./connection";
import {
  beginApplyingPosting,
  decidePosting,
  getFinancialPosting,
  listSubjectPostings,
  markPostingApplied,
  markPostingFailed,
  markPostingIndeterminate,
  markPostingReversed,
  nextPostingGeneration,
  pruneSupersededProposals,
  reproposeIndeterminatePosting,
  supersedePosting,
  upsertProposal,
  type ProposalInput,
} from "./financialPostingRepository";
import type { SqliteDatabase } from "./types";
import { tempDebtDb } from "@/lib/assets-debt/testing/debtFixtures";

let db: SqliteDatabase;
beforeEach(() => {
  db = tempDebtDb();
});
afterEach(() => resetAppDbForTests());

const T0 = "2026-07-01T00:00:00.000Z";

function proposal(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    budgetSyncId: "budget-1", subjectKind: "debt", subjectId: "debt-1", postingKind: "interest-charge", periodKey: "2026-06-30",
    generation: 1, configRevision: 1, inputFormatVersion: 1, inputSnapshot: { period: "2026-06-30", openingMinor: 40_000_000 },
    engineVersions: { projection: "projection@2" }, outputSnapshot: { kind: "create", operations: [{ amountMinor: -123456 }] },
    classification: "safe", reasons: [{ code: "deterministic-charge", text: "Deterministic charge with unchanged inputs." }],
    idempotencyMarker: "abdebt:budget-1:debt-1:interest-charge:2026-06-30:g1", ...overrides,
  };
}

describe("financial posting repository (T113)", () => {
  it("reuses an unchanged undecided proposal and supersedes a changed one (A-3)", () => {
    const first = upsertProposal(db, proposal(), T0);
    const again = upsertProposal(db, proposal(), T0);
    expect(again).toMatchObject({ reused: true, posting: { id: first.posting.id } });
    const changed = upsertProposal(db, proposal({ inputSnapshot: { period: "2026-06-30", openingMinor: 39_000_000 } }), T0);
    expect(changed.reused).toBe(false);
    expect(getFinancialPosting(db, first.posting.id)?.status).toBe("superseded");
    expect(getFinancialPosting(db, changed.posting.id)?.status).toBe("proposed");
  });

  it("only the user's decision reaches approved or declined, always with decided_at", () => {
    const { posting } = upsertProposal(db, proposal(), T0);
    expect(() => beginApplyingPosting(db, posting.id)).toThrow(/approved/);
    const approved = decidePosting(db, posting.id, "approved", "2026-07-02T10:00:00.000Z");
    expect(approved).toMatchObject({ status: "approved", decidedAt: "2026-07-02T10:00:00.000Z" });
    expect(beginApplyingPosting(db, posting.id).status).toBe("applying");
    const other = upsertProposal(db, proposal({ periodKey: "2026-07-31", idempotencyMarker: "abdebt:budget-1:debt-1:interest-charge:2026-07-31:g1" }), T0).posting;
    expect(decidePosting(db, other.id, "declined", "2026-07-02T10:00:00.000Z")).toMatchObject({ status: "declined", decidedAt: expect.any(String) });
    expect(() => decidePosting(db, other.id, "approved", "2026-07-02T10:00:00.000Z")).toThrow(/declined posting cannot become approved/);
  });

  it("a blocked proposal can never be approved", () => {
    const { posting } = upsertProposal(db, proposal({ classification: "blocked", reasons: [{ code: "missing-category", text: "Choose an interest category for this debt." }] }), T0);
    expect(() => decidePosting(db, posting.id, "approved", T0)).toThrow(/blocked/);
  });

  it("requires plain-language reasons for Review and Blocked (SC-011) and refuses floating-point money", () => {
    expect(() => upsertProposal(db, proposal({ classification: "review", reasons: [] }), T0)).toThrow(/must say why/);
    expect(() => upsertProposal(db, proposal({ outputSnapshot: { amountMinor: 12.5 } }), T0)).toThrow();
  });

  it("the database itself refuses a decided status without decided_at, and any snapshot rewrite", () => {
    const { posting } = upsertProposal(db, proposal(), T0);
    expect(() => db.prepare("UPDATE financial_postings SET status = 'approved' WHERE id = ?").run(posting.id)).toThrow(/CHECK constraint/);
    expect(() => db.prepare("UPDATE financial_postings SET output_snapshot_json = '{}' WHERE id = ?").run(posting.id)).toThrow(/immutable/);
  });

  it("moves through applying to applied, failed or indeterminate; indeterminate resolves by recovery or re-proposal with Review", () => {
    const a = upsertProposal(db, proposal(), T0).posting;
    decidePosting(db, a.id, "approved", T0);
    beginApplyingPosting(db, a.id, T0);
    expect(markPostingApplied(db, a.id, { actualIds: ["txn-1"], appliedAt: T0 })).toMatchObject({ status: "applied", actualIds: ["txn-1"] });

    const b = upsertProposal(db, proposal({ periodKey: "2026-07-31", idempotencyMarker: "m-b" }), T0).posting;
    decidePosting(db, b.id, "approved", T0);
    beginApplyingPosting(db, b.id, T0);
    expect(markPostingFailed(db, b.id, { stage: "verify" }).status).toBe("failed");

    const c = upsertProposal(db, proposal({ periodKey: "2026-08-31", idempotencyMarker: "m-c" }), T0).posting;
    decidePosting(db, c.id, "approved", T0);
    beginApplyingPosting(db, c.id, T0);
    markPostingIndeterminate(db, c.id, { stage: "create" });
    const reproposed = reproposeIndeterminatePosting(db, c.id, { code: "write-not-found", text: "The interrupted write is not in Actual." });
    expect(reproposed).toMatchObject({ status: "proposed", classification: "review", decidedAt: null });
    expect(reproposed.reasons.map((r) => r.code)).toContain("write-not-found");
  });

  it("allows one live posting per period, and a new generation only after a reversal (S10)", () => {
    const key = { subjectKind: "debt" as const, subjectId: "debt-1", postingKind: "interest-charge" as const, periodKey: "2026-06-30" };
    const g1 = upsertProposal(db, proposal(), T0).posting;
    decidePosting(db, g1.id, "approved", T0);
    beginApplyingPosting(db, g1.id, T0);
    markPostingApplied(db, g1.id, { actualIds: ["txn-1"], appliedAt: T0 });
    expect(nextPostingGeneration(db, key)).toBe(1);
    const duplicate = upsertProposal(db, proposal({ inputSnapshot: { other: 1 } }), T0).posting;
    decidePosting(db, duplicate.id, "approved", T0);
    expect(() => beginApplyingPosting(db, duplicate.id, T0)).toThrow();
    markPostingReversed(db, g1.id, T0);
    expect(nextPostingGeneration(db, key)).toBe(2);
  });

  it("prunes only superseded, never-decided proposals older than 90 days", () => {
    const old = upsertProposal(db, proposal(), "2026-01-01T00:00:00.000Z").posting;
    supersedePosting(db, old.id, "2026-01-02T00:00:00.000Z");
    const decided = upsertProposal(db, proposal({ periodKey: "2026-05-31", idempotencyMarker: "m-d" }), "2026-01-01T00:00:00.000Z").posting;
    decidePosting(db, decided.id, "declined", "2026-01-02T00:00:00.000Z");
    const recent = upsertProposal(db, proposal({ periodKey: "2026-06-29", idempotencyMarker: "m-r" }), "2026-06-28T00:00:00.000Z").posting;
    supersedePosting(db, recent.id, "2026-06-28T00:00:00.000Z");
    expect(pruneSupersededProposals(db, new Date("2026-07-01T00:00:00.000Z"))).toBe(1);
    expect(listSubjectPostings(db, "debt", "debt-1").map((p) => p.id).sort()).toEqual([decided.id, recent.id].sort());
  });
});

