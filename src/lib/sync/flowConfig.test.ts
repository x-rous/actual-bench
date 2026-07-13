import { decodeFlowPlanConfig } from "./flowConfig";
import type { JsonEnvelope, SyncFlow } from "@/lib/app-db/types";

const env = (data: Record<string, unknown>): JsonEnvelope => ({ version: 1, data: data as JsonEnvelope["data"] });

function flowWithTransform(transform: Record<string, unknown>): SyncFlow {
  return {
    id: "f1", name: "F", enabled: true, flowType: "transaction_sync", description: null, createdAt: "", updatedAt: "",
    legs: [{
      id: "l1", flowId: "f1", position: 0,
      sourceRef: env({ accountId: "a" }), targetRef: env({ accountId: "b" }),
      filter: env({}), transform: env(transform), options: env({}),
      createdAt: "", updatedAt: "",
    }],
  };
}

describe("decodeFlowPlanConfig — FX (RD-056)", () => {
  it("defaults FX off with empty currencies and provider allowed", () => {
    const c = decodeFlowPlanConfig(flowWithTransform({}));
    expect(c.fxEnabled).toBe(false);
    expect(c.fxSourceCurrency).toBe("");
    expect(c.fxTargetCurrency).toBe("");
    expect(c.fxAllowProvider).toBe(true);
  });

  it("decodes FX fields and upper-cases currency codes", () => {
    const c = decodeFlowPlanConfig(flowWithTransform({ fxEnabled: true, fxSourceCurrency: "aed", fxTargetCurrency: "aud", fxAllowProvider: false }));
    expect(c).toMatchObject({ fxEnabled: true, fxSourceCurrency: "AED", fxTargetCurrency: "AUD", fxAllowProvider: false });
  });
});
