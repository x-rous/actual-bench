import { act, renderHook } from "@testing-library/react";
import type { ActualBenchTransport } from "@/lib/actual";
import type { ConnectionInstance } from "@/store/connection";
import { useStagedStore } from "@/store/staged";
import type { Payee, Rule } from "@/types/entities";
import type { CleanupPlan } from "../lib/plan";
import {
  usePayeeCleanupPlan,
  type StageOutcome,
} from "./usePayeeCleanupPlan";

const mockGetTransport = jest.fn();
const mockGetTransactionCounts = jest.fn();
const mockGetMetadata = jest.fn();

jest.mock("@/lib/actual", () => ({
  getTransport: (connection: unknown) => mockGetTransport(connection),
}));

jest.mock("@/lib/api/query", () => ({
  getTransactionCountsForIds: (...args: unknown[]) =>
    mockGetTransactionCounts(...args),
}));

jest.mock("../lib/payeeMetadata", () => {
  const actual = jest.requireActual("../lib/payeeMetadata") as typeof import("../lib/payeeMetadata");
  return {
    ...actual,
    getPayeeCleanupMetadata: (...args: unknown[]) => mockGetMetadata(...args),
  };
});

let activeConnection: ConnectionInstance = {
  id: "connection-1",
  label: "HTTP API",
  mode: "http-api",
  baseUrl: "https://api.example.com",
  apiKey: "key",
  budgetSyncId: "budget-1",
};

jest.mock("@/store/connection", () => ({
  useConnectionStore: jest.fn(() => activeConnection),
  selectActiveInstance: jest.fn(),
}));

function payee(id = "payee-1", name = "Old Payee"): Payee {
  return { id, name };
}

function rule(id: string, payeeId: string): Rule {
  return {
    id,
    stage: "pre",
    conditionsOp: "and",
    conditions: [{ field: "imported_payee", op: "is", value: "OLD PAYEE" }],
    actions: [{ field: "payee", op: "set", value: payeeId }],
  };
}

function deletionPlan(target: Payee = payee()): CleanupPlan {
  return {
    merges: [],
    renames: [],
    rules: [],
    ruleExtensions: [],
    deletions: [
      { kind: "delete-payee", payeeId: target.id, name: target.name },
    ],
  };
}

function renamePlan(target: Payee = payee()): CleanupPlan {
  return {
    merges: [],
    renames: [
      {
        kind: "rename-payee",
        payeeId: target.id,
        from: target.name,
        to: "Cleanup Name",
      },
    ],
    rules: [],
    ruleExtensions: [],
    deletions: [],
  };
}

function transport(payees: Payee[], rules: Rule[] = []) {
  return {
    getPayees: jest.fn().mockResolvedValue(payees),
    getRules: jest.fn().mockResolvedValue(rules),
  } as unknown as ActualBenchTransport;
}

describe("usePayeeCleanupPlan", () => {
  beforeEach(() => {
    useStagedStore.getState().discardAll();
    mockGetTransport.mockReset();
    mockGetTransactionCounts.mockReset();
    mockGetMetadata.mockReset();
    mockGetTransactionCounts.mockResolvedValue(new Map());
    mockGetMetadata.mockResolvedValue(new Map());
    activeConnection = {
      id: "connection-1",
      label: "HTTP API",
      mode: "http-api",
      baseUrl: "https://api.example.com",
      apiKey: "key",
      budgetSyncId: "budget-1",
    };
  });

  afterEach(() => {
    useStagedStore.getState().discardAll();
  });

  it("loads the payee working set and stages an unused-payee deletion", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue(transport([target]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toEqual({ status: "staged", operations: 1 });
    expect(useStagedStore.getState().payees[target.id]?.isDeleted).toBe(true);
  });

  it("blocks deletion when the payee gained a transaction after the scan", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue(transport([target]));
    mockGetTransactionCounts.mockResolvedValue(new Map([[target.id, 1]]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toMatchObject({ status: "blocked" });
    expect(useStagedStore.getState().payees[target.id]?.isDeleted).toBe(false);
  });

  it("blocks deletion when a live rule now references the payee", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue(transport([target], [rule("rule-1", target.id)]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toMatchObject({ status: "blocked" });
    expect(useStagedStore.getState().payees[target.id]?.isDeleted).toBe(false);
  });

  it("uses a fresh live rule when its unchanged staged copy is stale", async () => {
    const target = payee();
    const staleRule = rule("rule-1", "other-payee");
    const freshRule = rule("rule-1", target.id);
    useStagedStore.getState().loadRules([staleRule]);
    mockGetTransport.mockReturnValue(transport([target], [freshRule]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toMatchObject({ status: "blocked" });
    expect(useStagedStore.getState().payees[target.id]?.isDeleted).toBe(false);
  });

  it("blocks deletion when an unsaved rule now references the payee", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue(transport([target]));
    useStagedStore.getState().stageNew("rules", rule("new-rule", target.id));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toMatchObject({ status: "blocked" });
    expect(useStagedStore.getState().payees[target.id]?.isDeleted).toBe(false);
  });

  it("blocks a cleanup edit instead of overwriting an existing staged rename", async () => {
    const target = payee();
    useStagedStore.getState().loadPayees([target]);
    useStagedStore.getState().stageUpdate("payees", target.id, {
      name: "Manual Name",
    });
    mockGetTransport.mockReturnValue(transport([target]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(renamePlan(target));
    });

    expect(outcome).toMatchObject({
      status: "blocked",
      problems: [expect.objectContaining({ message: expect.stringMatching(/unsaved payee changes/i) })],
    });
    expect(useStagedStore.getState().payees[target.id]?.entity.name).toBe(
      "Manual Name"
    );
  });

  it("blocks deletion when the payee no longer exists", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue(transport([]));
    const { result } = renderHook(() => usePayeeCleanupPlan());

    let outcome: StageOutcome | undefined;
    await act(async () => {
      outcome = await result.current.stage(deletionPlan(target));
    });

    expect(outcome).toMatchObject({ status: "blocked" });
    expect(useStagedStore.getState().payees[target.id]).toBeUndefined();
  });

  it("rejects without staging when a fresh safety read fails", async () => {
    const target = payee();
    mockGetTransport.mockReturnValue({
      getPayees: jest.fn().mockRejectedValue(new Error("Actual is unavailable")),
      getRules: jest.fn(),
    } as unknown as ActualBenchTransport);
    const { result } = renderHook(() => usePayeeCleanupPlan());

    await act(async () => {
      await expect(result.current.stage(deletionPlan(target))).rejects.toThrow(
        "Actual is unavailable"
      );
    });
    expect(useStagedStore.getState().payees[target.id]).toBeUndefined();
  });
});
