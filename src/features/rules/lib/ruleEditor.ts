"use client";

import { generateId } from "@/lib/uuid";
import type { ComboboxOption } from "@/components/ui/combobox";
import type { ConditionOrAction, ConditionsOp, Rule, RuleStage } from "@/types/entities";
import { ACTION_FIELDS, ACTION_OPS, CONDITION_FIELDS, getConditionOps } from "../utils/ruleFields";

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
  fieldDef: { type: "string" | "id" | "number" | "date" | "boolean"; supportsTemplate?: boolean }
): boolean {
  if (part.options?.template !== undefined) {
    return fieldDef.supportsTemplate === true && !isBlankString(part.options.template);
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

  if (!fieldDef) {
    errors.push(`Condition ${index + 1}: select a valid field.`);
    return errors;
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

function validateActionPart(part: ConditionOrAction, index: number): string[] {
  const errors: string[] = [];

  if (part.op === "link-schedule") return errors;

  const opDef = ACTION_OPS[part.op];
  if (!opDef) {
    errors.push(`Action ${index + 1}: select a valid action.`);
    return errors;
  }

  if (part.op === "delete-transaction") return errors;

  const field = part.field ?? "";
  const fieldDef = ACTION_FIELDS[field];
  if (!fieldDef) {
    errors.push(`Action ${index + 1}: select a valid field.`);
    return errors;
  }

  if (opDef.hasValue && !hasValidRequiredValue(part, fieldDef)) {
    errors.push(`Action ${index + 1}: enter a valid value.`);
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

  if (conditions.length === 0 && actions.some((part) => part.op === "delete-transaction")) {
    warnings.push("This rule deletes transactions without any conditions. Saving it will make it apply to every transaction.");
  }

  if (actions.length > 0 && actions.every((part) => part.op === "link-schedule")) {
    warnings.push("This rule is fully schedule-managed. Edit it from the Schedules page when possible.");
  }

  return { formErrors, conditionErrors, actionErrors, warnings };
}
