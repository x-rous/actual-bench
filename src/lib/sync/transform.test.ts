import { buildPlanConfig } from "./flowConfig";
import { buildPlannedTargetPayload, transformAmount, transformNotes } from "./transform";
import type { SyncSourceItem } from "./sourceItems";

const config = buildPlanConfig({
  flowId: "flow-1",
  targetAccountId: "acct-tgt",
  sourceBudgetName: "Home",
  sourceAccountName: "Checking",
});

function item(overrides: Partial<SyncSourceItem> = {}): SyncSourceItem {
  return {
    kind: "transaction",
    itemKey: "txn:t1",
    sourceTransactionId: "t1",
    sourceSplitId: null,
    usedFallbackKey: false,
    fingerprint: "fp",
    date: "2026-07-01",
    amount: -1250,
    payeeId: "p1",
    payeeName: "Coffee Bar",
    categoryId: "c1",
    categoryName: "Dining",
    notes: "flat white",
    cleared: true,
    reconciled: false,
    importedId: null,
    ...overrides,
  };
}

describe("transformAmount", () => {
  it("reverses sign by default", () => {
    expect(transformAmount(-1250, "reverse")).toBe(1250);
    expect(transformAmount(1250, "reverse")).toBe(-1250);
  });

  it("keeps sign when configured same", () => {
    expect(transformAmount(-1250, "same")).toBe(-1250);
  });
});

describe("transformNotes", () => {
  it("copies source notes and appends the visible marker by default", () => {
    expect(transformNotes("flat white", config)).toBe("flat white [Synced from Home / Checking]");
  });

  it("uses the marker alone when there are no source notes", () => {
    expect(transformNotes(null, config)).toBe("[Synced from Home / Checking]");
  });

  it("omits the marker when disabled and keeps only copied notes", () => {
    const noMarker = buildPlanConfig({
      flowId: "f",
      sourceBudgetName: "Home",
      sourceAccountName: "Checking",
      notesMarkerEnabled: false,
    });
    expect(transformNotes("flat white", noMarker)).toBe("flat white");
    expect(transformNotes(null, noMarker)).toBeNull();
  });

  it("does not copy source notes when copySourceNotes is false", () => {
    const markerOnly = buildPlanConfig({
      flowId: "f",
      sourceBudgetName: "Home",
      sourceAccountName: "Checking",
      copySourceNotes: false,
    });
    expect(transformNotes("flat white", markerOnly)).toBe("[Synced from Home / Checking]");
  });
});

describe("buildPlannedTargetPayload", () => {
  it("assembles a reversed, marker-tagged, uncleared payload", () => {
    const payload = buildPlannedTargetPayload({
      item: item(),
      config,
      payee: { payeeId: "tp1", payeeName: null, willCreateOnApply: false, leftEmpty: false },
      category: { categoryId: "tc1", leftEmpty: false },
      importedId: "absync:flow-1:txn:t1",
    });

    expect(payload).toEqual({
      accountId: "acct-tgt",
      date: "2026-07-01",
      amount: 1250,
      payeeId: "tp1",
      payeeName: null,
      categoryId: "tc1",
      notes: "flat white [Synced from Home / Checking]",
      cleared: false,
      importedId: "absync:flow-1:txn:t1",
      subtransactions: null,
      fx: null,
    });
  });

  it("converts the amount, stamps an FX note, and carries provenance when a rate is given", () => {
    const payload = buildPlannedTargetPayload({
      item: item({ amount: -1000 }),
      config: { ...config, fxSourceCurrency: "AED", fxTargetCurrency: "AUD" },
      payee: { payeeId: "tp1", payeeName: null, willCreateOnApply: false, leftEmpty: false },
      category: { categoryId: "tc1", leftEmpty: false },
      importedId: "m",
      fx: { rate: "0.4", effectiveDate: "2026-07-01", source: "frankfurter", provider: "frankfurter", fxRateId: "fx-1" },
    });
    // reverse(-1000)=1000, ×0.4 = 400.
    expect(payload.amount).toBe(400);
    expect(payload.notes).toContain("AED -10.00 @ 0.4");
    expect(payload.fx).toMatchObject({ sourceAmount: -1000, sourceCurrency: "AED", targetCurrency: "AUD", rate: "0.4", effectiveDate: "2026-07-01", fxRateId: "fx-1" });
  });
});
