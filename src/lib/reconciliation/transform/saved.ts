/**
 * Saved transforms: an IF/THEN rule kept by name and run again on later imports.
 *
 * A saved transform is the same `TransformRule` the dialog builds, so running
 * one goes through the same preview and the same staging as a rule typed in by
 * hand: nothing is written to the budget, and nothing runs without being
 * previewed and confirmed.
 *
 * The one addition is a `{month}` placeholder. A rule such as "replace `#API`
 * with `#2026-11`" is the same every month except for the month, so it is saved
 * as `#{month}` and the month is filled in when it runs.
 */

import type {
  Condition,
  ConditionField,
  ConditionOperator,
  TransformAction,
  TransformRule,
} from "./rules";

/** What is stored for a saved transform: the rule without a session-specific id. */
export type SavedRule = Pick<TransformRule, "conditions" | "actions">;

export type SavedTransform = {
  id: string;
  name: string;
  rule: SavedRule;
  position: number;
  createdAt: string;
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// The {month} placeholder
// ---------------------------------------------------------------------------

const MONTH_PLACEHOLDER = /\{month\}/gi;
const MONTH_VALUE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** True for a `YYYY-MM` value the placeholder can be replaced with. */
export function isMonthValue(value: string): boolean {
  return MONTH_VALUE.test(value.trim());
}

/**
 * The month a run defaults to: the statement's closing month.
 *
 * A statement from 15 October to 14 November closes in November, and the
 * closing month is the one written on it. Falls back to the latest row date,
 * then to today, so a statement without a printed period still gets a value
 * the user can correct.
 */
export function defaultMonth(input: {
  statementEnd?: string | null;
  rowDates?: (string | null | undefined)[];
  today?: string;
}): string {
  if (input.statementEnd && /^\d{4}-\d{2}/.test(input.statementEnd)) {
    return input.statementEnd.slice(0, 7);
  }
  const latest = (input.rowDates ?? [])
    .filter((date): date is string => typeof date === "string" && /^\d{4}-\d{2}/.test(date))
    .sort()
    .at(-1);
  if (latest) return latest.slice(0, 7);
  return (input.today ?? new Date().toISOString()).slice(0, 7);
}

function fill(text: string, month: string): string {
  return text.replace(MONTH_PLACEHOLDER, month);
}

function textsOf(rule: SavedRule): string[] {
  const texts: string[] = [];
  for (const condition of rule.conditions) {
    texts.push(condition.value);
    if (condition.value2 !== undefined) texts.push(condition.value2);
  }
  for (const action of rule.actions) {
    switch (action.kind) {
      case "addTag":
      case "removeTag":
        texts.push(action.tag);
        break;
      case "replaceTag":
      case "replaceNoteText":
        texts.push(action.from, action.to);
        break;
      case "appendNote":
      case "prependNote":
        texts.push(action.text);
        break;
    }
  }
  return texts;
}

/** True when any value in the rule uses `{month}`, so a month must be chosen. */
export function usesMonth(rule: SavedRule): boolean {
  return textsOf(rule).some((text) => new RegExp(MONTH_PLACEHOLDER.source, "i").test(text));
}

/**
 * The rule with `{month}` replaced everywhere it appears.
 *
 * Applied to a copy just before preview, never to what is stored, so the saved
 * rule keeps the placeholder for next month.
 */
export function resolvePlaceholders<T extends SavedRule>(rule: T, month: string): T {
  const conditions = rule.conditions.map((condition) => ({
    ...condition,
    value: fill(condition.value, month),
    ...(condition.value2 !== undefined ? { value2: fill(condition.value2, month) } : {}),
  }));
  const actions = rule.actions.map((action): TransformAction => {
    switch (action.kind) {
      case "addTag":
        return { ...action, tag: fill(action.tag, month) };
      case "removeTag":
        return { ...action, tag: fill(action.tag, month) };
      case "replaceTag":
        return { ...action, from: fill(action.from, month), to: fill(action.to, month) };
      case "replaceNoteText":
        return { ...action, from: fill(action.from, month), to: fill(action.to, month) };
      case "appendNote":
      case "prependNote":
        return { ...action, text: fill(action.text, month) };
      default:
        return action;
    }
  });
  return { ...rule, conditions, actions };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const FIELDS: ReadonlySet<ConditionField> = new Set([
  "statementImportedPayee",
  "statementBankNotes",
  "payee",
  "category",
  "notes",
  "amount",
  "date",
  "matchStatus",
]);

const OPERATORS: ReadonlySet<ConditionOperator> = new Set([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "greaterThan",
  "lessThan",
  "between",
  "hasTag",
  "doesNotHaveTag",
]);

const MAX_TEXT = 500;
const MAX_PARTS = 20;

function text(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_TEXT ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function condition(value: unknown): Condition | null {
  const entry = record(value);
  if (!entry) return null;
  const field = entry.field as ConditionField;
  const operator = entry.operator as ConditionOperator;
  const first = text(entry.value);
  if (!FIELDS.has(field) || !OPERATORS.has(operator) || first === null) return null;
  if (entry.value2 !== undefined) {
    const second = text(entry.value2);
    if (second === null) return null;
    return { field, operator, value: first, value2: second };
  }
  return { field, operator, value: first };
}

function action(value: unknown): TransformAction | null {
  const entry = record(value);
  if (!entry) return null;
  switch (entry.kind) {
    case "setPayee":
      if (entry.payeeId !== null && text(entry.payeeId) === null) return null;
      return { kind: "setPayee", payeeId: (entry.payeeId as string | null) ?? null };
    case "addTag": {
      const tag = text(entry.tag);
      if (tag === null) return null;
      const position = entry.position === "start" ? "start" : entry.position === "end" ? "end" : undefined;
      return position ? { kind: "addTag", tag, position } : { kind: "addTag", tag };
    }
    case "removeTag": {
      const tag = text(entry.tag);
      return tag === null ? null : { kind: "removeTag", tag };
    }
    case "replaceTag":
    case "replaceNoteText": {
      const from = text(entry.from);
      const to = text(entry.to);
      return from === null || to === null ? null : { kind: entry.kind, from, to };
    }
    case "appendNote":
    case "prependNote": {
      const body = text(entry.text);
      return body === null ? null : { kind: entry.kind, text: body };
    }
    case "useStatementImportedPayee":
      return { kind: "useStatementImportedPayee" };
    default:
      return null;
  }
}

/**
 * A stored rule, checked part by part.
 *
 * Returns null when anything is unrecognised rather than dropping that part: a
 * rule missing one of its conditions would match rows it was never meant to.
 * The reader skips a null rule, so a newer build's action kind does not break
 * the list for an older one.
 */
export function sanitizeSavedRule(value: unknown): SavedRule | null {
  const entry = record(value);
  if (!entry || !Array.isArray(entry.conditions) || !Array.isArray(entry.actions)) return null;
  if (entry.conditions.length > MAX_PARTS || entry.actions.length > MAX_PARTS) return null;
  if (entry.actions.length === 0) return null;
  const conditions = entry.conditions.map(condition);
  const actions = entry.actions.map(action);
  if (conditions.some((part) => part === null) || actions.some((part) => part === null)) return null;
  return { conditions: conditions as Condition[], actions: actions as TransformAction[] };
}

/**
 * Payee ids a rule sets that no longer exist in the budget.
 *
 * The run shows these as a warning and the affected action is dropped, so a
 * deleted payee does not stop the rest of the rule from running.
 */
export function missingPayees(rule: SavedRule, knownPayeeIds: ReadonlySet<string>): string[] {
  return rule.actions.flatMap((entry) =>
    entry.kind === "setPayee" && entry.payeeId !== null && !knownPayeeIds.has(entry.payeeId)
      ? [entry.payeeId]
      : []
  );
}

/** The rule without actions that set a payee the budget no longer has. */
export function withoutMissingPayees(rule: SavedRule, knownPayeeIds: ReadonlySet<string>): SavedRule {
  return {
    ...rule,
    actions: rule.actions.filter(
      (entry) => entry.kind !== "setPayee" || entry.payeeId === null || knownPayeeIds.has(entry.payeeId)
    ),
  };
}

/** True when a condition compares against a fixed date, which rarely suits a rule run every month. */
export function hasFixedDate(rule: SavedRule): boolean {
  return rule.conditions.some((entry) => entry.field === "date");
}
