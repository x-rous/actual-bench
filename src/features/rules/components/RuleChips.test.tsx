import { render, screen } from "@testing-library/react";
import { ConditionChip, ActionChip } from "./RuleChips";
import type { EntityMaps } from "../utils/rulePreview";
import type { ConditionOrAction } from "@/types/entities";

function makeStagedEntity<T extends { id: string; name: string }>(entity: T) {
  return {
    entity,
    original: null,
    isNew: false,
    isUpdated: false,
    isDeleted: false,
    validationErrors: {},
    saveError: undefined,
  };
}

const payeeAlice = makeStagedEntity({ id: "p1", name: "Alice" });
const categoryFood = makeStagedEntity({ id: "c1", name: "Food", groupId: "g1", isIncome: false, hidden: false });
const accountChecking = makeStagedEntity({ id: "a1", name: "Checking", offBudget: false, closed: false });
const groupGroceries = makeStagedEntity({ id: "g1", name: "Groceries", isIncome: false, hidden: false, categoryIds: [] });
const scheduleRent = makeStagedEntity({ id: "s1", name: "Rent", completed: false, postsTransaction: true });

const fullMaps: EntityMaps = {
  payees: { p1: payeeAlice },
  categories: { c1: categoryFood },
  accounts: { a1: accountChecking },
  categoryGroups: {},
};

const emptyMaps: EntityMaps = {
  payees: {},
  categories: {},
  accounts: {},
  categoryGroups: {},
};

