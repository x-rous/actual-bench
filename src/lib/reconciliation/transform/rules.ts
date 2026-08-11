/**
 * One-time reconciliation transformations (feature spec §27–§32).
 *
 * A small, deliberately bounded rule language: conditions over the fields the
 * user can see, and actions over the fields they may change. It is *not* an
 * Actual rule — nothing here becomes permanent, and nothing here runs again on
 * future transactions (feature spec §48).
 *
 * Two properties matter more than any feature:
 *
 * 1. **Everything composes on the current staged value** (§32), never on the
 *    original server value. Replace a tag, then append a note, and both survive.
 * 2. **Nothing is written.** A transformation produces staged changes, which the
 *    user reviews and applies like any other.
 */

import {
  addNoteTag,
  appendNoteText,
  hasNoteTag,
  prependNoteText,
  removeNoteTag,
  replaceNoteTag,
} from "../noteTags";
import { mergeDescriptionIntoNotes } from "./mergeDescription";
import type { ProspectiveTransaction } from "../session/prospective";
import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StatementRow,
} from "../types";

// ---------------------------------------------------------------------------
// Conditions (feature spec §28/§29)
// ---------------------------------------------------------------------------

export type ConditionField =
  | "statementDescription"
  | "payee"
  | "category"
  | "notes"
  | "amount"
  | "date"
  | "matchStatus";

export type ConditionOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "greaterThan"
  | "lessThan"
  | "between"
  | "hasTag"
  | "doesNotHaveTag";

export type Condition = {
  field: ConditionField;
  operator: ConditionOperator;
  value: string;
  /** Second bound for `between`. */
  value2?: string;
};

// ---------------------------------------------------------------------------
// Actions (feature spec §30)
// ---------------------------------------------------------------------------

export type TransformAction =
  | { kind: "setPayee"; payeeId: string | null }
  /**
   * `position` matters more than it looks: users who tag by workflow write the
   * tag first (`#API ADNOC …`), and a tag appended to the end of a bank
   * description reads as part of the merchant name.
   */
  | { kind: "addTag"; tag: string; position?: "start" | "end" }
  | { kind: "removeTag"; tag: string }
  | { kind: "replaceTag"; from: string; to: string }
  | { kind: "appendNote"; text: string }
  | { kind: "prependNote"; text: string }
  /**
   * Bring the note's merchant text up to the statement's full description,
   * leaving tags and the user's own words in place.
   */
  | { kind: "useStatementDescription" };

/**
 * A saved transformation.
 *
 * Stored as a record rather than run as an imperative click, because §32
 * requires re-running it over the current staged values, and because "save this
 * as an Actual rule" later is then a translation of something that already
 * exists rather than a reconstruction of what a button once did.
 */
export type TransformRule = {
  id: string;
  /** All conditions must hold. Kept simple deliberately (feature spec §29). */
  conditions: Condition[];
  actions: TransformAction[];
};

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type TransformContext = {
  item: ReconciliationItem;
  statementRow: StatementRow | undefined;
  /** What Actual holds today; absent for a row about to be created. */
  transaction: ActualTransactionSnapshot | undefined;
  /**
   * What the row will be once applied — staged values over existing ones, and
   * for a new transaction, whatever the statement supplies.
   *
   * Rules read this rather than the stored transaction so a single instruction
   * covers rows that exist and rows about to be created. "Tag everything this
   * statement touches" should not need saying twice.
   */
  pending: ProspectiveTransaction;
  /** Resolves ids to names, so a condition can be written against what is shown. */
  categoryName: (id: string | null) => string | null;
  payeeName: (id: string | null) => string | null;
};

/**
 * The value a condition sees: what the row *will* be, not what it was before an
 * earlier rule ran (§32) and not what Actual currently holds.
 */
function fieldValue(field: ConditionField, context: TransformContext): string | number | null {
  const { item, statementRow, pending } = context;

  switch (field) {
    case "statementDescription":
      return statementRow?.description ?? null;
    case "payee":
      return context.payeeName(pending.payeeId);
    case "category":
      return context.categoryName(pending.categoryId);
    case "notes":
      return pending.notes;
    case "amount":
      return pending.amount;
    case "date":
      return pending.date;
    case "matchStatus":
      return item.disposition;
  }
}

function asText(value: string | number | null): string {
  return value === null ? "" : String(value);
}

