import type { MatchCandidate } from "@/lib/financial-models/matching";
import { classifyCombinedPayment } from "./combinedPayment";
import { classifyExistingStructure } from "./existingStructure";

const row = (patch: Partial<MatchCandidate> = {}): MatchCandidate => ({
  id: "txn",
  parentId: null,
  accountId: "cash",
  date: "2026-01-01",
  amountMinor: -100_000,
  payeeId: null,
  importedPayee: null,
  notes: null,
  categoryId: null,
  cleared: true,
  reconciled: false,
  transferId: null,
  isParent: false,
  isChild: false,
  benchMarked: false,
  postingLinked: false,
  ...patch,
});

describe("existing Actual transaction classification", () => {
  it.each([
    ["uncategorized", row(), "embedded-interest", "review", "uncategorized-existing-payment"],
    ["categorized", row({ categoryId: "old-category" }), "embedded-interest", "review", "user-category-would-be-replaced"],
    ["Pattern B transfer", row({ transferId: "other" }), "separate-interest", "safe", "existing-full-transfer"],
    ["Pattern A transfer", row({ transferId: "other" }), "embedded-interest", "review", "embedded-interest-transfer-needs-split"],
    ["manual split parent", row({ isParent: true }), "embedded-interest", "blocked", "split-parent-unclaimable"],
    ["specific split child", row({ isChild: true, parentId: "parent" }), "embedded-interest", "review", "existing-split-child"],
    ["missing Direct/HTTP child shape", row({ parentId: "parent", isChild: undefined }), "embedded-interest", "blocked", "missing-split-child-structure"],
  ] as const)("classifies %s", (...args) => {
    const [, candidate, lenderPattern, classification, reason] = args;
    expect(classifyExistingStructure({ candidate, lenderPattern, rowRole: "payment" })).toMatchObject({ classification, reasons: [reason] });
  });

  it("blocks reconciled rows without override and never uses a reconciled lender row as counterpart", () => {
    expect(classifyExistingStructure({ candidate: row({ reconciled: true }), lenderPattern: "embedded-interest", rowRole: "payment", overrideAmbiguity: true })).toMatchObject({
      classification: "blocked", disposition: "evidence-only", mayOverride: false, mayBeCounterpart: false,
    });
    expect(classifyExistingStructure({ candidate: row({ reconciled: true }), lenderPattern: "embedded-interest", rowRole: "lender-row" })).toMatchObject({
      reasons: ["reconciled-lender-row-never-counterpart"], mayBeCounterpart: false,
    });
  });

  it("permits only an explicit per-row ambiguity override", () => {
    expect(classifyExistingStructure({ candidate: row(), lenderPattern: "embedded-interest", rowRole: "payment", ambiguous: true }).classification).toBe("blocked");
    expect(classifyExistingStructure({ candidate: row(), lenderPattern: "embedded-interest", rowRole: "payment", ambiguous: true, overrideAmbiguity: true }).classification).toBe("review");
  });
});

describe("combined payments", () => {
  it("claims distinct split children without claiming their parent", () => {
    expect(classifyCombinedPayment({
      transactionId: "parent", amountMinor: -100_000, isSplitParent: true, debtIds: ["a", "b"],
      children: [
        { transactionId: "child-a", amountMinor: -60_000, debtIds: ["a"] },
        { transactionId: "child-b", amountMinor: -40_000, debtIds: ["b"] },
      ],
    })).toEqual({
      classification: "single",
      claims: [{ transactionId: "child-a", debtId: "a" }, { transactionId: "child-b", debtId: "b" }],
      reasons: ["claim-specific-split-children"],
    });
  });

  it("requires Review for an explicitly reconciling unsplit multi-debt row and otherwise blocks", () => {
    const candidate = { transactionId: "one-row", amountMinor: -100_000, isSplitParent: false, debtIds: ["a", "b"] };
    expect(classifyCombinedPayment(candidate, [{ debtId: "a", amountMinor: 60_000 }, { debtId: "b", amountMinor: 40_000 }])).toMatchObject({ classification: "review", claims: [] });
    expect(classifyCombinedPayment(candidate, [{ debtId: "a", amountMinor: 50_000 }, { debtId: "b", amountMinor: 40_000 }])).toMatchObject({ classification: "blocked", claims: [] });
  });
});
