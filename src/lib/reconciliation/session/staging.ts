/**
 * The staged patch model (RD-071 §5.2, feature spec §33/§36).
 *
 * Every staged field remembers what it was, what it will become, and *why* it
 * changed. That provenance is not bookkeeping — it is what makes preview,
 * in-session undo, drift detection and the precedence rule possible at all.
 *
 * Nothing here writes to Actual. These are proposals until an explicit Apply.
 */

import type {
  ActualTransactionSnapshot,
  ReconciliationItem,
  StagedPatch,
  StagedValue,
  StagedValueSource,
} from "../types";

/**
 * Precedence, highest first (feature spec §33).
 *
 * A bulk transformation must not silently overwrite a value the user typed by
 * hand. Anything at or below the incoming change's rank yields to it; anything
 * above it wins unless the caller explicitly opts into overriding.
 */
const PRECEDENCE: Record<StagedValueSource, number> = {
  manual: 5,
  transform: 4,
  suggestion: 3,
  actual: 2,
  statement: 1,
};

export function outranks(incoming: StagedValueSource, existing: StagedValueSource): boolean {
  return PRECEDENCE[incoming] >= PRECEDENCE[existing];
}

/** The fields V1 can stage. Kept explicit so a new field is a deliberate act. */
export const STAGEABLE_FIELDS = ["date", "payeeId", "categoryId", "notes"] as const;
export type StageableField = (typeof STAGEABLE_FIELDS)[number];

export type StageFieldInput<T> = {
  patch: StagedPatch | undefined;
  field: StageableField;
  /** The value in Actual when the session loaded. */
  original: T;
  next: T;
  source: StagedValueSource;
  /** Let a lower-precedence source overwrite a manual edit (feature spec §33). */
  overrideManual?: boolean;
};

export type StageResult = {
  patch: StagedPatch;
  /** False when precedence declined the change; the patch is returned unchanged. */
  applied: boolean;
  /** Set when the change was declined, for the "N rows skipped, because…" line. */
  skippedBecause?: "outranked-by-manual" | "outranked";
};

/**
 * Stage one field, honouring precedence.
 *
 * Setting a field back to its original value **clears** the staged entry rather
 * than recording a no-op change: an operation list containing writes that change
 * nothing is how a "12 updates" count becomes a lie.
 */
export function stageField<T>(input: StageFieldInput<T>): StageResult {
  const { field, original, next, source, overrideManual } = input;
  const patch: StagedPatch = { ...(input.patch ?? {}) };
  const existing = patch[field] as StagedValue<T> | undefined;

  if (existing && !outranks(source, existing.source)) {
    if (!overrideManual) {
      return {
        patch,
        applied: false,
        skippedBecause:
          existing.source === "manual" ? "outranked-by-manual" : "outranked",
      };
    }
  }

  // The baseline is always the server value, never the previously staged one,
  // so `original` still answers "what is in Actual today" after any number of
  // transformations.
  const baseline = existing ? (existing.original as T) : original;

  if (Object.is(baseline, next)) {
    delete patch[field];
    return { patch, applied: true };
  }

  (patch as Record<string, StagedValue<T>>)[field] = {
    original: baseline,
    staged: next,
    source,
  };
  return { patch, applied: true };
}

/** Drop one field's staged change, restoring the Actual value. */
export function unstageField(patch: StagedPatch | undefined, field: StageableField): StagedPatch {
  const next: StagedPatch = { ...(patch ?? {}) };
  delete next[field];
  return next;
}

/** True when anything is staged. An empty patch must produce no write. */
export function hasStagedChanges(patch: StagedPatch | undefined): boolean {
  return patch != null && Object.keys(patch).length > 0;
}

/** The fields a patch changes, for the review screen's per-kind counts. */
export function stagedFields(patch: StagedPatch | undefined): StageableField[] {
  if (!patch) return [];
  return STAGEABLE_FIELDS.filter((field) => patch[field] !== undefined);
}

/**
 * The value a field will hold after Apply: the staged value if there is one,
 * otherwise whatever Actual holds today.
 *
 * Transformations compose on **this** (feature spec §32) — never on the original
 * server value — so applying "replace #One with #Two" then "append Reviewed"
 * yields both changes rather than the second discarding the first.
 */
export function effectiveValue<T>(
  patch: StagedPatch | undefined,
  field: StageableField,
  fallback: T
): T {
  const staged = patch?.[field] as StagedValue<T> | undefined;
  return staged ? staged.staged : fallback;
}

/** The current staged view of a matched transaction, for the inspector. */
export function effectiveTransaction(
  snapshot: ActualTransactionSnapshot,
  patch: StagedPatch | undefined
): Pick<ActualTransactionSnapshot, "date" | "payeeId" | "categoryId" | "notes"> {
  return {
    date: effectiveValue(patch, "date", snapshot.date),
    payeeId: effectiveValue(patch, "payeeId", snapshot.payeeId),
    categoryId: effectiveValue(patch, "categoryId", snapshot.categoryId),
    notes: effectiveValue(patch, "notes", snapshot.notes),
  };
}

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

export type GuardVerdict = { allowed: true } | { allowed: false; reason: string };

const ALLOWED = { allowed: true } as const;

/**
 * Whether a field may be staged on this item (RD-071 D11–D13).
 *
 * These are the same guards 034a displayed; here they become enforcement. A
 * guard that only informs is decoration once staging exists.
 */
export function canStageField(
  item: Pick<ReconciliationItem, "guards">,
  field: StageableField
): GuardVerdict {
  if (item.guards.protectedReconciled) {
    return {
      allowed: false,
      reason:
        "This transaction is reconciled in Actual, which does not change reconciled rows. Unreconcile it in Actual first.",
    };
  }

  if (item.guards.splitParent && (field === "categoryId" || field === "payeeId")) {
    return {
      allowed: false,
      reason:
        field === "categoryId"
          ? "This is a split transaction — its category lives on the split lines, so there is no parent category to set."
          : "Changing the payee of a split transaction is not supported here.",
    };
  }

  if (item.guards.transfer !== "no" && field === "payeeId") {
    return {
      allowed: false,
      reason:
        "This is one leg of a transfer, and its payee is the other account rather than a merchant.",
    };
  }

  return ALLOWED;
}

/**
 * Whether this item may be staged for deletion.
 *
 * `unknown` transfer status is refused alongside `yes`: a transport that does
 * not report transfer membership cannot distinguish an ordinary transaction
 * from one leg of a transfer, and deleting a leg silently mutates an account
 * the user never selected.
 */
export function canStageDelete(item: Pick<ReconciliationItem, "guards">): GuardVerdict {
  if (item.guards.protectedReconciled) {
    return {
      allowed: false,
      reason: "Reconciled transactions are not deleted by Actual Bench.",
    };
  }
  if (item.guards.transfer === "yes") {
    return {
      allowed: false,
      reason:
        "Deleting one leg of a transfer would change the other account too. Delete it in Actual if you mean to.",
    };
  }
  if (item.guards.transfer === "unknown") {
    return {
      allowed: false,
      reason:
        "This connection does not report whether a transaction is part of a transfer, so deletion is blocked to avoid changing another account.",
    };
  }
  return ALLOWED;
}
