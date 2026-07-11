import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { getAppDb, resetAppDbForTests } from "@/lib/app-db/connection";
import { createSyncFlow, getSyncFlow } from "@/lib/app-db/syncFlowRepository";
import {
  buildFlowPayload,
  emptyFlowForm,
  flowToFormState,
  isSameBudget,
  isSelfSync,
  missingRouteFields,
  type SyncFlowFormState,
} from "./flowForm";
import type { BrowserApiConnection } from "@/store/connection";
import type { JsonObject, SyncFlow } from "@/lib/app-db/types";

const sourceConn: BrowserApiConnection = {
  id: "c-src", label: "Home", mode: "browser-api", baseUrl: "https://s.example.com", serverPassword: "pw", budgetSyncId: "budget-src",
};
const targetConn: BrowserApiConnection = {
  id: "c-tgt", label: "Family", mode: "browser-api", baseUrl: "https://t.example.com", serverPassword: "pw", budgetSyncId: "budget-tgt",
};
const instances = [sourceConn, targetConn];

function filledForm(): SyncFlowFormState {
  const form = emptyFlowForm();
  form.name = "Card sync";
  form.source = { connectionId: "c-src", budgetSyncId: "budget-src", budgetName: "Home", accountId: "acct-src", accountName: "Checking" };
  form.target = { connectionId: "c-tgt", budgetSyncId: "budget-tgt", budgetName: "Family", accountId: "acct-tgt", accountName: "Joint" };
  form.filter.startDate = "2026-07-01";
  form.filter.payeeInclude = "Coffee Bar, Market";
  return form;
}

describe("form defaults", () => {
  it("defaults to reverse sign and create-missing-payee", () => {
    const form = emptyFlowForm();
    expect(form.transform.amountDirection).toBe("reverse");
    expect(form.transform.missingPayee).toBe("create");
    expect(form.transform.notesMarkerEnabled).toBe(true);
  });

  it("defaults automation to manual preview (RD-053 behavior preserved)", () => {
    expect(emptyFlowForm().automation.reviewPolicy).toBe("manual_preview_required");
    expect(emptyFlowForm().automation.intervalMinutes).toBe("60");
  });

  it("defaults to a transaction flow", () => {
    expect(emptyFlowForm().flowType).toBe("transaction_sync");
  });
});

describe("entity (master-data) flows", () => {
  function entityForm(): SyncFlowFormState {
    const form = emptyFlowForm();
    form.name = "Payee sync";
    form.flowType = "category_sync";
    form.source = { connectionId: "c-src", budgetSyncId: "budget-src", budgetName: "Home", accountId: "", accountName: "" };
    form.target = { connectionId: "c-tgt", budgetSyncId: "budget-tgt", budgetName: "Family", accountId: "", accountName: "" };
    form.entity = { defaultGroupName: "Uncategorized", createMissingGroup: true };
    return form;
  }

  it("requires only budgets (not accounts) for an entity flow", () => {
    expect(missingRouteFields(entityForm())).toEqual([]);
    const noBudget = entityForm();
    noBudget.source.connectionId = "";
    expect(missingRouteFields(noBudget)).toContain("source budget");
  });

  it("round-trips flow type and entity options through the payload", () => {
    const payload = buildFlowPayload(entityForm(), instances) as JsonObject & { legs: JsonObject[]; flowType: string };
    expect(payload.flowType).toBe("category_sync");
    const leg = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    expect(leg.options.data).toMatchObject({ defaultGroupName: "Uncategorized", createMissingGroup: true });

    const flow: SyncFlow = {
      id: "flow-1", name: "Payee sync", enabled: true, flowType: "category_sync", description: null, createdAt: "", updatedAt: "",
      legs: [{ id: "leg-1", flowId: "flow-1", position: 0, sourceRef: leg.sourceRef, targetRef: leg.targetRef, filter: leg.filter, transform: leg.transform, options: leg.options, createdAt: "", updatedAt: "" }],
    };
    const form = flowToFormState(flow, instances);
    expect(form.flowType).toBe("category_sync");
    expect(form.entity).toEqual({ defaultGroupName: "Uncategorized", createMissingGroup: true });
  });
});

describe("validation", () => {
  it("reports missing route fields", () => {
    expect(missingRouteFields(emptyFlowForm())).toEqual(expect.arrayContaining(["name", "source account", "target account"]));
    expect(missingRouteFields(filledForm())).toEqual([]);
  });

  it("allows same-budget different-account flows but blocks a self-sync (RD-057 §3)", () => {
    // Same account → same account is a no-op: blocked.
    const sameAccount = filledForm();
    sameAccount.target = { ...sameAccount.source };
    expect(isSameBudget(sameAccount)).toBe(true);
    expect(isSelfSync(sameAccount)).toBe(true);

    // Same budget file, different account - now allowed (not a self-sync).
    const sameBudget = filledForm();
    sameBudget.target = { ...sameBudget.source, accountId: "acct-other", accountName: "Savings" };
    expect(isSameBudget(sameBudget)).toBe(true);
    expect(isSelfSync(sameBudget)).toBe(false);

    // Different budgets - allowed.
    expect(isSameBudget(filledForm())).toBe(false);
    expect(isSelfSync(filledForm())).toBe(false);
  });
});

