import { POSTING_KINDS } from "@/lib/app-db/types";
import { classificationLabel, classifyPosting, REASONS, SAFE_ELIGIBLE, UI_LABELS, type PostingShape } from "./policy";

describe("classification policy (T116; FR-170a–FR-172, D1, SC-011)", () => {
  it("the safe set is exactly FR-170a; changing it needs a specification change", () => {
    expect(SAFE_ELIGIBLE).toEqual([
      { postingKind: "interest-charge", shape: "create" },
      { postingKind: "fee-charge", shape: "create" },
      { postingKind: "repayment-link", shape: "claim" },
      { postingKind: "interest-link", shape: "claim" },
    ]);
  });

  it("persisted values stay safe | review | blocked; the UI labels are the approved ones with plain hyphens (D3)", () => {
    expect(UI_LABELS).toEqual({
      safe: "Recommended - apply with one click",
      review: "Review before applying",
      blocked: "Cannot apply - resolve in Actual first",
    });
    for (const label of Object.values(UI_LABELS)) expect(label).not.toMatch(/—/);
    expect(classificationLabel({ unknown: "future" })).toBe(UI_LABELS.blocked);
  });

  it("safety net (replaces G3): safe is never produced for restructures, counterpart links, splits, opening or reconciliation adjustments, unreviewed principal changes, or material drift", () => {
    const shapes: PostingShape[] = ["create", "restructure", "link", "claim"];
    for (const postingKind of POSTING_KINDS) {
      for (const shape of shapes) {
        for (const driftMaterial of [false, true]) {
          for (const unreviewedPrincipalChange of [false, true]) {
            const result = classifyPosting({ postingKind, shape, driftMaterial, unreviewedPrincipalChange });
            const forbidden = shape === "restructure" || shape === "link" || postingKind === "repayment-split" || postingKind === "receivable-split"
              || postingKind === "opening-adjustment" || postingKind === "reconciliation-adjustment" || driftMaterial || unreviewedPrincipalChange;
            if (forbidden) expect({ postingKind, shape, driftMaterial, unreviewedPrincipalChange, classification: result.classification }).not.toMatchObject({ classification: "safe" });
          }
        }
      }
    }
  });

  it("D1: reconciliation adjustments are always review (or blocked), never safe", () => {
    expect(classifyPosting({ postingKind: "reconciliation-adjustment", shape: "create", driftMaterial: false }).classification).toBe("review");
    expect(classifyPosting({ postingKind: "reconciliation-adjustment", shape: "claim", driftMaterial: false }).classification).toBe("review");
  });

  it("a Bench-created charge with unchanged inputs and no drift is safe, and still only advisory", () => {
    expect(classifyPosting({ postingKind: "interest-charge", shape: "create", driftMaterial: false })).toEqual({ classification: "safe", reasons: [REASONS.deterministicCharge] });
  });

  it("any blocker blocks; every Review and Blocked result carries plain-language text (SC-011)", () => {
    const blocked = classifyPosting({ postingKind: "interest-charge", shape: "create", driftMaterial: false, blockers: [REASONS.reconciledRow] });
    expect(blocked).toEqual({ classification: "blocked", reasons: [REASONS.reconciledRow] });
    for (const postingKind of POSTING_KINDS) {
      const result = classifyPosting({ postingKind, shape: "restructure", driftMaterial: true });
      expect(result.reasons.length).toBeGreaterThan(0);
      for (const reason of result.reasons) expect(reason.text.trim().length).toBeGreaterThan(10);
    }
    expect(REASONS.reconciledRow.text).toBe("The matched row is reconciled in Actual. Resolve in Actual, then re-run.");
    expect(REASONS.missingLoanPaymentCategory.text).toBe("Choose a loan payment category for this debt.");
  });
});
