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

  it("shows 'Deleted schedule' for link-schedule when schedule is missing", () => {
    const action: ConditionOrAction = { field: "schedule", op: "link-schedule", value: "sched-gone", type: "id" };
    const mapsWithSchedules: EntityMaps = { ...emptyMaps, schedules: {} };
    render(<ActionChip action={action} maps={mapsWithSchedules} />);
    expect(screen.getByText("[deleted schedule]")).toBeInTheDocument();
    expect(screen.queryByText("sched-gone")).not.toBeInTheDocument();
  });
});
