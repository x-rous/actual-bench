import { connectionFingerprint } from "@/lib/sync/connectionRef";
import {
  buildFlowPayload,
  emptyFlowForm,
  flowToFormState,
  isSameBudget,
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
});

describe("validation", () => {
  it("reports missing route fields", () => {
    expect(missingRouteFields(emptyFlowForm())).toEqual(expect.arrayContaining(["name", "source account", "target account"]));
    expect(missingRouteFields(filledForm())).toEqual([]);
  });

  it("flags same-budget same-account selection", () => {
    const form = filledForm();
    form.target = { ...form.source };
    expect(isSameBudget(form)).toBe(true);
    expect(isSameBudget(filledForm())).toBe(false);
  });
});

describe("buildFlowPayload", () => {
  it("encodes non-secret refs, filter, and transform into leg envelopes", () => {
    const payload = buildFlowPayload(filledForm(), instances) as JsonObject & { legs: JsonObject[] };
    const leg = payload.legs[0] as Record<string, JsonObject>;
    expect(payload.name).toBe("Card sync");
    expect(leg.sourceRef).toMatchObject({ connectionFingerprint: connectionFingerprint(sourceConn), accountId: "acct-src", budgetId: "budget-src" });
    expect(leg.targetRef).toMatchObject({ connectionFingerprint: connectionFingerprint(targetConn), accountId: "acct-tgt" });
    expect(leg.filter).toMatchObject({ startDate: "2026-07-01", payeeInclude: ["Coffee Bar", "Market"], excludeGeneratedSyncTransactions: true });
    expect(leg.transform).toMatchObject({ amountDirection: "reverse", missingPayee: "create", notesMarkerEnabled: true });
    // no secret fields leak
    expect(JSON.stringify(payload)).not.toContain("serverPassword");
    expect(JSON.stringify(payload)).not.toContain("pw");
  });
});

describe("flowToFormState", () => {
  it("round-trips through a persisted flow, resolving live connections by fingerprint", () => {
    const payload = buildFlowPayload(filledForm(), instances) as JsonObject & { legs: JsonObject[] };
    const legIn = payload.legs[0] as Record<string, JsonObject>;
    const flow: SyncFlow = {
      id: "flow-1", name: "Card sync", enabled: true, flowType: "transaction_sync", description: null,
      createdAt: "", updatedAt: "",
      legs: [{
        id: "leg-1", flowId: "flow-1", position: 0,
        sourceRef: { version: 1, data: legIn.sourceRef }, targetRef: { version: 1, data: legIn.targetRef },
        filter: { version: 1, data: legIn.filter }, transform: { version: 1, data: legIn.transform }, options: { version: 1, data: {} },
        createdAt: "", updatedAt: "",
      }],
    };

    const form = flowToFormState(flow, instances);
    expect(form.name).toBe("Card sync");
    expect(form.source.connectionId).toBe("c-src");
    expect(form.source.accountId).toBe("acct-src");
    expect(form.target.connectionId).toBe("c-tgt");
    expect(form.transform.amountDirection).toBe("reverse");
    expect(form.filter.payeeInclude).toBe("coffee bar, market");
  });
});
