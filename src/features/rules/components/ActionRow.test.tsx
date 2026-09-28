/**
 * The action row owns `op`, `field`, `value`, and the template/formula mode keys. Everything else
 * on `options` belongs to the rule, and changing the operator or the field must not discard it —
 * that is how a split index used to disappear when a user retyped an unrelated value.
 */

import { chooseSelectOption } from "@/components/ui/select.testing";
import { fireEvent, render, screen } from "@testing-library/react";
import { ActionRow } from "./ActionRow";
import type { ConditionOrAction } from "@/types/entities";
import type { RuleEntityOptionsMap } from "../lib/ruleEditor";

const entityOptions: RuleEntityOptionsMap = {
  payee: [{ id: "p1", name: "Costco" }],
  category: [{ id: "c1", name: "Groceries" }],
  account: [{ id: "a1", name: "Checking" }],
  categoryGroup: [],
};

function renderRow(action: ConditionOrAction) {
  const onChange = jest.fn();
  render(
    <ActionRow
      action={action}
      entityOptions={entityOptions}
      onChange={onChange}
      onDelete={() => {}}
    />
  );
  return onChange;
}

describe("ActionRow preserves options it does not own", () => {
  it("keeps the split index when the field changes", async () => {
    const onChange = renderRow({
      op: "set",
      field: "category",
      value: "c1",
      type: "id",
      options: { splitIndex: 2 },
    });

    await chooseSelectOption(screen.getByLabelText("Action field"), "Notes");

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({
      field: "notes",
      op: "set",
      options: { splitIndex: 2 },
    });
  });

  it("keeps the split index when the operator changes", async () => {
    const onChange = renderRow({
      op: "set",
      field: "notes",
      value: "x",
      type: "string",
      options: { splitIndex: 1 },
    });

    await chooseSelectOption(screen.getByLabelText("Action type"), "Append to Notes");

    expect(onChange.mock.calls[0][0]).toMatchObject({
      op: "append-notes",
      options: { splitIndex: 1 },
    });
  });

  it("clears template mode on a field change, since that key is the row's own", async () => {
    const onChange = renderRow({
      op: "set",
      field: "notes",
      value: "",
      type: "string",
      options: { template: "{{payee}}", splitIndex: 1 },
    });

    await chooseSelectOption(screen.getByLabelText("Action field"), "Payee Name");

    const next = onChange.mock.calls[0][0];
    expect(next.options).toEqual({ splitIndex: 1 });
  });

  it("drops options entirely when nothing is left to carry", async () => {
    const onChange = renderRow({
      op: "set",
      field: "notes",
      value: "",
      type: "string",
      options: { formula: "=1" },
    });

    await chooseSelectOption(screen.getByLabelText("Action field"), "Payee Name");

    expect(onChange.mock.calls[0][0].options).toBeUndefined();
  });

  it("offers only the split-safe fields inside a split", async () => {
    renderRow({
      op: "set",
      field: "category",
      value: "c1",
      type: "id",
      options: { splitIndex: 1 },
    });

    fireEvent.click(screen.getByLabelText("Action field"));
    const offered = (await screen.findAllByRole("option")).map((option) => option.textContent);
    expect(offered).toEqual(["Category", "Payee", "Payee Name", "Notes"]);
  });
});
