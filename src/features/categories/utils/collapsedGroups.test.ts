import {
  collapseGroupIds,
  expandGroupIds,
  getGroupCollapseState,
} from "./collapsedGroups";

describe("collapsedGroups utils", () => {
  it("reports collapse and expand availability for a scoped group set", () => {
    expect(
      getGroupCollapseState(new Set(["g-2"]), ["g-1", "g-2"])
    ).toEqual({
      canCollapseGroups: true,
      canExpandGroups: true,
      allCollapsed: false,
    });
  });

  it("collapses only the targeted groups", () => {
    expect([...collapseGroupIds(new Set(["g-3"]), ["g-1", "g-2"])].sort()).toEqual([
      "g-1",
      "g-2",
      "g-3",
    ]);
  });

  it("expands only the targeted groups", () => {
    expect([...expandGroupIds(new Set(["g-1", "g-2", "g-3"]), ["g-1", "g-2"])].sort()).toEqual([
      "g-3",
    ]);
  });

  it("treats a fully collapsed scoped set as all collapsed", () => {
    expect(
      getGroupCollapseState(new Set(["g-1", "g-2", "g-9"]), ["g-1", "g-2"])
    ).toEqual({
      canCollapseGroups: false,
      canExpandGroups: true,
      allCollapsed: true,
    });
  });
});
