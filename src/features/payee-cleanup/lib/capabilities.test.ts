import {
  explainMissingCapability,
  getPayeeCleanupCapabilities,
} from "./capabilities";

describe("getPayeeCleanupCapabilities", () => {
  it("supports cleanup in both transports", () => {
    expect(getPayeeCleanupCapabilities({ mode: "http-api" }).supported).toBe(true);
    expect(getPayeeCleanupCapabilities({ mode: "browser-api" }).supported).toBe(
      true
    );
  });

  it("reports the same core read/write set in both transports", () => {
    const http = getPayeeCleanupCapabilities({ mode: "http-api" }).capabilities;
    const direct = getPayeeCleanupCapabilities({ mode: "browser-api" }).capabilities;

    for (const key of [
      "listPayees",
      "readPayeeAnalysisMetadata",
      "renamePayee",
      "mergePayees",
      "deletePayee",
      "readTransactionCountsByPayee",
      "readImportedPayeeHistory",
      "createRules",
    ] as const) {
      expect(http[key]).toBe(true);
      expect(direct[key]).toBe(true);
    }
  });

  it("declares favorite/learn_categories unwritable in BOTH transports", () => {
    // APIPayeeEntity is Pick<PayeeEntity,'id'|'name'|'transfer_acct'> and
    // actual-http-api's Payee schema matches — see nativeSemantics.test.ts.
    expect(
      getPayeeCleanupCapabilities({ mode: "http-api" }).capabilities
        .writePayeeBehaviorFields
    ).toBe(false);
    expect(
      getPayeeCleanupCapabilities({ mode: "browser-api" }).capabilities
        .writePayeeBehaviorFields
    ).toBe(false);
  });

  it("declares payee locations unreadable in BOTH transports", () => {
    expect(
      getPayeeCleanupCapabilities({ mode: "http-api" }).capabilities
        .readPayeeLocations
    ).toBe(false);
    expect(
      getPayeeCleanupCapabilities({ mode: "browser-api" }).capabilities
        .readPayeeLocations
    ).toBe(false);
  });

  it("exposes the native orphan handler in Direct mode only", () => {
    // Direct reaches it through the runtime's `send`; actual-http-api has no
    // route for it. Used to parity-check Bench's predicate, never as a second
    // code path.
    expect(
      getPayeeCleanupCapabilities({ mode: "browser-api" }).capabilities
        .nativeOrphanHandler
    ).toBe(true);
    expect(
      getPayeeCleanupCapabilities({ mode: "http-api" }).capabilities
        .nativeOrphanHandler
    ).toBe(false);
  });

  it("returns an independent capability object per call", () => {
    const first = getPayeeCleanupCapabilities({ mode: "http-api" });
    first.capabilities.mergePayees = false;
    expect(
      getPayeeCleanupCapabilities({ mode: "http-api" }).capabilities.mergePayees
    ).toBe(true);
  });
});

describe("explainMissingCapability", () => {
  it("explains every capability that is false somewhere, in user language", () => {
    for (const key of [
      "writePayeeBehaviorFields",
      "readPayeeLocations",
      "nativeOrphanHandler",
    ] as const) {
      const explanation = explainMissingCapability(key);
      expect(explanation).toBeTruthy();
      expect(explanation).not.toMatch(/APIPayeeEntity|payee_mapping|send\(/);
    }
  });

  it("says the surviving payee keeps its own behavior settings", () => {
    expect(explainMissingCapability("writePayeeBehaviorFields")).toContain(
      "keeps its own settings"
    );
  });

  it("says merging does not move saved locations", () => {
    expect(explainMissingCapability("readPayeeLocations")).toContain(
      "does not move"
    );
  });

  it("discloses that Bench's unused-payee check is stricter than Actual's", () => {
    expect(explainMissingCapability("nativeOrphanHandler")).toContain("stricter");
  });

  it("has no explanation for capabilities that are always available", () => {
    expect(explainMissingCapability("mergePayees")).toBeNull();
  });
});
