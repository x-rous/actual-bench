import { runSafeSync, type SafeSyncDeps } from "./safeSyncOrchestrator";
import type {
  DryRunSummary,
  LiveDryRunContext,
  LiveDryRunResult,
  PreviewStore,
} from "./previewOrchestrator";
import type { ApplyRunResult, ApplyStore } from "./applyOrchestrator";
import type { BrowserApiConnection } from "@/store/connection";
import type { JsonEnvelope, SyncFlow, SyncReviewPolicy } from "@/lib/app-db/types";

const sourceConn: BrowserApiConnection = {
  id: "src", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "budget-src",
};
const targetConn: BrowserApiConnection = {
  id: "tgt", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "budget-tgt",
};
const context: LiveDryRunContext = { sourceConnection: sourceConn, targetConnection: targetConn };

function flowWithPolicy(reviewPolicy: SyncReviewPolicy | null): SyncFlow {
  const options: JsonEnvelope = { version: 1, data: reviewPolicy ? { reviewPolicy } : {} };
  return {
    id: "flow-1", name: "Cross-budget", enabled: true, flowType: "transaction_sync",
    description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "leg-1", flowId: "flow-1", position: 0,
      sourceRef: { version: 1, data: { budgetId: "budget-src", accountId: "acct-src" } },
      targetRef: { version: 1, data: { budgetId: "budget-tgt", accountId: "acct-tgt" } },
      filter: { version: 1, data: {} }, transform: { version: 1, data: {} }, options,
      createdAt: "", updatedAt: "",
    }],
  };
}

function summary(overrides: Partial<DryRunSummary> = {}): DryRunSummary {
  return {
    sourceTransactionsScanned: 0, generatedTransactionsExcluded: 0, sourceItemsScanned: 0,
    sourceItemsFilteredOut: 0, plannedItems: 0, createCandidates: 0, alreadySynced: 0,
    duplicatesSkipped: 0, exactDuplicatesAutoMapped: 0, sourceChangedWarnings: 0, targetMarkerMatches: 0, blocked: 0,
    ...overrides,
  };
}

function previewOk(summaryOverrides: Partial<DryRunSummary> = {}): LiveDryRunResult {
  return { status: "draft_preview", runId: "run-1", flowId: "flow-1", counts: {}, summary: summary(summaryOverrides), warnings: [], errors: [] };
}

function applyOk(overrides: Partial<ApplyRunResult> = {}): ApplyRunResult {
  return {
    status: "applied", runId: "run-1",
    counts: { selected: 1, applied: 1, appliedWithWarnings: 0, repaired: 0, skipped: 0, failed: 0 },
    items: [], ...overrides,
  };
}

function makeDeps(
  flow: SyncFlow | null,
  stubs: { runPreview?: jest.Mock; runApply?: jest.Mock } = {}
): SafeSyncDeps {
  const runPreview = stubs.runPreview ?? jest.fn(async () => previewOk({ createCandidates: 1 }));
  const runApply = stubs.runApply ?? jest.fn(async () => applyOk());
  return {
    transport: {} as SafeSyncDeps["transport"],
    previewStore: { loadFlow: jest.fn(async () => flow) } as unknown as PreviewStore,
    applyStore: {} as unknown as ApplyStore,
    runPreview: runPreview as unknown as SafeSyncDeps["runPreview"],
    runApply: runApply as unknown as SafeSyncDeps["runApply"],
  };
}

