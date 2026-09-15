import { filterGroupedOptions, type ComboboxOption } from "./combobox";

/*
 * A match on a group name has to mean different things depending on whether a
 * group can be picked.
 *
 * Where it is only a heading, returning it alone leaves a label with nothing
 * selectable under it. Where the group is itself a choice, returning its
 * children as well buries the row that was searched for under the eleven
 * categories that selecting it already covers.
 */
const OPTIONS: ComboboxOption[] = [
  { id: "group:food", name: "Food & Groceries", isGroupHeader: true },
  { id: "category:groceries", name: "Groceries & Household" },
  { id: "category:restaurants", name: "Restaurants & Cafes" },
  { id: "group:transport", name: "Transport", isGroupHeader: true },
  { id: "category:fuel", name: "Fuel" },
];

describe("filterGroupedOptions", () => {
  it("returns everything for an empty search", () => {
    expect(filterGroupedOptions(OPTIONS, "  ")).toEqual(OPTIONS);
  });

  it("brings a matched group's children along when groups are only headings", () => {
    const result = filterGroupedOptions(OPTIONS, "food").map((o) => o.id);
    expect(result).toEqual(["group:food", "category:groceries", "category:restaurants"]);
  });

  it("returns a matched group alone when groups are selectable", () => {
    const result = filterGroupedOptions(OPTIONS, "food", true).map((o) => o.id);
    expect(result).toEqual(["group:food"]);
  });

  it("still returns children that match on their own name", () => {
    // "Groceries" matches the Food group and one of its categories, so the
    // category earns its place rather than being carried in by the group.
    const result = filterGroupedOptions(OPTIONS, "groceries", true).map((o) => o.id);
    expect(result).toEqual(["group:food", "category:groceries"]);
  });

  it("pairs a matching child with its heading when the group does not match", () => {
    expect(filterGroupedOptions(OPTIONS, "fuel", true).map((o) => o.id)).toEqual([
      "group:transport",
      "category:fuel",
    ]);
    expect(filterGroupedOptions(OPTIONS, "fuel").map((o) => o.id)).toEqual([
      "group:transport",
      "category:fuel",
    ]);
  });

  it("drops groups whose name and children both miss", () => {
    expect(filterGroupedOptions(OPTIONS, "zzz", true)).toEqual([]);
  });
});
