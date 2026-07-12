import { getBudgetFileSyncCapabilities } from "./capabilities";
import { buildPlanConfig } from "./flowConfig";
import { generateSyncMarker } from "./marker";
import { transactionFingerprint } from "./sourceItems";
import { planSyncFlow } from "./syncPlanner";
import type { SyncSourceTransaction } from "@/lib/actual/transport";
import type { SyncMapping } from "@/lib/app-db/types";
import type { SyncPlannerInput, SyncPlannerTargetSnapshot } from "./plannedChanges";

const FLOW_ID = "flow-1";

const config = buildPlanConfig({
  flowId: FLOW_ID,
  sourceBudgetId: "budget-src",
  targetBudgetId: "budget-tgt",
  targetAccountId: "acct-tgt",
  sourceBudgetName: "Home",
  sourceAccountName: "Checking",
});

/** Expected portable marker for a source item under the test config's route. */
const marker = (sourceItemKey: string) =>
  generateSyncMarker({
    sourceBudgetId: config.sourceBudgetId,
    targetBudgetId: config.targetBudgetId,
    targetAccountId: config.targetAccountId,
    sourceItemKey,
  });

const browserCaps = getBudgetFileSyncCapabilities({ mode: "browser-api" });
// A hypothetical target whose transport cannot persist a durable marker. (Both
// shipping transports - Direct and HTTP - now can, so this is synthetic.)
const noMarkerCaps: typeof browserCaps = {
  ...browserCaps,
  capabilities: {
    ...browserCaps.capabilities,
    createTransactionWithImportedId: false,
    createTransactionWithNotesMarker: false,
  },
};

function txn(overrides: Partial<SyncSourceTransaction> = {}): SyncSourceTransaction {
  return {
    id: "t1",
    accountId: "acct-src",
    date: "2026-07-01",
    amount: -1250,
    payeeId: "sp1",
    payeeName: "Coffee Bar",
    categoryId: "sc1",
    categoryName: "Dining",
    notes: "flat white",
    cleared: true,
    reconciled: false,
    importedId: null,
    isParent: false,
    isChild: false,
    parentId: null,
    splitLines: [],
    ...overrides,
  };
}

function emptyTarget(overrides: Partial<SyncPlannerTargetSnapshot> = {}): SyncPlannerTargetSnapshot {
  return {
    payees: [],
    categories: [],
    importedIdIndex: new Map(),
    transactions: [],
    ...overrides,
  };
}

function baseInput(overrides: Partial<SyncPlannerInput> = {}): SyncPlannerInput {
  return {
    config,
    capabilities: browserCaps,
    sourceTransactions: [txn()],
    target: emptyTarget(),
    existingMappings: [],
    ...overrides,
  };
}

