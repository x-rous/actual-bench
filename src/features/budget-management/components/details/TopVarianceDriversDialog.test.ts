import {
  matchesDriverSearch,
  narrowChildrenToSearch,
} from "./TopVarianceDriversDialog";
import type { VarianceGroup } from "../../lib/varianceDrivers";

/*
 * The search runs over a two-level list, and a category is only reachable
 * through the group holding it. Matching groups alone would miss the row most
 * searches are actually after; dropping a matched child's group would find the
 * row and then hide it.
 */
const group = (name: string, children: string[]): VarianceGroup =>
  ({
    id: name,
    name,
    budgetedMinor: 0,
    actualMinor: 0,
    varianceMinor: 0,
    favourable: true,
    pctOfBudget: null,
    contribution: null,
    monthly: [],
    children: children.map((child) => ({
      id: child,
      name: child,
      budgetedMinor: 0,
      actualMinor: 0,
      varianceMinor: 0,
      favourable: true,
      pctOfBudget: null,
      contribution: null,
    })),
  }) as VarianceGroup;

const food = group("Food & Groceries", ["Restaurants", "Groceries"]);

describe("matchesDriverSearch", () => {
  it("keeps everything when nothing is typed", () => {
    expect(matchesDriverSearch(food, "")).toBe(true);
    expect(matchesDriverSearch(food, "   ")).toBe(true);
  });

  it("matches on the group's own name", () => {
    expect(matchesDriverSearch(food, "food")).toBe(true);
  });

  it("keeps a group whose child matches, since the child needs it to be shown", () => {
    expect(matchesDriverSearch(food, "restaurants")).toBe(true);
  });

  it("drops a group when neither it nor its children match", () => {
    expect(matchesDriverSearch(food, "transport")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(matchesDriverSearch(food, "  GROCERIES  ")).toBe(true);
  });
});

/*
 * Keeping a matched child's group was only ever about reachability - a category
 * is shown through its parent. Keeping the group's other children with it meant
 * a search for one category listed its siblings underneath, which is a hit the
 * search never found.
 */
describe("narrowChildrenToSearch", () => {
  it("keeps only the children that matched", () => {
    const result = narrowChildrenToSearch(food, "restaurants");
    expect(result.children.map((c) => c.name)).toEqual(["Restaurants"]);
  });

  it("keeps every child when the group itself matched", () => {
    // There the match is the group, and its contents are what was asked for.
    const result = narrowChildrenToSearch(food, "food");
    expect(result.children.map((c) => c.name)).toEqual(["Restaurants", "Groceries"]);
  });

  it("returns the group untouched when nothing is typed", () => {
    expect(narrowChildrenToSearch(food, "  ")).toBe(food);
  });

  it("returns the same object when every child matched, rather than a copy", () => {
    // Identity matters here: the view memoises on these, and a fresh object
    // every keystroke would rebuild rows that did not change.
    expect(narrowChildrenToSearch(food, "e")).toBe(food);
  });
});
