import { matchesDriverSearch } from "./TopVarianceDriversDialog";
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
