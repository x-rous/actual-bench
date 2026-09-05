import type { ConditionOrAction } from "@/types/entities";
import {
  groupActionsBySplitIndex,
  groupBySplitIndex,
  hasDenseSplitIndices,
  hasValidSplitIndex,
  isSplitAmountAction,
  isSplitRule,
  makeSplitAmountAction,
  nextSplitIndex,
  normalizeSplitIndices,
  removeSplitGroup,
  splitCount,
  splitIndexOf,
  withSplitIndex,
} from "./splitActions";

const setPayee: ConditionOrAction = { op: "set", field: "payee", value: "p1", type: "id" };

function child(index: number, field: string, value: string): ConditionOrAction {
  return { op: "set", field, value, type: "id", options: { splitIndex: index } };
}

// A two-way split: set the payee on the parent, then 25% to one category and the rest to another.
const twoWaySplit: ConditionOrAction[] = [
  setPayee,
  { op: "set-split-amount", value: 25, type: "number", options: { method: "fixed-percent", splitIndex: 1 } },
  child(1, "category", "c1"),
  { op: "set-split-amount", value: null, type: "number", options: { method: "remainder", splitIndex: 2 } },
  child(2, "category", "c2"),
];

describe("splitIndexOf", () => {
  it("treats absent, zero and invalid indices as the parent", () => {
    expect(splitIndexOf(setPayee)).toBe(0);
    expect(splitIndexOf({ ...setPayee, options: { splitIndex: 0 } })).toBe(0);
    expect(splitIndexOf({ ...setPayee, options: { splitIndex: -1 } })).toBe(0);
    expect(splitIndexOf({ ...setPayee, options: { splitIndex: 1.5 } })).toBe(0);
  });

  it("reads a real index", () => {
    expect(splitIndexOf(child(2, "notes", "x"))).toBe(2);
  });
});

describe("isSplitRule / splitCount", () => {
  it("recognises a split rule", () => {
    expect(isSplitRule(twoWaySplit)).toBe(true);
    expect(splitCount(twoWaySplit)).toBe(2);
  });

  it("leaves an ordinary rule alone", () => {
    expect(isSplitRule([setPayee])).toBe(false);
    expect(splitCount([setPayee])).toBe(0);
    expect(nextSplitIndex([setPayee])).toBe(1);
  });

  it("recognises a split-amount action even with no children beside it", () => {
    expect(isSplitAmountAction(makeSplitAmountAction(1))).toBe(true);
    expect(isSplitRule([makeSplitAmountAction(1)])).toBe(true);
  });
});

