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
      // A new row can have a proposed bank payee without an ID. Explicitly
      // clearing it must override that default, like the single-row editor.
      if (field === "payeeId" && change.value === null && context.pending.isNew) {
        patch.payeeId = { original: null, staged: null, source: "transform" };
      }
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

export type SequencePreview = TransformPreview & {
  /** Rows each rule changed, in the order the rules ran. */
  changedByRule: number[];
};

/**
 * Several rules run one after another, previewed as one change.
 *
 * Each rule sees what the previous ones left (feature spec §32): its rows carry
 * the earlier rules' staged patches before it runs, so "replace `#API` with the
 * month" followed by "use the statement's payee" keeps both edits. A row's
 * before is what it held before the first rule, its after what the last rule
 * left, and its patch the final one, ready to stage.
 */
export function previewTransformSequence(input: Omit<PreviewInput, "rule"> & {
  rules: TransformRule[];
}): SequencePreview {
  const current = new Map(input.items.map((item) => [item.id, item]));
  const changesById = new Map<string, Map<StageableField, { before: string | null; after: string | null }>>();
  const patches = new Map<string, StagedPatch>();
  const matchedIds = new Set<string>();
  const lastSkip = new Map<string, SkippedRow>();
  const changedByRule: number[] = [];

  for (const rule of input.rules) {
    const items = input.items.map((item) => current.get(item.id)!);
    const step = previewTransform({ ...input, rule, items });
    changedByRule.push(step.changed.length);

    for (const item of items) {
      if (ruleMatches(rule, input.contextFor(item))) matchedIds.add(item.id);
    }
    for (const skip of step.skipped) lastSkip.set(skip.itemId, skip);
    for (const row of step.changed) {
      const fields = changesById.get(row.itemId) ?? new Map();
      for (const change of row.changes) {
        const previous = fields.get(change.field);
        fields.set(change.field, { before: previous ? previous.before : change.before, after: change.after });
      }
      changesById.set(row.itemId, fields);
      patches.set(row.itemId, row.patch);
      current.set(row.itemId, { ...current.get(row.itemId)!, stagedChanges: row.patch });
    }
  }

  const changed: PreviewRow[] = [];
  for (const item of input.items) {
    const fields = changesById.get(item.id);
    if (!fields) continue;
    const rowChanges = [...fields].map(([field, values]) => ({ field, ...values }));
    // Rules that undid each other leave nothing to stage for that field.
    if (rowChanges.every((change) => change.before === change.after)) continue;
    changed.push({ itemId: item.id, changes: rowChanges, patch: patches.get(item.id) ?? {} });
  }
  const changedIds = new Set(changed.map((row) => row.itemId));
  const skipped = [...lastSkip.values()].filter((skip) => !changedIds.has(skip.itemId));

  return { matched: matchedIds.size, changed, skipped, changedByRule };
}
