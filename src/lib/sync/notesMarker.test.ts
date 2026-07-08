import {
  applySyncNotesMarker,
  buildSyncNotesMarker,
  hasSyncNotesMarker,
} from "./notesMarker";

const marker = buildSyncNotesMarker({
  sourceBudgetName: "Home",
  sourceAccountName: "Checking",
});

describe("sync notes marker", () => {
  it("builds the default human-readable marker", () => {
    expect(marker).toBe("[Synced from Home / Checking]");
  });

  it("uses the marker alone when there are no source notes", () => {
    expect(applySyncNotesMarker(null, marker)).toBe(marker);
    expect(applySyncNotesMarker("   ", marker)).toBe(marker);
  });

  it("appends the marker to existing notes", () => {
    expect(applySyncNotesMarker("Groceries", marker)).toBe("Groceries " + marker);
  });

  it("is idempotent when the marker is already present", () => {
    const once = applySyncNotesMarker("Groceries", marker);
    expect(applySyncNotesMarker(once, marker)).toBe(once);
  });

  it("detects marker presence", () => {
    expect(hasSyncNotesMarker("x " + marker, marker)).toBe(true);
    expect(hasSyncNotesMarker("x", marker)).toBe(false);
    expect(hasSyncNotesMarker(null, marker)).toBe(false);
  });
});