describe("groupActionsBySplitIndex", () => {
  it("groups the parent and each child", () => {
    const groups = groupActionsBySplitIndex(twoWaySplit);
    expect(groups.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(groups[0].items).toEqual([setPayee]);
    expect(groups[1].items).toHaveLength(2);
    expect(groups[2].items).toHaveLength(2);
  });

  it("always produces a parent group, even for a rule with no actions", () => {
    expect(groupActionsBySplitIndex([])).toEqual([{ index: 0, items: [] }]);
  });

  it("fills a plausible gap with an empty group rather than a hole", () => {
    // Three actions, highest index 3 — within the bound, so the gaps are rendered.
    const groups = groupActionsBySplitIndex([setPayee, child(3, "notes", "x"), child(3, "payee", "p1")]);
    expect(groups.map((g) => [g.index, g.items.length])).toEqual([
      [0, 1],
      [1, 0],
      [2, 0],
      [3, 2],
    ]);
  });

  it("groups sparsely rather than allocating from an index it cannot trust", () => {
    // A well-formed rule has at least one action per split, so an index beyond the action count
    // means the data is malformed. Filling to it would allocate an array of that size.
    const groups = groupActionsBySplitIndex([setPayee, child(9, "notes", "x")]);
    expect(groups.map((g) => g.index)).toEqual([0, 9]);
  });

  it("survives an oversized stored index instead of throwing RangeError", () => {
    // `RulesTable` previews every visible rule, so one bad row used to take out the whole page.
    const groups = groupActionsBySplitIndex([child(4294967295, "notes", "x")]);
    expect(groups.map((g) => [g.index, g.items.length])).toEqual([
      [0, 0],
      [4294967295, 1],
    ]);
  });

  it("groups editor parts through the accessor, preserving their client ids", () => {
    const wrapped = twoWaySplit.map((part, i) => ({ clientId: `c${i}`, part }));
    const groups = groupBySplitIndex(wrapped, (w) => w.part);
    expect(groups[1].items.map((w) => w.clientId)).toEqual(["c1", "c2"]);
    expect(groups[2].items.map((w) => w.clientId)).toEqual(["c3", "c4"]);
  });
});

describe("withSplitIndex", () => {
  it("sets an index while preserving the other options", () => {
    const action: ConditionOrAction = {
      op: "set",
      field: "notes",
      value: "",
      options: { formula: "=1" },
    };
    expect(withSplitIndex(action, 2).options).toEqual({ formula: "=1", splitIndex: 2 });
  });

  it("drops the key entirely for the parent, and drops options when nothing is left", () => {
    const action = child(1, "notes", "x");
    const parented = withSplitIndex(action, 0);
    expect(parented.options).toBeUndefined();
    expect("options" in parented).toBe(false);
  });

  it("keeps remaining options when clearing the index", () => {
    const action: ConditionOrAction = {
      op: "set",
      field: "notes",
      value: "",
      options: { template: "{{x}}", splitIndex: 1 },
    };
    expect(withSplitIndex(action, 0).options).toEqual({ template: "{{x}}" });
  });
});

describe("makeSplitAmountAction", () => {
  it("seeds a remainder child, as Actual does", () => {
    expect(makeSplitAmountAction(1)).toEqual({
      op: "set-split-amount",
      value: null,
      type: "number",
      options: { method: "remainder", splitIndex: 1 },
    });
  });

  it("accepts another method", () => {
    expect(makeSplitAmountAction(2, "fixed-amount").options?.method).toBe("fixed-amount");
  });
});

describe("removeSplitGroup", () => {
  it("drops the group and renumbers the ones above it so indices stay dense", () => {
    const threeWay = [
      ...twoWaySplit,
      { op: "set-split-amount", value: null, type: "number", options: { method: "remainder" as const, splitIndex: 3 } },
      child(3, "category", "c3"),
    ];
    const result = removeSplitGroup(threeWay, 1);
    expect(splitCount(result)).toBe(2);
    // The old split 2 became split 1, and the old split 3 became split 2.
    expect(result.filter((a) => splitIndexOf(a) === 1).map((a) => a.value)).toEqual([null, "c2"]);
    expect(result.filter((a) => splitIndexOf(a) === 2).map((a) => a.value)).toEqual([null, "c3"]);
  });

  it("leaves the parent group untouched", () => {
    expect(removeSplitGroup(twoWaySplit, 0)).toEqual(twoWaySplit);
  });

  it("removing the only split leaves a plain rule", () => {
    const oneWay = [setPayee, makeSplitAmountAction(1), child(1, "category", "c1")];
    const result = removeSplitGroup(oneWay, 1);
    expect(result).toEqual([setPayee]);
    expect(isSplitRule(result)).toBe(false);
  });
});

describe("hasDenseSplitIndices", () => {
  it("accepts 1..n and a rule with no splits at all", () => {
    expect(hasDenseSplitIndices(twoWaySplit)).toBe(true);
    expect(hasDenseSplitIndices([setPayee])).toBe(true);
  });

  it("rejects a gap and a run that does not start at 1", () => {
    expect(hasDenseSplitIndices([setPayee, child(1, "notes", "a"), child(3, "notes", "b")])).toBe(false);
    expect(hasDenseSplitIndices([setPayee, child(2, "notes", "a")])).toBe(false);
  });
});

describe("normalizeSplitIndices", () => {
  it("closes gaps left by malformed data", () => {
    const sparse = [setPayee, child(2, "category", "c1"), child(5, "category", "c2")];
    const result = normalizeSplitIndices(sparse);
    expect(result.map(splitIndexOf)).toEqual([0, 1, 2]);
  });

  it("is a no-op when the indices are already dense", () => {
    expect(normalizeSplitIndices(twoWaySplit)).toEqual(twoWaySplit);
  });
});

describe("hasValidSplitIndex", () => {
  it("accepts an absent index and any whole number from 0 up", () => {
    expect(hasValidSplitIndex(setPayee)).toBe(true);
    for (const splitIndex of [0, 1, 7]) {
      expect(hasValidSplitIndex({ ...setPayee, options: { splitIndex } })).toBe(true);
    }
  });

  it.each([-1, 1.5, Number.NaN])("rejects %p", (splitIndex) => {
    // `splitIndexOf` reads these as the parent, but the raw option survives into the saved rule,
    // and Actual's `execActions` branches on a *truthy* splitIndex — so -1 indexes the parent as
    // if it were a child, and 1.5 indexes a transaction that does not exist.
    expect(hasValidSplitIndex({ ...setPayee, options: { splitIndex } })).toBe(false);
  });
});