function mapping(overrides: Partial<SyncMapping> = {}): SyncMapping {
  return {
    id: "m1",
    flowId: FLOW_ID,
    sourceConnectionFingerprint: "src-fp",
    sourceBudgetId: "budget-src",
    sourceAccountId: "acct-src",
    sourceEntityType: "transaction",
    sourceTransactionId: "t1",
    sourceSplitId: null,
    sourceItemKey: "txn:t1",
    sourceFingerprint: "fp",
    targetConnectionFingerprint: "tgt-fp",
    targetBudgetId: "budget-tgt",
    targetAccountId: "acct-tgt",
    targetEntityType: "transaction",
    targetTransactionId: "tt1",
    targetItemKey: "txn:tt1",
    targetFingerprint: null,
    targetMarker: null,
    createdRunId: "run-0",
    status: "active",
    lastSeenAt: null,
    lastAppliedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("planSyncFlow - new create", () => {
  it("plans a new reversed, marker-tagged create with pre-selection", () => {
    const target = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      categories: [{ id: "tc1", name: "Dining" }],
    });
    const plan = planSyncFlow(baseInput({ target }));

    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item.classification).toBe("new");
    expect(item.action).toBe("create");
    expect(item.selectedForApply).toBe(true);
    expect(item.plannedTargetPayload).toMatchObject({
      amount: 1250,
      payeeId: "tp1",
      categoryId: "tc1",
      notes: "flat white [Synced from Home / Checking]",
      importedId: marker("txn:t1"),
    });
    expect(item.flags).toContain("target_rules_may_modify");
    expect(plan.counts.new).toBe(1);
  });

  it("flags missing payee create-on-apply and missing category left empty", () => {
    const plan = planSyncFlow(baseInput({ target: emptyTarget() }));
    const item = plan.items[0];
    expect(item.classification).toBe("new");
    expect(item.plannedTargetPayload?.payeeName).toBe("Coffee Bar");
    expect(item.plannedTargetPayload?.payeeId).toBeNull();
    expect(item.plannedTargetPayload?.categoryId).toBeNull();
    expect(item.flags).toEqual(
      expect.arrayContaining(["missing_payee_created_on_apply", "missing_category_left_empty"])
    );
  });

  it("leaves payee empty when policy is leave_empty", () => {
    const leaveEmpty = buildPlanConfig({
      flowId: FLOW_ID,
      sourceBudgetId: "budget-src",
      targetBudgetId: "budget-tgt",
      targetAccountId: "acct-tgt",
      sourceBudgetName: "Home",
      sourceAccountName: "Checking",
      missingPayee: "leave_empty",
    });
    const plan = planSyncFlow(baseInput({ config: leaveEmpty }));
    const item = plan.items[0];
    expect(item.plannedTargetPayload?.payeeName).toBeNull();
    expect(item.flags).toContain("missing_payee_left_empty");
  });
});

