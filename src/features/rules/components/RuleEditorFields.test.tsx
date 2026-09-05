/**
 * WCAG 2.5.3 (Label in Name): where a control has visible text, its accessible name must contain
 * that text, or someone using speech input cannot activate it by saying what they can see.
 * These buttons carry extra context in their labels, so the visible text has to lead.
 */

import { render, screen } from "@testing-library/react";
import { RuleEditorFields } from "./RuleEditorFields";
import type { EditorPart, RuleDraftValidation, RuleEntityOptionsMap } from "../lib/ruleEditor";
import type { ConditionOrAction } from "@/types/entities";

const entityOptions: RuleEntityOptionsMap = {
  payee: [{ id: "p1", name: "Costco" }],
  category: [{ id: "c1", name: "Groceries" }],
  account: [],
  categoryGroup: [],
};

const noErrors: RuleDraftValidation = {
  formErrors: [],
  conditionErrors: [],
  actionErrors: [],
  warnings: [],
};

function part(clientId: string, p: ConditionOrAction): EditorPart {
  return { clientId, part: p };
}

function renderFields(actions: EditorPart[]) {
  render(
    <RuleEditorFields
      stage="default"
      conditionsOp="and"
      conditions={[part("c", { field: "payee", op: "is", value: "p1", type: "id" })]}
      actions={actions}
      entityOptions={entityOptions}
      validation={noErrors}
      showValidation={false}
      touchedConditionIds={new Set()}
      touchedActionIds={new Set()}
      onStageChange={() => {}}
      onConditionsOpChange={() => {}}
      onAddCondition={() => {}}
      onAddAction={() => {}}
      onAddSplit={() => {}}
      onRemoveSplit={() => {}}
      onConditionChange={() => {}}
      onConditionDelete={() => {}}
      onConditionTouched={() => {}}
      onActionChange={() => {}}
      onActionDelete={() => {}}
      onActionTouched={() => {}}
    />
  );
}

/** The accessible name must contain the visible text, per WCAG 2.5.3. */
function expectLabelInName(visibleText: string) {
  const button = screen.getByRole("button", { name: new RegExp(visibleText, "i") });
  expect(button.textContent).toContain(visibleText);
  expect(button.getAttribute("aria-label") ?? button.textContent ?? "").toContain(visibleText);
}

describe("RuleEditorFields button labels", () => {
  const splitActions = [
    part("a0", { op: "set", field: "payee", value: "p1", type: "id" }),
    part("a1", {
      op: "set-split-amount",
      value: null,
      options: { method: "remainder", splitIndex: 1 },
    }),
    part("a2", { op: "set", field: "category", value: "c1", type: "id", options: { splitIndex: 1 } }),
  ];

  it("keeps the visible text inside the accessible name for Add split", () => {
    renderFields(splitActions);
    expectLabelInName("Add split");
  });

  it("keeps it for the per-group Add action buttons", () => {
    renderFields(splitActions);
    const addActions = screen.getAllByRole("button", { name: /Add action/i });
    expect(addActions.length).toBeGreaterThan(1);
    for (const button of addActions) {
      expect(button.getAttribute("aria-label") ?? "").toContain("Add action");
    }
  });

  it("labels a split group and its remove control", () => {
    renderFields(splitActions);
    expect(screen.getByRole("region", { name: "Split 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove split 1" })).toBeInTheDocument();
  });
});