/** Money is compared in whole units, which is how the user writes it. */
function asNumber(value: string): number | null {
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function evaluateCondition(condition: Condition, context: TransformContext): boolean {
  const raw = fieldValue(condition.field, context);

  if (condition.operator === "hasTag" || condition.operator === "doesNotHaveTag") {
    const present = hasNoteTag(asText(raw), condition.value);
    return condition.operator === "hasTag" ? present : !present;
  }

  if (
    condition.operator === "greaterThan" ||
    condition.operator === "lessThan" ||
    condition.operator === "between"
  ) {
    if (condition.field === "amount") {
      // Amounts are held in minor units; the user writes whole ones.
      const actual = typeof raw === "number" ? raw / 100 : asNumber(asText(raw));
      const first = asNumber(condition.value);
      if (actual === null || first === null) return false;
      if (condition.operator === "greaterThan") return actual > first;
      if (condition.operator === "lessThan") return actual < first;
      const second = asNumber(condition.value2 ?? "");
      if (second === null) return false;
      return actual >= Math.min(first, second) && actual <= Math.max(first, second);
    }

    // Dates compare lexicographically, which is correct for ISO.
    const text = asText(raw);
    if (condition.operator === "greaterThan") return text > condition.value;
    if (condition.operator === "lessThan") return text < condition.value;
    const upper = condition.value2 ?? "";
    const [low, high] = condition.value <= upper ? [condition.value, upper] : [upper, condition.value];
    return text >= low && text <= high;
  }

  const haystack = asText(raw).toLowerCase();
  const needle = condition.value.trim().toLowerCase();

  switch (condition.operator) {
    case "equals":
      return haystack === needle;
    case "notEquals":
      return haystack !== needle;
    case "contains":
      return haystack.includes(needle);
    case "notContains":
      return !haystack.includes(needle);
    case "startsWith":
      return haystack.startsWith(needle);
    case "endsWith":
      return haystack.endsWith(needle);
    default:
      return false;
  }
}

/** A rule with no conditions applies to everything it is given. */
export function ruleMatches(rule: TransformRule, context: TransformContext): boolean {
  return rule.conditions.every((condition) => evaluateCondition(condition, context));
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export type FieldChange = {
  /** Category is absent by design — see STAGEABLE_FIELDS. */
  field: "payeeId" | "notes";
  value: string | null;
};

/**
 * The changes a rule's actions would make, given the current staged values.
 *
 * Returns changes rather than applying them, so the caller decides how to stage
 * — which is where precedence lives (feature spec §33), and where a manual edit
 * is protected from being overwritten.
 *
 * Note actions chain within a single rule too: adding a tag and then appending
 * text yields both, because each reads what the previous one produced.
 */
export function changesFor(rule: TransformRule, context: TransformContext): FieldChange[] {
  // The note a new transaction is going to carry, not the empty one it does not
  // have yet — otherwise adding a tag to a row being created would discard the
  // description that was about to become its note.
  const startingNotes = context.pending.notes;

  let notes = startingNotes;
  let notesTouched = false;
  const changes: FieldChange[] = [];

  for (const action of rule.actions) {
    switch (action.kind) {
      case "setPayee":
        changes.push({ field: "payeeId", value: action.payeeId });
        break;
      case "addTag":
        notes = addNoteTag(notes, action.tag, action.position ?? "end");
        notesTouched = true;
        break;
      case "removeTag":
        notes = removeNoteTag(notes, action.tag);
        notesTouched = true;
        break;
      case "replaceTag":
        notes = replaceNoteTag(notes, action.from, action.to);
        notesTouched = true;
        break;
      case "appendNote":
        notes = appendNoteText(notes, action.text);
        notesTouched = true;
        break;
      case "prependNote":
        notes = prependNoteText(notes, action.text);
        notesTouched = true;
        break;
      case "useStatementDescription": {
        const merged = mergeDescriptionIntoNotes(
          notes,
          context.statementRow?.description ?? ""
        );
        if (merged.changed) {
          notes = merged.notes;
          notesTouched = true;
        }
        break;
      }
    }
  }

  // A note action that changed nothing produces no change, so a rule run over
  // rows that already carry the tag does not report work it did not do.
  if (notesTouched && notes !== (startingNotes ?? "")) {
    changes.push({ field: "notes", value: notes });
  }

  return changes;
}