describe("planSyncFlow - mappings and markers", () => {
  it("skips an already-synced item whose fingerprint is unchanged", () => {
    const fingerprint = transactionFingerprint(txn());
    const plan = planSyncFlow(
      baseInput({ existingMappings: [mapping({ sourceFingerprint: fingerprint })] })
    );
    const item = plan.items[0];
    expect(item.classification).toBe("already_synced");
    expect(item.action).toBe("skip");
    expect(item.targetTransactionId).toBe("tt1");
  });

  it("warns (only) when the source changed after mapping", () => {
    const plan = planSyncFlow(
      baseInput({ existingMappings: [mapping({ sourceFingerprint: "stale-fingerprint" })] })
    );
    const item = plan.items[0];
    expect(item.classification).toBe("source_changed_since_sync");
    expect(item.action).toBe("skip");
    expect(item.flags).toContain("source_changed_since_sync");
    expect(item.plannedTargetPayload).toBeNull();
  });

  it("plans an update candidate when the source changed and the flow opts in (RD-057 §4)", () => {
    const updateConfig = buildPlanConfig({
      flowId: FLOW_ID,
      sourceBudgetId: "budget-src",
      targetBudgetId: "budget-tgt",
      targetAccountId: "acct-tgt",
      sourceBudgetName: "Home",
      sourceAccountName: "Checking",
      updateMappedTargets: true,
    });
    const plan = planSyncFlow(
      baseInput({
        config: updateConfig,
        existingMappings: [mapping({ sourceFingerprint: "stale-fingerprint", targetTransactionId: "tgt-txn-9" })],
      })
    );
    const item = plan.items[0];
    expect(item.classification).toBe("source_changed_since_sync");
    expect(item.action).toBe("update");
    expect(item.flags).toContain("source_changed_update");
    expect(item.selectedForApply).toBe(true);
    expect(item.targetTransactionId).toBe("tgt-txn-9");
    expect(item.plannedTargetPayload).not.toBeNull();
  });

  it("warns (never updates) a changed grouped split parent, whose children can't be patched (RD-057 §4/§6)", () => {
    const splitParent = txn({
      id: "p", amount: -3000, isParent: true,
      splitLines: [
        { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "sc-a", categoryName: "Groceries", notes: null },
        { id: "s2", amount: -2000, payeeId: null, payeeName: null, categoryId: "sc-b", categoryName: "Household", notes: null },
      ],
    });
    const config = buildPlanConfig({
      flowId: FLOW_ID, sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt",
      targetAccountId: "acct-tgt", sourceBudgetName: "Home", sourceAccountName: "Checking",
      updateMappedTargets: true, createTargetSplits: true,
    });
    const plan = planSyncFlow(
      baseInput({
        config,
        sourceTransactions: [splitParent],
        existingMappings: [mapping({ sourceItemKey: "txn:p", sourceFingerprint: "stale", targetTransactionId: "tgt-p", status: "active" })],
      })
    );
    const item = plan.items[0];
    expect(item.classification).toBe("source_changed_since_sync");
    expect(item.action).toBe("skip"); // warn only - not "update"
    expect(item.plannedTargetPayload).toBeNull();
  });

  it("still only warns when the source changed but the flow did not opt into updates", () => {
    const plan = planSyncFlow(
      baseInput({ existingMappings: [mapping({ sourceFingerprint: "stale-fingerprint", targetTransactionId: "tgt-txn-9" })] })
    );
    expect(plan.items[0].action).toBe("skip");
    expect(plan.items[0].plannedTargetPayload).toBeNull();
  });

  it("emits a review-first delete candidate for a mapping whose source is gone (RD-057 §5)", () => {
    const plan = planSyncFlow(
      baseInput({
        sourceTransactions: [], // source item t1 no longer exists
        existingMappings: [mapping({ sourceItemKey: "txn:t1", targetTransactionId: "tgt-1", status: "active" })],
        detectDeletedSource: true,
      })
    );
    const gone = plan.items.find((i) => i.classification === "source_missing");
    expect(gone).toBeDefined();
    expect(gone!.action).toBe("delete");
    expect(gone!.selectedForApply).toBe(false);
    expect(gone!.flags).toContain("source_deleted_review");
    expect(gone!.targetTransactionId).toBe("tgt-1");
  });

  it("skips an item whose mapping was disabled (RD-057 §7)", () => {
    const plan = planSyncFlow(
      baseInput({ existingMappings: [mapping({ sourceFingerprint: "anything", status: "disabled" })] })
    );
    expect(plan.items[0].action).toBe("skip");
    expect(plan.items[0].message).toMatch(/disabled/i);
  });

  it("does not flag deletions when detection is off", () => {
    const plan = planSyncFlow(
      baseInput({
        sourceTransactions: [],
        existingMappings: [mapping({ sourceItemKey: "txn:t1", targetTransactionId: "tgt-1", status: "active" })],
      })
    );
    expect(plan.items.some((i) => i.classification === "source_missing")).toBe(false);
  });

  it("detects a target marker match when the DB mapping is missing (repairable)", () => {
    const expectedMarker = marker("txn:t1")!;
    const target = emptyTarget({ importedIdIndex: new Map([[expectedMarker, "tt-existing"]]) });
    const plan = planSyncFlow(baseInput({ target }));
    const item = plan.items[0];
    expect(item.classification).toBe("target_marker_match");
    expect(item.action).toBe("skip");
    expect(item.targetTransactionId).toBe("tt-existing");
    expect(item.flags).toContain("target_marker_match_repair");
  });
});

