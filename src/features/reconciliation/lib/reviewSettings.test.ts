import { DEFAULT_APPLY_CONFIG } from "@/lib/reconciliation/session/plan";
import { applyConfigAfterLeavingReview } from "./reviewSettings";

describe("reconciliation review settings", () => {
  it("restores matched-row bank text when an unapplied review returns to Reconcile", () => {
    const config = {
      ...DEFAULT_APPLY_CONFIG,
      clearedTarget: "reconciled" as const,
      enrichImportedPayee: false,
    };

    expect(applyConfigAfterLeavingReview(config, false)).toEqual({
      ...config,
      enrichImportedPayee: true,
    });
  });

  it("preserves the executed choice for an applied reconciliation", () => {
    const config = {
      ...DEFAULT_APPLY_CONFIG,
      enrichImportedPayee: false,
    };

    expect(applyConfigAfterLeavingReview(config, true)).toBe(config);
  });

  it("returns the same config when the enrichment choice is already the default", () => {
    const config = { ...DEFAULT_APPLY_CONFIG, clearedTarget: "created" as const };

    expect(applyConfigAfterLeavingReview(config, false)).toBe(config);
  });
});
