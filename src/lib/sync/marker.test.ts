import { generateSyncMarker, isGeneratedSyncMarker, SYNC_MARKER_PREFIX } from "./marker";

describe("sync marker", () => {
  it("is deterministic for the same flow + source item key", () => {
    const a = generateSyncMarker("flow-1", "txn:t1");
    const b = generateSyncMarker("flow-1", "txn:t1");
    expect(a).toBe(b);
    expect(a).toBe(SYNC_MARKER_PREFIX + ":flow-1:txn:t1");
  });

  it("differs by flow and by source item key", () => {
    expect(generateSyncMarker("flow-1", "txn:t1")).not.toBe(generateSyncMarker("flow-2", "txn:t1"));
    expect(generateSyncMarker("flow-1", "txn:t1")).not.toBe(generateSyncMarker("flow-1", "txn:t2"));
  });

  it("returns null when identity is incomplete", () => {
    expect(generateSyncMarker("", "txn:t1")).toBeNull();
    expect(generateSyncMarker("flow-1", "")).toBeNull();
  });

  it("recognizes markers it generated", () => {
    expect(isGeneratedSyncMarker(generateSyncMarker("f", "txn:x"))).toBe(true);
    expect(isGeneratedSyncMarker("bank-import-123")).toBe(false);
    expect(isGeneratedSyncMarker(null)).toBe(false);
  });
});