describe("planSyncFlow - duplicates", () => {
  it("skips an exact duplicate", () => {
    const target = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      categories: [{ id: "tc1", name: "Dining" }],
      transactions: [
        { id: "d1", date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "tc1" },
      ],
    });
    const plan = planSyncFlow(baseInput({ target }));
    const item = plan.items[0];
    expect(item.classification).toBe("exact_duplicate");
    expect(item.duplicateConfidence).toBe("exact");
    expect(item.action).toBe("skip");
  });

  it("skips a strong duplicate (payee matches, category differs)", () => {
    const target = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      transactions: [
        { id: "d1", date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "other" },
      ],
    });
    const plan = planSyncFlow(baseInput({ target }));
    expect(plan.items[0].classification).toBe("strong_duplicate");
  });

  it("skips a weak duplicate (date + amount only)", () => {
    const target = emptyTarget({
      transactions: [
        { id: "d1", date: "2026-07-01", amount: 1250, payeeName: "Someone Else", categoryId: null },
      ],
    });
    const plan = planSyncFlow(baseInput({ target }));
    expect(plan.items[0].classification).toBe("weak_duplicate");
  });

  it("auto-maps an exact duplicate when the flow opts in (target id + flag, no create)", () => {
    const target = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      categories: [{ id: "tc1", name: "Dining" }],
      transactions: [
        { id: "existing-1", date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "tc1" },
      ],
    });
    const autoMapConfig = buildPlanConfig({ ...config, exactDuplicateAutoMap: true });
    const plan = planSyncFlow(baseInput({ config: autoMapConfig, target }));
    const item = plan.items[0];
    expect(item.classification).toBe("exact_duplicate");
    expect(item.flags).toContain("exact_duplicate_auto_map");
    expect(item.targetTransactionId).toBe("existing-1");
    expect(item.action).toBe("skip"); // mapping only; no create

    // A strong (fuzzy) duplicate is never auto-mapped, even with the option on.
    const strongTarget = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      transactions: [{ id: "s1", date: "2026-07-01", amount: 1250, payeeName: "Coffee Bar", categoryId: "other" }],
    });
    const strong = planSyncFlow(baseInput({ config: autoMapConfig, target: strongTarget })).items[0];
    expect(strong.classification).toBe("strong_duplicate");
    expect(strong.flags).not.toContain("exact_duplicate_auto_map");
  });
});

describe("planSyncFlow - splits", () => {
  it("explodes a split parent into separate planned creates with split keys", () => {
    const parent = txn({
      id: "p",
      amount: -3000,
      categoryId: null,
      categoryName: null,
      isParent: true,
      splitLines: [
        { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "sc-a", categoryName: "Groceries", notes: null },
        { id: "s2", amount: -2000, payeeId: null, payeeName: null, categoryId: "sc-b", categoryName: "Household", notes: "soap" },
      ],
    });
    const target = emptyTarget({
      payees: [{ id: "tp1", name: "Coffee Bar" }],
      categories: [
        { id: "tc-a", name: "Groceries" },
        { id: "tc-b", name: "Household" },
      ],
    });
    const plan = planSyncFlow(baseInput({ sourceTransactions: [parent], target }));

    expect(plan.items).toHaveLength(2);
    expect(plan.items.map((i) => i.sourceItemKey)).toEqual(["split:p:s1", "split:p:s2"]);
    expect(plan.items[0].sourceEntityType).toBe("split_line");
    expect(plan.items[0].plannedTargetPayload?.amount).toBe(1000);
    expect(plan.items[0].plannedTargetPayload?.categoryId).toBe("tc-a");
    // split children inherit the parent payee
    expect(plan.items[1].plannedTargetPayload?.payeeId).toBe("tp1");
    expect(plan.items[1].plannedTargetPayload?.importedId).toBe(marker("split:p:s2"));
  });

  it("syncs a split parent as ONE grouped target split when the flow opts in (RD-057 §6)", () => {
    const parent = txn({
      id: "p",
      amount: -3000,
      categoryId: null,
      categoryName: null,
      isParent: true,
      splitLines: [
        { id: "s1", amount: -1000, payeeId: null, payeeName: null, categoryId: "sc-a", categoryName: "Groceries", notes: null },
        { id: "s2", amount: -2000, payeeId: null, payeeName: null, categoryId: "sc-b", categoryName: "Household", notes: "soap" },
      ],
    });
    const target = emptyTarget({
      categories: [
        { id: "tc-a", name: "Groceries" },
        { id: "tc-b", name: "Household" },
      ],
    });
    const splitConfig = buildPlanConfig({ ...config, createTargetSplits: true });
    const plan = planSyncFlow(baseInput({ config: splitConfig, sourceTransactions: [parent], target }));

    // One parent item, not two exploded lines.
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0];
    expect(item.sourceItemKey).toBe("txn:p");
    expect(item.plannedTargetPayload?.amount).toBe(3000); // reversed parent total
    const subs = item.plannedTargetPayload?.subtransactions ?? [];
    expect(subs).toHaveLength(2);
    expect(subs[0]).toMatchObject({ amount: 1000, categoryId: "tc-a" });
    expect(subs[1]).toMatchObject({ amount: 2000, categoryId: "tc-b" });
    // Parent total equals the sum of children (amount consistency).
    expect(subs[0].amount + subs[1].amount).toBe(item.plannedTargetPayload?.amount);
  });

  it("flags a split-line fallback key when the child has no id", () => {
    const parent = txn({
      id: "p",
      isParent: true,
      splitLines: [
        { id: null, amount: -500, payeeId: null, payeeName: null, categoryId: null, categoryName: null, notes: null },
      ],
    });
    const plan = planSyncFlow(baseInput({ sourceTransactions: [parent] }));
    expect(plan.items[0].usedFallbackKey).toBe(true);
    expect(plan.items[0].flags).toContain("split_fallback_key");
  });
});

