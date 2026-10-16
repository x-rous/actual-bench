import {
  buildAccountOptions,
  buildCategoryGroupOptions,
  buildCategoryOptions,
  buildPayeeOptions,
} from "./entity-options";
import type { ComboboxOption } from "./combobox";

/** Each row as text: headings marked, items with their marker. */
const shape = (options: ComboboxOption[]) =>
  options.map((o) =>
    o.section ? `## ${o.name}` : o.isGroupHeader ? `# ${o.name}` : `${o.name}${o.trailing ? ` (${o.trailing})` : ""}`
  );

describe("buildAccountOptions", () => {
  const groups = [
    { id: "g-cards", name: "Cards" },
    { id: "g-savings", name: "Savings" },
  ];
  const accounts = [
    { id: "a1", name: "Visa", offBudget: false, closed: false, groupId: "g-cards" },
    { id: "a2", name: "Checking", offBudget: false, closed: false },
    { id: "a3", name: "Old card", offBudget: false, closed: true, groupId: "g-cards" },
    { id: "a4", name: "House", offBudget: true, closed: false },
    { id: "a5", name: "Pension", offBudget: true, closed: false, groupId: "g-savings" },
  ];

  it("groups by budget side, then account group, ungrouped first, in the given order", () => {
    expect(shape(buildAccountOptions(accounts, groups))).toEqual([
      "## On budget",
      "Checking",
      "# Cards",
      "Visa",
      "Old card (closed)",
      "## Off budget",
      "House",
      "# Savings",
      "Pension",
    ]);
  });

  it("dims closed accounts by default, and can disable or drop them", () => {
    const closed = (mode: "dim" | "disable" | "exclude") =>
      buildAccountOptions(accounts, groups, { closed: mode }).find((o) => o.id === "a3");
    expect(closed("dim")).toMatchObject({ hidden: true, disabled: false });
    expect(closed("disable")).toMatchObject({ hidden: false, disabled: true });
    expect(closed("exclude")).toBeUndefined();
  });

  it("restricts by budget side, exclusions and a custom filter", () => {
    const ids = buildAccountOptions(accounts, groups, {
      budget: "off",
      exclude: ["a4"],
      filter: (a) => a.name !== "Nothing",
    })
      .filter((o) => !o.isGroupHeader)
      .map((o) => o.id);
    expect(ids).toEqual(["a5"]);
  });

  it("is flat for accounts without a budget status", () => {
    expect(shape(buildAccountOptions([{ id: "x", name: "Offset account 1" }]))).toEqual(["Offset account 1"]);
  });
});

describe("buildCategoryOptions", () => {
  const groups = [
    { id: "g-bills", name: "Bills", isIncome: false, hidden: false, categoryIds: ["c2", "c1"] },
    { id: "g-old", name: "Old", isIncome: false, hidden: true, categoryIds: ["c3"] },
    { id: "g-income", name: "Income", isIncome: true, hidden: false, categoryIds: ["c4"] },
  ];
  const categories = [
    { id: "c1", name: "Rent", groupId: "g-bills", isIncome: false, hidden: false },
    { id: "c2", name: "Power", groupId: "g-bills", isIncome: false, hidden: false },
    { id: "c3", name: "Gym", groupId: "g-old", isIncome: false, hidden: false },
    { id: "c4", name: "Salary", groupId: "g-income", isIncome: true, hidden: false },
  ];

  it("groups by expense / income, then category group, in each group's own order", () => {
    expect(shape(buildCategoryOptions(categories, groups))).toEqual([
      "## Expense",
      "# Bills",
      "Power",
      "Rent",
      "# Old",
      "Gym (hidden)",
      "## Income",
      "# Income",
      "Salary",
    ]);
  });

  it("restricts by side and drops hidden ones (a hidden group's included)", () => {
    expect(shape(buildCategoryOptions(categories, groups, { side: "expense", hidden: "exclude" }))).toEqual([
      "## Expense",
      "# Bills",
      "Power",
      "Rent",
    ]);
  });

  it("groups by name where only names are known", () => {
    const named = [
      { id: "c1", name: "Rent", groupName: "Bills", isIncome: false },
      { id: "c2", name: "Salary", groupName: "Income", isIncome: true },
    ];
    expect(shape(buildCategoryOptions(named))).toEqual(["## Expense", "# Bills", "Rent", "## Income", "# Income", "Salary"]);
  });

  it("puts a feature's own text at the end of a row", () => {
    const options = buildCategoryOptions(categories, groups, { trailing: (c) => `#${c.id}` });
    expect(options.find((o) => o.id === "c1")?.trailing).toBe("#c1");
  });
});

describe("buildCategoryGroupOptions", () => {
  it("lists groups under expense / income", () => {
    const groups = [
      { id: "g1", name: "Bills", isIncome: false, hidden: false },
      { id: "g2", name: "Income", isIncome: true, hidden: false },
    ];
    expect(shape(buildCategoryGroupOptions(groups))).toEqual(["## Expense", "Bills", "## Income", "Income"]);
  });
});

describe("buildPayeeOptions", () => {
  const payees = [
    { id: "p1", name: "Zoo" },
    { id: "p2", name: "Checking", transferAccountId: "a1" },
    { id: "p3", name: "Apple" },
  ];

  it("is one alphabetical list with transfer payees marked", () => {
    expect(shape(buildPayeeOptions(payees))).toEqual(["Apple", "Checking (transfer)", "Zoo"]);
  });

  it("can leave transfer payees out", () => {
    expect(shape(buildPayeeOptions(payees, { transfers: "exclude" }))).toEqual(["Apple", "Zoo"]);
  });
});
