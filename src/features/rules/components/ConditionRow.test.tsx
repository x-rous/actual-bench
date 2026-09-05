/**
 * The condition row's value editor changes shape with the field and the operator, so its
 * accessible name has to come from the row rather than from any one input's markup. A screen
 * reader reaching the value control otherwise finds an unlabelled text box.
 */

import { render, screen } from "@testing-library/react";
import { ConditionRow, formatTagValue, parseTagValue } from "./ConditionRow";
import type { ConditionOrAction } from "@/types/entities";
import type { RuleEntityOptionsMap } from "../lib/ruleEditor";

const entityOptions: RuleEntityOptionsMap = {
  payee: [{ id: "p1", name: "Costco" }],
  category: [{ id: "c1", name: "Groceries" }],
  account: [{ id: "a1", name: "Checking" }],
  categoryGroup: [],
};

function renderRow(condition: ConditionOrAction) {
  render(
    <ConditionRow
      condition={condition}
      entityOptions={entityOptions}
      onChange={() => {}}
      onDelete={() => {}}
    />
  );
}

describe("ConditionRow accessible names", () => {
  it.each<[string, ConditionOrAction, string]>([
    ["date", { field: "date", op: "gt", value: "2026-01-01", type: "date" }, "Date value"],
    ["number", { field: "amount", op: "gt", value: 10, type: "number" }, "Amount value"],
    ["boolean", { field: "cleared", op: "is", value: true, type: "boolean" }, "Cleared value"],
    ["regex", { field: "notes", op: "matches", value: "^a", type: "string" }, "Notes value"],
    ["text", { field: "notes", op: "contains", value: "a", type: "string" }, "Notes value"],
    ["tags", { field: "notes", op: "hasTags", value: "#food", type: "string" }, "Notes value"],
  ])("names the %s value control", (_kind, condition, label) => {
    renderRow(condition);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it("names both ends of an amount range separately", () => {
    renderRow({ field: "amount", op: "isbetween", value: { num1: 1, num2: 2 }, type: "number" });
    expect(screen.getByLabelText("Amount value from")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount value to")).toBeInTheDocument();
  });

  it("names the field and operator selects", () => {
    renderRow({ field: "notes", op: "contains", value: "a", type: "string" });
    expect(screen.getByLabelText("Condition field")).toBeInTheDocument();
    expect(screen.getByLabelText("Condition operator")).toBeInTheDocument();
  });

  it("renders no value control at all for a valueless operator", () => {
    renderRow({ field: "account", op: "onBudget", value: "" });
    expect(screen.queryByLabelText("Account value")).not.toBeInTheDocument();
  });

  it("shows an amount condition with inflow options as its own field", () => {
    renderRow({ field: "amount", op: "gt", value: 10, type: "number", options: { inflow: true } });
    const select = screen.getByLabelText("Condition field") as HTMLSelectElement;
    expect(select.value).toBe("amount-inflow");
    expect(screen.getByLabelText("Amount (inflow) value")).toBeInTheDocument();
  });
});

describe("tag values", () => {
  it("tokenizes whitespace so the chips and the stored value agree", () => {
    // Actual splits the stored string on whitespace regardless (`/#*([^#\s]+)/g`), so a chip
    // holding "food travel" would silently become two tags.
    expect(formatTagValue(["food travel"])).toBe("#food #travel");
    expect(formatTagValue(["#food", "travel"])).toBe("#food #travel");
    expect(formatTagValue(["  spaced  out  "])).toBe("#spaced #out");
  });

  it("drops duplicates and empties", () => {
    expect(formatTagValue(["food", "food", "", "  "])).toBe("#food");
    expect(formatTagValue([])).toBe("");
  });

  it("round-trips through parseTagValue", () => {
    const stored = formatTagValue(["food travel", "home"]);
    expect(parseTagValue(stored)).toEqual(["food", "travel", "home"]);
    expect(formatTagValue(parseTagValue(stored))).toBe(stored);
  });
});
