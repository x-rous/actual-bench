import { payeeAdapter } from "./payeeAdapter";
import { categoryAdapter } from "./categoryAdapter";
import { transactionAdapter } from "./transactionAdapter";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { ConnectionInstance } from "@/store/connection";
import type { JsonObject, SyncCapabilitySet, SyncFlow, SyncMapping } from "@/lib/app-db/types";

const envelope = (data: JsonObject) => ({ version: 1, data });

function flow(flowType: SyncFlow["flowType"], options: JsonObject = {}): SyncFlow {
  return {
    id: "flow-1", name: "Master data", enabled: true, flowType, description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "leg-1", flowId: "flow-1", position: 0,
      sourceRef: envelope({ connectionFingerprint: "src-fp", budgetId: "budget-src", budgetName: "Personal" }),
      targetRef: envelope({ connectionFingerprint: "tgt-fp", budgetId: "budget-tgt", budgetName: "Family" }),
      filter: envelope({}), transform: envelope({}), options: envelope(options),
      createdAt: "", updatedAt: "",
    }],
  };
}

const caps = {} as SyncCapabilitySet;
const mapping = (sourceItemKey: string, targetTransactionId: string): SyncMapping =>
  ({ sourceItemKey, targetTransactionId } as unknown as SyncMapping);

const httpConn = (id: string): ConnectionInstance =>
  ({ id, label: id, mode: "http-api", baseUrl: "https://api.example.com", apiKey: "k", budgetSyncId: `b-${id}` } as unknown as ConnectionInstance);

/** A flow with no saved fingerprints (validation skips the strict fp check). */
function routeFlow(flowType: SyncFlow["flowType"], withAccount = false): SyncFlow {
  const ref = (budgetId: string, budgetName: string): JsonObject => ({
    connectionFingerprint: "", budgetId, budgetName,
    ...(withAccount ? { accountId: "acct", accountName: "Checking" } : {}),
  });
  const f = flow(flowType);
  f.legs[0].sourceRef = envelope(ref("budget-src", "Personal"));
  f.legs[0].targetRef = envelope(ref("budget-tgt", "Family"));
  return f;
}

describe("entity sync over HTTP (RD-060)", () => {
  it("validates payee and category flows on HTTP-API connections", () => {
    expect(() => payeeAdapter.validate({ flow: routeFlow("payee_sync"), sourceConnection: httpConn("a"), targetConnection: httpConn("b") })).not.toThrow();
    expect(() => categoryAdapter.validate({ flow: routeFlow("category_sync"), sourceConnection: httpConn("a"), targetConnection: httpConn("b") })).not.toThrow();
  });

  it("validates transaction flows on HTTP-API connections (RD-060 Phase 2)", () => {
    expect(() => transactionAdapter.validate({ flow: routeFlow("transaction_sync", true), sourceConnection: httpConn("a"), targetConnection: httpConn("b") })).not.toThrow();
  });

  it("plans + creates payees through an HTTP-style transport", async () => {
    const materialized = { payees: [{ id: "s1", name: "New Vendor" }] };
    const target = { byName: new Map<string, string>() };
    const plan = payeeAdapter.plan({ flow: routeFlow("payee_sync"), materialized, target, mappings: [], targetCapabilities: caps });
    expect(plan.items[0].classification).toBe("new");
    // Same createPayee primitive the HTTP transport already exposes for entity pages.
    const createPayee = jest.fn(async ({ name }: { name: string }) => ({ id: "http-" + name, name, created: true }));
    const results = await payeeAdapter.createBatch({ createPayee } as unknown as ActualBenchTransport, routeFlow("payee_sync"), [{ itemId: "i1", payload: { entity: "payee", name: "New Vendor" } as JsonObject }]);
    expect(results[0]).toMatchObject({ itemId: "i1", targetId: "http-New Vendor" });
  });
});

