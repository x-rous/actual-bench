import { buildPostingMarker, isPostingMarker } from "./markers";

const key = { budgetSyncId: "budget-1", subjectId: "debt-1", postingKind: "interest-charge", periodKey: "2026-07-31", generation: 1 };

describe("posting markers (T114)", () => {
  it("is deterministic and carries the generation", () => {
    expect(buildPostingMarker(key)).toBe("abdebt:budget-1:debt-1:interest-charge:2026-07-31:g1");
    expect(buildPostingMarker(key)).toBe(buildPostingMarker({ ...key }));
  });

  it("g2 after a reversal never equals g1", () => {
    expect(buildPostingMarker({ ...key, generation: 2 })).not.toBe(buildPostingMarker(key));
  });

  it("refuses segments that could collide and generations below 1", () => {
    expect(() => buildPostingMarker({ ...key, periodKey: "2026:07" })).toThrow(/must not contain/);
    expect(() => buildPostingMarker({ ...key, generation: 0 })).toThrow(/at least 1/);
    expect(() => buildPostingMarker({ ...key, subjectId: "" })).toThrow(/required/);
  });

  it("recognises markers by prefix only", () => {
    expect(isPostingMarker(buildPostingMarker(key))).toBe(true);
    expect(isPostingMarker("spike:x")).toBe(false);
    expect(isPostingMarker(null)).toBe(false);
  });
});