describe("runSafeSync - policy gate", () => {
  it("refuses to auto-apply a manual_preview_required flow (never previews or applies)", async () => {
    const runPreview = jest.fn();
    const runApply = jest.fn();
    const deps = makeDeps(flowWithPolicy("manual_preview_required"), { runPreview, runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);

    expect(result).toEqual({ status: "skipped_manual_policy", flowId: "flow-1", reviewPolicy: "manual_preview_required" });
    expect(runPreview).not.toHaveBeenCalled();
    expect(runApply).not.toHaveBeenCalled();
  });

  it("treats an unset policy as manual (safe default) and skips", async () => {
    const runApply = jest.fn();
    const deps = makeDeps(flowWithPolicy(null), { runApply });
    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result.status).toBe("skipped_manual_policy");
    expect(runApply).not.toHaveBeenCalled();
  });

  it("reports a missing flow as a preview failure without previewing", async () => {
    const runPreview = jest.fn();
    const deps = makeDeps(null, { runPreview });
    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result).toMatchObject({ status: "preview_failed", runId: null, error: { code: "flow_not_found" } });
    expect(runPreview).not.toHaveBeenCalled();
  });

  it.each(["auto_apply_safe_only", "auto_sync_on_interval"] as const)(
    "proceeds to preview + safe apply for %s",
    async (policy) => {
      const runApply = jest.fn(async () => applyOk());
      const deps = makeDeps(flowWithPolicy(policy), { runApply });
      const result = await runSafeSync({ flowId: "flow-1", context }, deps);
      expect(result.status).toBe("applied");
      // Apply is always driven with the safe-only bulk selection.
      expect(runApply).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-1", selection: { selection: "all_safe" } }),
        expect.anything()
      );
    }
  );
});

describe("runSafeSync - composition", () => {
  it("returns preview_failed and never applies when preview fails", async () => {
    const runPreview = jest.fn(async (): Promise<LiveDryRunResult> => ({
      status: "failed", runId: "run-1", flowId: "flow-1",
      error: { code: "target_load_failed", message: "boom" }, warnings: [],
    }));
    const runApply = jest.fn();
    const deps = makeDeps(flowWithPolicy("auto_apply_safe_only"), { runPreview, runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result).toMatchObject({ status: "preview_failed", error: { code: "target_load_failed" } });
    expect(runApply).not.toHaveBeenCalled();
  });

  it("no-ops without reopening the target when preview has no safe items", async () => {
    const runPreview = jest.fn(async () => previewOk({ createCandidates: 0, targetMarkerMatches: 0, duplicatesSkipped: 3 }));
    const runApply = jest.fn();
    const deps = makeDeps(flowWithPolicy("auto_apply_safe_only"), { runPreview, runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result.status).toBe("no_safe_items");
    expect(runApply).not.toHaveBeenCalled();
  });

  it("applies when a marker match is the only safe item", async () => {
    const runPreview = jest.fn(async () => previewOk({ createCandidates: 0, targetMarkerMatches: 1 }));
    const runApply = jest.fn(async () => applyOk({ counts: { selected: 1, applied: 0, appliedWithWarnings: 0, repaired: 1, skipped: 0, failed: 0 } }));
    const deps = makeDeps(flowWithPolicy("auto_sync_on_interval"), { runPreview, runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result.status).toBe("applied");
    expect(runApply).toHaveBeenCalledTimes(1);
  });

  it("maps a benign no_eligible_items apply failure to a no-op", async () => {
    const runApply = jest.fn(async () => applyOk({ status: "failed", error: { code: "no_eligible_items", message: "none" }, counts: { selected: 0, applied: 0, appliedWithWarnings: 0, repaired: 0, skipped: 0, failed: 0 } }));
    const deps = makeDeps(flowWithPolicy("auto_apply_safe_only"), { runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result.status).toBe("no_safe_items");
  });

  it("surfaces a partial apply with its detail", async () => {
    const runApply = jest.fn(async () => applyOk({ status: "partial", counts: { selected: 2, applied: 1, appliedWithWarnings: 0, repaired: 0, skipped: 0, failed: 1 } }));
    const deps = makeDeps(flowWithPolicy("auto_apply_safe_only"), { runApply });

    const result = await runSafeSync({ flowId: "flow-1", context }, deps);
    expect(result).toMatchObject({ status: "partial", apply: { status: "partial", counts: { failed: 1 } } });
  });
});