describe("buildFlowPayload", () => {
  it("encodes non-secret refs, filter, and transform into leg envelopes", () => {
    const payload = buildFlowPayload(filledForm(), instances) as JsonObject & { legs: JsonObject[] };
    const leg = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    expect(payload.name).toBe("Card sync");
    // Each leg ref must be a versioned envelope, or the flow repository rejects it.
    expect(leg.sourceRef.version).toBe(1);
    expect(leg.sourceRef.data).toMatchObject({ connectionFingerprint: connectionFingerprint(sourceConn), accountId: "acct-src", budgetId: "budget-src" });
    expect(leg.targetRef.data).toMatchObject({ connectionFingerprint: connectionFingerprint(targetConn), accountId: "acct-tgt" });
    expect(leg.filter.data).toMatchObject({ startDate: "2026-07-01", payeeInclude: ["Coffee Bar", "Market"], excludeGeneratedSyncTransactions: true });
    expect(leg.transform.data).toMatchObject({ amountDirection: "reverse", missingPayee: "create", notesMarkerEnabled: true });
    // no secret fields leak
    expect(JSON.stringify(payload)).not.toContain("serverPassword");
    expect(JSON.stringify(payload)).not.toContain("pw");
  });

  it("encodes the automation review policy into the leg options envelope", () => {
    const form = filledForm();
    form.automation.reviewPolicy = "auto_sync_on_interval";
    const payload = buildFlowPayload(form, instances) as JsonObject & { legs: JsonObject[] };
    const leg = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    expect(leg.options.data).toMatchObject({ reviewPolicy: "auto_sync_on_interval" });
  });

  it("clamps the interval to its floor on save", () => {
    const form = filledForm();
    form.automation.intervalMinutes = "5"; // below the 15-minute floor
    const payload = buildFlowPayload(form, instances) as JsonObject & { legs: JsonObject[] };
    const leg = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    expect(leg.options.data.intervalMinutes).toBe(15);

    form.automation.intervalMinutes = "";
    const blank = buildFlowPayload(form, instances) as JsonObject & { legs: JsonObject[] };
    const blankLeg = blank.legs[0] as Record<string, { version: number; data: JsonObject }>;
    expect(blankLeg.options.data.intervalMinutes).toBe(60); // default when unparseable
  });
});

describe("flowToFormState", () => {
  it("round-trips through a persisted flow, resolving live connections by fingerprint", () => {
    const payload = buildFlowPayload(filledForm(), instances) as JsonObject & { legs: JsonObject[] };
    const legIn = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    const flow: SyncFlow = {
      id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null,
      createdAt: "", updatedAt: "",
      legs: [{
        id: "leg-1", flowId: "flow-1", position: 0,
        sourceRef: legIn.sourceRef, targetRef: legIn.targetRef,
        filter: legIn.filter, transform: legIn.transform, options: { version: 1, data: {} },
        createdAt: "", updatedAt: "",
      }],
    };

    const form = flowToFormState(flow, instances);
    expect(form.name).toBe("Card sync");
    expect(form.source.connectionId).toBe("c-src");
    expect(form.source.accountId).toBe("acct-src");
    expect(form.target.connectionId).toBe("c-tgt");
    // Target display names must survive the round-trip (flow list shows them,
    // not the raw budget UUID).
    expect(form.target.budgetName).toBe("Family");
    expect(form.target.accountName).toBe("Joint");
    expect(form.transform.amountDirection).toBe("reverse");
    expect(form.filter.payeeInclude).toBe("coffee bar, market");
    // Automation policy survives the round-trip via the options envelope.
    expect(form.automation.reviewPolicy).toBe("manual_preview_required");
  });

  it("round-trips a non-default policy and falls back to manual for an unknown value", () => {
    const auto = filledForm();
    auto.automation.reviewPolicy = "auto_apply_safe_only";
    const payload = buildFlowPayload(auto, instances) as JsonObject & { legs: JsonObject[] };
    const legIn = payload.legs[0] as Record<string, { version: number; data: JsonObject }>;
    const baseFlow = (options: JsonObject): SyncFlow => ({
      id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null,
      createdAt: "", updatedAt: "",
      legs: [{
        id: "leg-1", flowId: "flow-1", position: 0,
        sourceRef: legIn.sourceRef, targetRef: legIn.targetRef,
        filter: legIn.filter, transform: legIn.transform, options: { version: 1, data: options },
        createdAt: "", updatedAt: "",
      }],
    });

    expect(flowToFormState(baseFlow({ reviewPolicy: "auto_apply_safe_only" }), instances).automation.reviewPolicy).toBe("auto_apply_safe_only");
    // Garbage policy value decodes to the safe manual default.
    expect(flowToFormState(baseFlow({ reviewPolicy: "nonsense" }), instances).automation.reviewPolicy).toBe("manual_preview_required");
  });

  it("persists through the real repository and round-trips (regression: envelope shape)", () => {
    const root = mkdtempSync(join(tmpdir(), "actual-bench-flowform-db-"));
    try {
      const db = getAppDb(join(root, "metadata.sqlite"));
      // The payload the Save button sends must be accepted by the flow repo.
      const created = createSyncFlow(db, buildFlowPayload(filledForm(), instances));
      const reloaded = getSyncFlow(db, created.id);
      expect(reloaded?.legs[0]?.sourceRef.data).toMatchObject({ accountId: "acct-src" });

      const form = flowToFormState(reloaded as SyncFlow, instances);
      expect(form.source.connectionId).toBe("c-src");
      expect(form.target.accountId).toBe("acct-tgt");
    } finally {
      resetAppDbForTests();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
