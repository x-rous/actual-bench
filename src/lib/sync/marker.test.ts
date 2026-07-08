import { generateSyncMarker, isGeneratedSyncMarker, SYNC_MARKER_PREFIX, type SyncMarkerRoute } from "./marker";

function route(overrides: Partial<SyncMarkerRoute> = {}): SyncMarkerRoute {
  return {
    sourceBudgetId: "budget-src",
    targetBudgetId: "budget-tgt",
    targetAccountId: "acct-tgt",
    sourceItemKey: "txn:t1",
    ...overrides,
  };
}

describe("sync marker", () => {
  it("is deterministic for the same route + source item key", () => {
    expect(generateSyncMarker(route())).toBe(generateSyncMarker(route()));
    expect(generateSyncMarker(route())).toBe(`${SYNC_MARKER_PREFIX}:budget-src:budget-tgt:acct-tgt:txn:t1`);
  });

  it("is portable: independent of any per-instance flow id or server URL", () => {
    // Two instances that created "the same flow" (different random flow ids) but
    // point at the same budgets/account produce the identical marker.
    const instanceA = generateSyncMarker(route());
    const instanceB = generateSyncMarker(route());
    expect(instanceA).toBe(instanceB);
  });

  it("differs by source budget, target budget, target account, and source item", () => {
    const base = generateSyncMarker(route());
    expect(generateSyncMarker(route({ sourceBudgetId: "other" }))).not.toBe(base);
    expect(generateSyncMarker(route({ targetBudgetId: "other" }))).not.toBe(base);
    expect(generateSyncMarker(route({ targetAccountId: "other" }))).not.toBe(base);
    expect(generateSyncMarker(route({ sourceItemKey: "txn:t2" }))).not.toBe(base);
  });

  it("returns null when any identity component is missing", () => {
    expect(generateSyncMarker(route({ sourceBudgetId: "" }))).toBeNull();
    expect(generateSyncMarker(route({ targetBudgetId: "" }))).toBeNull();
    expect(generateSyncMarker(route({ targetAccountId: "" }))).toBeNull();
    expect(generateSyncMarker(route({ sourceItemKey: "" }))).toBeNull();
  });

  it("recognizes markers it generated (any version)", () => {
    expect(isGeneratedSyncMarker(generateSyncMarker(route()))).toBe(true);
    // Legacy v1-style marker is still recognized for loop prevention.
    expect(isGeneratedSyncMarker("absync:flow-1:txn:x")).toBe(true);
    expect(isGeneratedSyncMarker("bank-import-123")).toBe(false);
    expect(isGeneratedSyncMarker(null)).toBe(false);
  });
});