describe("planSyncFlow - blocked", () => {
  it("blocks creates when the target cannot store a durable marker", () => {
    const plan = planSyncFlow(baseInput({ capabilities: noMarkerCaps }));
    const item = plan.items[0];
    expect(item.classification).toBe("blocked");
    expect(item.action).toBe("blocked");
    expect(item.flags).toContain("blocked_no_marker");
    expect(item.plannedTargetPayload).toBeNull();
  });
});

describe("planSyncFlow - FX conversion (RD-056)", () => {
  const fxConfig = buildPlanConfig({
    flowId: FLOW_ID, sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt", targetAccountId: "acct-tgt",
    sourceBudgetName: "Home", sourceAccountName: "Checking",
    amountDirection: "same", fxEnabled: true, fxSourceCurrency: "AED", fxTargetCurrency: "AUD",
  });

  const rateInfo = (rate: string) => ({ rate, effectiveDate: "2026-07-01", source: "manual", provider: null, fxRateId: "fx-1" });

  it("converts a cross-currency create amount and carries FX audit + note", () => {
    const plan = planSyncFlow(baseInput({ config: fxConfig, fxRateByDate: new Map([["2026-07-01", rateInfo("0.4")]]) }));
    const item = plan.items[0];
    expect(item.classification).toBe("new");
    // -1250 (same sign) × 0.4 = -500.
    expect(item.plannedTargetPayload?.amount).toBe(-500);
    expect(item.plannedTargetPayload?.fx).toMatchObject({ sourceAmount: -1250, sourceCurrency: "AED", targetCurrency: "AUD", rate: "0.4", fxRateId: "fx-1" });
    expect(item.plannedTargetPayload?.notes).toContain("AED -12.50 @ 0.4");
  });

  it("routes an item with no rate for its date to fx_rate_pending review", () => {
    const plan = planSyncFlow(baseInput({ config: fxConfig })); // no rate map
    expect(plan.items[0].classification).toBe("blocked");
    expect(plan.items[0].flags).toContain("fx_rate_pending");
    expect(plan.items[0].action).toBe("blocked");
  });

  it("does not convert when source and target currencies match", () => {
    const sameCcy = buildPlanConfig({
      flowId: FLOW_ID, sourceBudgetId: "budget-src", targetBudgetId: "budget-tgt", targetAccountId: "acct-tgt",
      sourceBudgetName: "Home", sourceAccountName: "Checking",
      amountDirection: "same", fxEnabled: true, fxSourceCurrency: "AED", fxTargetCurrency: "AED",
    });
    const plan = planSyncFlow(baseInput({ config: sameCcy }));
    expect(plan.items[0].classification).toBe("new");
    expect(plan.items[0].plannedTargetPayload?.amount).toBe(-1250);
  });
});
