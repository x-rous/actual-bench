/**
 * Previewing a transformation before it touches anything (feature spec §31).
 *
 * The preview is computed with the same code that applies the rule, so what the
 * user is shown and what happens cannot diverge. It reports three things, and
 * the third matters as much as the first two:
 *
 * - how many rows the rule matches;
 * - the exact before and after for each;
 * - **what it skipped, and why**. A bulk action that silently passes over rows
 *   teaches the user not to trust its counts.
 */

import { canStageField, stageField, type StageableField } from "../session/staging";
import type { ReconciliationItem, StagedPatch } from "../types";
import { changesFor, ruleMatches, type TransformContext, type TransformRule } from "./rules";

export type PreviewRow = {
  itemId: string;
  /** Field-by-field, in the order the rule produced them. */
  changes: {
    field: StageableField;
    before: string | null;
    after: string | null;
  }[];
  /** The patch this row would end up with, ready to stage. */
  patch: StagedPatch;
};

export type SkippedRow = {
  itemId: string;
  reason: "guarded" | "manual-edit" | "no-change";
  /** Shown to the user, so a skip is explained rather than merely counted. */
  detail: string;
};

export type TransformPreview = {
  /** Rows the conditions matched, whether or not anything changed. */
  matched: number;
  changed: PreviewRow[];
  skipped: SkippedRow[];
};

export type PreviewInput = {
  rule: TransformRule;
  items: ReconciliationItem[];
  contextFor: (item: ReconciliationItem) => TransformContext;
  /**
   * Let the rule overwrite values the user edited by hand.
   *
   * Off by default: a bulk action quietly undoing deliberate work is the
   * failure the precedence rule exists to prevent (feature spec §33).
   */
  overrideManual?: boolean;
};

function labelFor(field: "payeeId" | "notes"): StageableField {
  return field;
}

export function previewTransform(input: PreviewInput): TransformPreview {
  const changed: PreviewRow[] = [];
  const skipped: SkippedRow[] = [];
  let matched = 0;

  for (const item of input.items) {
    const context = input.contextFor(item);
    if (!ruleMatches(input.rule, context)) continue;
    matched += 1;

    const changes = changesFor(input.rule, context);
    if (changes.length === 0) {
      skipped.push({
        itemId: item.id,
        reason: "no-change",
        detail: "Already as the rule would leave it",
      });
      continue;
    }

    let patch = item.stagedChanges;
    const rowChanges: PreviewRow["changes"] = [];
    let blocked: SkippedRow | null = null;

    for (const change of changes) {
      const field = labelFor(change.field);

      const verdict = canStageField(item, field);
      if (!verdict.allowed) {
        blocked = { itemId: item.id, reason: "guarded", detail: verdict.reason };
        break;
      }

      const before = currentValue(item, context, field);
      const result = stageField({
        patch,
        field,
        original: originalValue(context, field),
        next: change.value,
        source: "transform",
        overrideManual: input.overrideManual,
      });

      if (!result.applied) {
        blocked = {
          itemId: item.id,
          reason: "manual-edit",
          detail: "You changed this by hand, so the rule left it alone",
        };
        break;
      }

      patch = result.patch;
      rowChanges.push({ field, before, after: change.value });
    }

    if (blocked) {
      skipped.push(blocked);
      continue;
    }
    if (rowChanges.length === 0) {
      skipped.push({
        itemId: item.id,
        reason: "no-change",
        detail: "Already as the rule would leave it",
      });
      continue;
    }

    changed.push({ itemId: item.id, changes: rowChanges, patch: patch ?? {} });
  }

  return { matched, changed, skipped };
}

/**
 * What the field will hold before this rule runs — staged changes included, and
 * for a row about to be created, whatever the statement supplies. That is what
 * the user needs to see as the "before".
 */
function currentValue(
  item: ReconciliationItem,
  context: TransformContext,
  field: StageableField
): string | null {
  const staged = item.stagedChanges?.[field];
  if (staged) return staged.staged as string | null;
  switch (field) {
    case "notes":
      return context.pending.notes;
    case "payeeId":
      return context.pending.payeeId;
    default:
      return originalValue(context, field);
  }
}

/** What Actual holds today — the baseline every staged change is measured from. */
function originalValue(context: TransformContext, field: StageableField): string | null {
  const transaction = context.transaction;
  switch (field) {
    case "payeeId":
      return transaction?.payeeId ?? null;
    case "notes":
      return transaction?.notes ?? null;
    default:
      return null;
  }
}