describe("payeeAdapter.plan", () => {
  const materialized = { payees: [{ id: "s1", name: "Coffee Bar" }, { id: "s2", name: "New Vendor" }, { id: "s3", name: "Mapped Co" }] };
  const target = { byName: new Map([["coffee bar", "t-coffee"]]) };

  it("classifies mapped / name-matched / new payees", () => {
    const plan = payeeAdapter.plan({ flow: flow("payee_sync"), materialized, target, mappings: [mapping("payee:s3", "t-mapped")], targetCapabilities: caps });
    const byKey = Object.fromEntries(plan.items.map((i) => [i.sourceItemKey, i]));
    expect(byKey["payee:s3"].classification).toBe("already_synced");
    expect(byKey["payee:s1"].classification).toBe("target_name_match");
    expect(byKey["payee:s1"].targetTransactionId).toBe("t-coffee");
    expect(byKey["payee:s2"].classification).toBe("new");
    expect(byKey["payee:s2"].entityPayload).toMatchObject({ entity: "payee", name: "New Vendor" });
  });

  it("createBatch creates each new payee and returns its id", async () => {
    const createPayee = jest.fn(async ({ name }: { name: string }) => ({ id: "created-" + name, name, created: true }));
    const transport = { createPayee } as unknown as ActualBenchTransport;
    const results = await payeeAdapter.createBatch(transport, flow("payee_sync"), [{ itemId: "i1", payload: { entity: "payee", name: "New Vendor" } as JsonObject }]);
    expect(createPayee).toHaveBeenCalledWith({ name: "New Vendor" });
    expect(results[0]).toMatchObject({ itemId: "i1", targetId: "created-New Vendor" });
  });

  it("createBatch isolates a per-item failure and keeps the successes", async () => {
    const createPayee = jest.fn(async ({ name }: { name: string }) => {
      if (name === "Boom") throw new Error("create failed");
      return { id: "created-" + name, name, created: true };
    });
    const transport = { createPayee } as unknown as ActualBenchTransport;
    const results = await payeeAdapter.createBatch(transport, flow("payee_sync"), [
      { itemId: "ok", payload: { entity: "payee", name: "Good" } as JsonObject },
      { itemId: "bad", payload: { entity: "payee", name: "Boom" } as JsonObject },
    ]);
    expect(results).toEqual([
      { itemId: "ok", targetId: "created-Good", changedFields: [] },
      { itemId: "bad", targetId: null, changedFields: [] },
    ]);
  });
});

describe("categoryAdapter.plan", () => {
  const src = {
    categories: [
      { id: "c1", name: "Dining", isIncome: false, groupName: "Food" },       // group matches
      { id: "c2", name: "Salary", isIncome: true, groupName: "Income" },       // name matches on target
      { id: "c3", name: "Gadgets", isIncome: false, groupName: "NoSuchGroup" }, // ambiguous
    ],
  };
  const target = {
    categoryByKey: new Map([["salary|true", "t-salary"]]),
    groupByKey: new Map([["food|false", "g-food"], ["misc|false", "g-misc"]]),
  };

  it("places under a matching group, name-matches, and blocks ambiguous placement", () => {
    const plan = categoryAdapter.plan({ flow: flow("category_sync"), materialized: src, target, mappings: [], targetCapabilities: caps });
    const byKey = Object.fromEntries(plan.items.map((i) => [i.sourceItemKey, i]));
    expect(byKey["category:c1"]).toMatchObject({ classification: "new" });
    expect(byKey["category:c1"].entityPayload).toMatchObject({ entity: "category", groupId: "g-food", incomeKind: "expense" });
    expect(byKey["category:c2"].classification).toBe("target_name_match");
    expect(byKey["category:c3"].classification).toBe("blocked");
  });

  it("uses the default group when the source group has no match", () => {
    const plan = categoryAdapter.plan({ flow: flow("category_sync", { defaultGroupName: "Misc" }), materialized: src, target, mappings: [], targetCapabilities: caps });
    const c3 = plan.items.find((i) => i.sourceItemKey === "category:c3");
    expect(c3?.classification).toBe("new");
    expect(c3?.entityPayload).toMatchObject({ groupId: "g-misc" });
  });

  it("plans a group creation when createMissingGroup is enabled", () => {
    const plan = categoryAdapter.plan({ flow: flow("category_sync", { createMissingGroup: true }), materialized: src, target, mappings: [], targetCapabilities: caps });
    const c3 = plan.items.find((i) => i.sourceItemKey === "category:c3");
    expect(c3?.classification).toBe("new");
    expect(c3?.entityPayload).toMatchObject({ groupId: null, groupName: "NoSuchGroup" });
  });

  it("createBatch creates a missing group once then the category under it", async () => {
    const createCategoryGroup = jest.fn(async () => "new-group");
    const createCategory = jest.fn(async () => "new-cat");
    const transport = { createCategoryGroup, createCategory } as unknown as ActualBenchTransport;
    const results = await categoryAdapter.createBatch(transport, flow("category_sync"), [
      { itemId: "i1", payload: { entity: "category", name: "Gadgets", incomeKind: "expense", groupId: null, groupName: "NoSuchGroup" } as JsonObject },
      { itemId: "i2", payload: { entity: "category", name: "Widgets", incomeKind: "expense", groupId: null, groupName: "NoSuchGroup" } as JsonObject },
    ]);
    expect(createCategoryGroup).toHaveBeenCalledTimes(1); // group reused across both
    expect(createCategory).toHaveBeenCalledTimes(2);
    expect(results.map((r) => r.targetId)).toEqual(["new-cat", "new-cat"]);
  });
});
