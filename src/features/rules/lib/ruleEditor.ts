"use client";

import { generateId } from "@/lib/uuid";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ConditionOrAction, ConditionsOp, Rule, RuleStage } from "@/types/entities";
import {
  ACTION_FIELDS,
  ACTION_OPS,
  CONDITION_FIELDS,
  PARENT_ONLY_ACTION_FIELDS,
  getConditionOps,
  isAllocationMethod,
} from "../utils/ruleFields";
import {
  groupActionsBySplitIndex,
  isSplitAmountAction,
  isSplitRule,
  splitIndexOf,
} from "./splitActions";

export type RuleEntityType = "payee" | "category" | "account" | "categoryGroup";

export type RuleEntityOptionsMap = Record<RuleEntityType, ComboboxOption[]>;

export type EditorPart = {
  clientId: string;
  part: ConditionOrAction;
};

export type RuleDraft = {
  stage: RuleStage;
  conditionsOp: ConditionsOp;
  conditions: EditorPart[];
  actions: EditorPart[];
};

export type RuleDraftValidation = {
  formErrors: string[];
  conditionErrors: string[][];
  actionErrors: string[][];
  warnings: string[];
};

export function createEditorPart(part: ConditionOrAction): EditorPart {
  return {
    clientId: generateId(),
    part: structuredClone(part),
  };
}

export function createEditorParts(parts: ConditionOrAction[]): EditorPart[] {
  return parts.map(createEditorPart);
}

export function stripEditorParts(parts: EditorPart[]): ConditionOrAction[] {
  return parts.map((entry) => structuredClone(entry.part));
}

function serializeRuleParts(
  stage: RuleStage,
  conditionsOp: ConditionsOp,
  conditions: ConditionOrAction[],
  actions: ConditionOrAction[]
): string {
  return JSON.stringify({
    stage,
    conditionsOp,
    conditions,
    actions,
  });
}

export function serializeRuleDraft(draft: RuleDraft): string {
  return serializeRuleParts(
    draft.stage,
    draft.conditionsOp,
    stripEditorParts(draft.conditions),
    stripEditorParts(draft.actions)
  );
}

export function serializeRule(rule: Pick<Rule, "stage" | "conditionsOp" | "conditions" | "actions">): string {
  return serializeRuleParts(rule.stage, rule.conditionsOp, rule.conditions, rule.actions);
}

function isBlankString(value: string): boolean {
  return value.trim() === "";
}

function isEmptyArrayValue(value: string[]): boolean {
  return value.length === 0 || value.some((entry) => isBlankString(entry));
}

function isInvalidNumber(value: ConditionOrAction["value"]): boolean {
  if (value === "") return true;
  return typeof value !== "number" || Number.isNaN(value);
}

function isValidBooleanValue(value: ConditionOrAction["value"]): boolean {
  return value === true || value === false || value === "true" || value === "false";
}

function isInvalidRangeValue(value: ConditionOrAction["value"]): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  if (!("num1" in value) || !("num2" in value)) return true;
  return !(
    typeof value.num1 === "number" &&
    typeof value.num2 === "number" &&
    Number.isFinite(value.num1) &&
    Number.isFinite(value.num2)
  );
}

function isRecurConfigValue(value: ConditionOrAction["value"]): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "frequency" in value
  );
}

function hasValidRequiredValue(
  part: ConditionOrAction,
  fieldDef: { type: "string" | "id" | "number" | "date" | "boolean"; supportsTemplate?: boolean; supportsFormula?: boolean }
): boolean {
  if (part.options?.template !== undefined) {
    return fieldDef.supportsTemplate === true && !isBlankString(part.options.template);
  }

  if (part.options?.formula !== undefined) {
    return fieldDef.supportsFormula === true && !isBlankString(part.options.formula);
  }

  if (Array.isArray(part.value)) {
    return !isEmptyArrayValue(part.value.map(String));
  }

  if (fieldDef.type === "number") {
    if (part.op === "isbetween") {
      return !isInvalidRangeValue(part.value);
    }
    return !isInvalidNumber(part.value);
  }

  if (fieldDef.type === "boolean") {
    return isValidBooleanValue(part.value);
  }

  if (fieldDef.type === "date" && isRecurConfigValue(part.value)) {
    return true;
  }

  if (typeof part.value !== "string") return false;
  return !isBlankString(part.value);
}

function validateConditionPart(part: ConditionOrAction, index: number): string[] {
  const errors: string[] = [];
  const field = part.field ?? "";
  const fieldDef = CONDITION_FIELDS[field];

  // `amount-inflow` / `amount-outflow` are display-only: they are stored as `amount` plus
  // options, so seeing one here means something wrote the pseudo-field to the wire.
  if (!fieldDef || fieldDef.pseudoFor) {
    errors.push(`Condition ${index + 1}: select a valid field.`);
    return errors;
  }

  const { inflow, outflow } = part.options ?? {};
  if ((inflow || outflow) && field !== "amount") {
    errors.push(`Condition ${index + 1}: inflow/outflow only apply to an amount condition.`);
  }
  if (inflow && outflow) {
    errors.push(`Condition ${index + 1}: choose inflow or outflow, not both.`);
  }

  const opDefs = getConditionOps(field);
  const opDef = opDefs[part.op];
  if (!opDef) {
    errors.push(`Condition ${index + 1}: select a valid operator.`);
    return errors;
  }

  if (opDef.hasValue && !hasValidRequiredValue(part, fieldDef)) {
    errors.push(`Condition ${index + 1}: enter a valid value.`);
  }

  return errors;
}

