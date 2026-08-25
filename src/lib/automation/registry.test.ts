import {
  __resetAutomationRegistryForTests,
  getAutomationJobType,
  listAutomationJobTypes,
  registerAutomationJobType,
} from "./registry";
import type { AutomationJobType } from "./registry";
import type { AutomationRunRollup, JsonEnvelope } from "@/lib/app-db/types";

/**
 * The registry's contract, expressed as the two shapes RD-079 has to support:
 * a type that constructs writes through Bench (declares classification) and a
 * type that only triggers an operation Actual owns (declares none).
 */

type SyncConfig = { flowId: string };
type SyncResult = { applied: number; review: number };

const writingType: AutomationJobType<SyncConfig, SyncResult> = {
  type: "test-budget-file-sync",
  label: "Test Budget File Sync",
  validateConfig(raw: JsonEnvelope): SyncConfig {
    const flowId = raw.data.flowId;
    if (typeof flowId !== "string") throw new Error("flowId is required");
    return { flowId };
  },
  async run(): Promise<SyncResult> {
    return { applied: 3, review: 1 };
  },
  summarize(result: SyncResult): AutomationRunRollup {
    return { outcome: result.review > 0 ? "partial" : "ok", itemCount: result.applied + result.review };
  },
  serializeResult(result: SyncResult): JsonEnvelope {
    return { version: 1, data: { ...result } };
  },
  classification: { reviewSubjects: ["transaction"], supportsAutoApply: true },
};

type BankSyncConfig = { accountIds: string[] };
type BankSyncResult = { triggered: string[]; failed: string[] };

const triggeringType: AutomationJobType<BankSyncConfig, BankSyncResult> = {
  type: "test-bank-sync",
  label: "Test Bank Sync",
  validateConfig(raw: JsonEnvelope): BankSyncConfig {
    const ids = raw.data.accountIds;
    return { accountIds: Array.isArray(ids) ? ids.map(String) : [] };
  },
  async run(): Promise<BankSyncResult> {
    return { triggered: ["acct-1", "acct-2"], failed: [] };
  },
  summarize(result: BankSyncResult): AutomationRunRollup {
    return {
      outcome: result.failed.length === 0 ? "ok" : "partial",
      itemCount: result.triggered.length + result.failed.length,
    };
  },
  serializeResult(result: BankSyncResult): JsonEnvelope {
    return { version: 1, data: { triggered: result.triggered, failed: result.failed } };
  },
  // No `classification`: this type constructs nothing, so it contributes
  // nothing to the review queue and must not be forced to pretend otherwise.
};

describe("automation job-type registry", () => {
  afterEach(() => {
    __resetAutomationRegistryForTests();
  });

  it("registers and resolves a job type", () => {
    registerAutomationJobType(writingType);

    expect(getAutomationJobType("test-budget-file-sync")?.label).toBe("Test Budget File Sync");
    expect(getAutomationJobType("nope")).toBeUndefined();
    expect(listAutomationJobTypes()).toHaveLength(1);
  });

  it("accepts a job type that declares no preview classification", () => {
    registerAutomationJobType(triggeringType);

    const registered = getAutomationJobType("test-bank-sync");
    expect(registered).toBeDefined();
    expect(registered?.classification).toBeUndefined();
  });

  it("holds two types with unrelated config and result shapes side by side", () => {
    registerAutomationJobType(writingType);
    registerAutomationJobType(triggeringType);

    expect(listAutomationJobTypes().map((jobType) => jobType.type).sort()).toEqual([
      "test-bank-sync",
      "test-budget-file-sync",
    ]);

    // Each type reduces its own result to the engine's shared roll-up, so a
    // list view can render both without knowing either shape.
    expect(writingType.summarize({ applied: 3, review: 1 })).toEqual({ outcome: "partial", itemCount: 4 });
    expect(triggeringType.summarize({ triggered: ["a"], failed: [] })).toEqual({
      outcome: "ok",
      itemCount: 1,
    });
  });

  it("refuses a duplicate type identifier", () => {
    registerAutomationJobType(writingType);
    expect(() => registerAutomationJobType(writingType)).toThrow(/already registered/);
  });

  it("refuses an empty type identifier", () => {
    expect(() => registerAutomationJobType({ ...triggeringType, type: "  " })).toThrow(
      /non-empty type identifier/
    );
  });

  it("surfaces invalid configuration as a throw the engine can report", () => {
    expect(() => writingType.validateConfig({ version: 1, data: {} })).toThrow(/flowId is required/);
    expect(writingType.validateConfig({ version: 1, data: { flowId: "flow-1" } })).toEqual({
      flowId: "flow-1",
    });
  });
});