describe("ConditionChip — missing entity references", () => {
  it("shows payee name when entity exists", () => {
    const condition: ConditionOrAction = { field: "payee", op: "is", value: "p1", type: "id" };
    render(<ConditionChip condition={condition} maps={fullMaps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows 'Deleted payee' instead of UUID when payee is missing", () => {
    const condition: ConditionOrAction = { field: "payee", op: "is", value: "unknown-uuid", type: "id" };
    render(<ConditionChip condition={condition} maps={emptyMaps} />);
    expect(screen.getByText("[deleted payee]")).toBeInTheDocument();
    expect(screen.queryByText("unknown-uuid")).not.toBeInTheDocument();
  });

  it("shows 'Deleted payee' when payee is staged as deleted", () => {
    const deletedMaps: EntityMaps = {
      ...emptyMaps,
      payees: { p1: { ...payeeAlice, isDeleted: true } },
    };
    const condition: ConditionOrAction = { field: "payee", op: "is", value: "p1", type: "id" };
    render(<ConditionChip condition={condition} maps={deletedMaps} />);
    expect(screen.getByText("[deleted payee]")).toBeInTheDocument();
  });

  it("shows 'Deleted category' instead of UUID when category is missing", () => {
    const condition: ConditionOrAction = { field: "category", op: "is", value: "gone-uuid", type: "id" };
    render(<ConditionChip condition={condition} maps={emptyMaps} />);
    expect(screen.getByText("[deleted category]")).toBeInTheDocument();
    expect(screen.queryByText("gone-uuid")).not.toBeInTheDocument();
  });

  it("shows 'Deleted account' instead of UUID when account is missing", () => {
    const condition: ConditionOrAction = { field: "account", op: "is", value: "gone-uuid", type: "id" };
    render(<ConditionChip condition={condition} maps={emptyMaps} />);
    expect(screen.getByText("[deleted account]")).toBeInTheDocument();
  });

  it("shows '[deleted group]' instead of UUID when category group is missing", () => {
    const condition: ConditionOrAction = { field: "category_group", op: "is", value: "gone-uuid", type: "id" };
    render(<ConditionChip condition={condition} maps={emptyMaps} />);
    expect(screen.getByText("[deleted group]")).toBeInTheDocument();
    expect(screen.queryByText("gone-uuid")).not.toBeInTheDocument();
  });
});

describe("ActionChip — missing entity references", () => {
  it("shows payee name when entity exists", () => {
    const action: ConditionOrAction = { field: "payee", op: "set", value: "p1", type: "id" };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("shows 'Deleted payee' instead of UUID when payee action target is missing", () => {
    const action: ConditionOrAction = { field: "payee", op: "set", value: "ghost-uuid", type: "id" };
    render(<ActionChip action={action} maps={emptyMaps} />);
    expect(screen.getByText("[deleted payee]")).toBeInTheDocument();
    expect(screen.queryByText("ghost-uuid")).not.toBeInTheDocument();
  });

  it("shows '[deleted schedule]' for link-schedule when schedule is missing", () => {
    const action: ConditionOrAction = { field: "schedule", op: "link-schedule", value: "sched-gone", type: "id" };
    const mapsWithSchedules: EntityMaps = { ...emptyMaps, schedules: {} };
    render(<ActionChip action={action} maps={mapsWithSchedules} />);
    expect(screen.getByText("[deleted schedule]")).toBeInTheDocument();
    expect(screen.queryByText("sched-gone")).not.toBeInTheDocument();
  });

  it("shows '[deleted schedule]' for link-schedule when schedule is staged as deleted", () => {
    const action: ConditionOrAction = { field: "schedule", op: "link-schedule", value: "s1", type: "id" };
    const mapsWithDeletedSchedule: EntityMaps = {
      ...emptyMaps,
      schedules: { s1: { ...scheduleRent, isDeleted: true } },
    };
    render(<ActionChip action={action} maps={mapsWithDeletedSchedule} />);
    expect(screen.getByText("[deleted schedule]")).toBeInTheDocument();
    expect(screen.queryByText("Rent")).not.toBeInTheDocument();
  });
});

// ─── Splits, inflow/outflow and friendly operators (PR-051) ───────────────────

describe("ActionChip — allocations", () => {
  it("shows the method and percentage for a fixed-percent split", () => {
    const action: ConditionOrAction = {
      op: "set-split-amount",
      value: 25,
      type: "number",
      options: { method: "fixed-percent", splitIndex: 1 },
    };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("Split 1")).toBeInTheDocument();
    expect(screen.getByText("allocate")).toBeInTheDocument();
    expect(screen.getByText("a fixed percent of the remainder")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows a fixed amount to two decimal places", () => {
    const action: ConditionOrAction = {
      op: "set-split-amount",
      value: 12.5,
      type: "number",
      options: { method: "fixed-amount", splitIndex: 2 },
    };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("12.50")).toBeInTheDocument();
  });

  it("shows no value for a remainder split", () => {
    const action: ConditionOrAction = {
      op: "set-split-amount",
      value: null,
      type: "number",
      options: { method: "remainder", splitIndex: 1 },
    };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("an equal portion of the remainder")).toBeInTheDocument();
  });

  it("flags an allocation with no method rather than rendering it as valid", () => {
    const action: ConditionOrAction = {
      op: "set-split-amount",
      value: null,
      options: { splitIndex: 1 },
    };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("no method set")).toBeInTheDocument();
  });

  it("marks an ordinary action that belongs to a split", () => {
    const action: ConditionOrAction = {
      op: "set",
      field: "category",
      value: "c1",
      type: "id",
      options: { splitIndex: 2 },
    };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.getByText("Split 2")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
  });

  it("leaves a parent action unmarked", () => {
    const action: ConditionOrAction = { op: "set", field: "category", value: "c1", type: "id" };
    render(<ActionChip action={action} maps={fullMaps} />);
    expect(screen.queryByText(/^Split /)).not.toBeInTheDocument();
  });
});

describe("ConditionChip — inflow/outflow and operator labels", () => {
  it("names an amount condition with inflow options as its own field", () => {
    const condition: ConditionOrAction = {
      field: "amount",
      op: "gt",
      value: 10,
      type: "number",
      options: { inflow: true },
    };
    render(<ConditionChip condition={condition} maps={fullMaps} />);
    expect(screen.getByText("Amount (inflow)")).toBeInTheDocument();
    expect(screen.getByText("is greater than")).toBeInTheDocument();
  });

  it("reads a date comparison as before/after, the way Actual labels it", () => {
    const condition: ConditionOrAction = {
      field: "date",
      op: "gt",
      value: "2026-01-01",
      type: "date",
    };
    render(<ConditionChip condition={condition} maps={fullMaps} />);
    expect(screen.getByText("is after")).toBeInTheDocument();
  });
});