/**
 * A `set-split-amount` action has no field: what it needs instead is a method, and a value whose
 * shape depends on that method. `fixed-percent` is a percentage, never a money amount.
 */
function validateSplitAmountAction(part: ConditionOrAction, index: number): string[] {
  const errors: string[] = [];
  const method = part.options?.method;

  if (!isAllocationMethod(method)) {
    errors.push(`Action ${index + 1}: choose how this split's amount is calculated.`);
    return errors;
  }

  switch (method) {
    case "fixed-amount":
      if (isInvalidNumber(part.value)) {
        errors.push(`Action ${index + 1}: enter an amount for this split.`);
      }
      break;
    case "fixed-percent":
      if (isInvalidNumber(part.value)) {
        errors.push(`Action ${index + 1}: enter a percentage for this split.`);
      } else if (typeof part.value === "number" && (part.value < 0 || part.value > 100)) {
        errors.push(`Action ${index + 1}: percentage must be between 0 and 100.`);
      }
      break;
    case "formula": {
      const formula = part.options?.formula;
      if (formula === undefined || isBlankString(formula)) {
        errors.push(`Action ${index + 1}: enter a formula for this split.`);
      } else if (!formula.trim().startsWith("=")) {
        errors.push(`Action ${index + 1}: formula must start with =`);
      }
      break;
    }
    case "remainder":
      break;
  }

  return errors;
}

function validateActionPart(part: ConditionOrAction, index: number): string[] {
  const errors: string[] = [];

  if (part.op === "link-schedule") return errors;

  const opDef = ACTION_OPS[part.op];
  if (!opDef) {
    errors.push(`Action ${index + 1}: select a valid action.`);
    return errors;
  }

  if (part.op === "delete-transaction") return errors;
  if (part.op === "set-split-amount") return validateSplitAmountAction(part, index);

  if (splitIndexOf(part) > 0 && PARENT_ONLY_ACTION_FIELDS.has(part.field ?? "")) {
    errors.push(
      `Action ${index + 1}: ${ACTION_FIELDS[part.field ?? ""]?.label ?? part.field} can only be set on the whole transaction, not on a split.`
    );
  }

  const field = part.field ?? "";
  const fieldDef = ACTION_FIELDS[field];
  if (!fieldDef) {
    errors.push(`Action ${index + 1}: select a valid field.`);
    return errors;
  }

  if (opDef.hasValue && !hasValidRequiredValue(part, fieldDef)) {
    errors.push(`Action ${index + 1}: enter a valid value.`);
  }

  // Formula-specific: must start with "="
  if (
    part.options?.formula !== undefined &&
    !isBlankString(part.options.formula) &&
    !part.options.formula.trim().startsWith("=")
  ) {
    errors.push(`Action ${index + 1}: formula must start with =`);
  }

  return errors;
}

/**
 * Group-level rules for a split rule. Per-action problems are reported by `validateActionPart`;
 * these are the ones only visible across a whole split group.
 */
function validateSplitStructure(actions: ConditionOrAction[]): string[] {
  if (!isSplitRule(actions)) return [];

  const errors: string[] = [];
  const groups = groupActionsBySplitIndex(actions);

  for (const group of groups) {
    if (group.index === 0) continue;

    const splitAmounts = group.items.filter(isSplitAmountAction);
    if (group.items.length === 0) {
      // Only reachable from stored data with a gap in its indices.
      errors.push(`Split ${group.index} is empty. Remove it, or move an action into it.`);
    } else if (splitAmounts.length === 0) {
      errors.push(`Split ${group.index} needs an amount: choose how much of the transaction it takes.`);
    } else if (splitAmounts.length > 1) {
      errors.push(`Split ${group.index} has ${splitAmounts.length} amounts. A split can only have one.`);
    }
  }

  const orphanSplitAmounts = groups[0].items.filter(isSplitAmountAction).length;
  if (orphanSplitAmounts > 0) {
    errors.push("An allocation must belong to a split, not to the whole transaction.");
  }

  return errors;
}

export function validateRuleDraft(draft: RuleDraft): RuleDraftValidation {
  const conditions = stripEditorParts(draft.conditions);
  const actions = stripEditorParts(draft.actions);

  const formErrors: string[] = [];
  const warnings: string[] = [];

  const conditionErrors = conditions.map((part, index) => validateConditionPart(part, index));
  const actionErrors = actions.map((part, index) => validateActionPart(part, index));

  if (actions.length === 0) {
    formErrors.push("Add at least one action.");
  }

  formErrors.push(...validateSplitStructure(actions));

  // Actual's engine returns false for a rule with no conditions (`evalConditions` on an empty
  // list), so such a rule never runs at all — it is inert, not universal.
  if (conditions.length === 0 && actions.length > 0) {
    warnings.push("This rule has no conditions, so it will never match a transaction and will never run. Add a condition to make it do anything.");
  }

  if (actions.length > 0 && actions.every((part) => part.op === "link-schedule")) {
    warnings.push("This rule is fully schedule-managed. Edit it from the Schedules page when possible.");
  }

  return { formErrors, conditionErrors, actionErrors, warnings };
}
