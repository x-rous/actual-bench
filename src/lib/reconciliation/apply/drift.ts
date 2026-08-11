/**
 * What changed in Actual since the session read it (feature spec §41).
 *
 * A reconciliation session outlives the state it was built from. The candidate
 * window is read once, decisions are staged against those snapshots, and Apply
 * may run minutes or days later — by which time a row can have been edited in
 * Actual, reconciled, or deleted outright.
 *
 * Applying regardless would be silently destructive in two distinct ways, and
 * both are handled here:
 *
 *   1. A staged field overwrites an edit made in between. Where the field is
 *      the note, the staged change is replayed onto the current text instead of
 *      replacing it (`rebase.ts`); where it is not, the row is withheld for the
 *      user to look at.
 *   2. A field nobody staged is reverted. An update carries `date` and `amount`
 *      whether or not they are part of the change, so an amount corrected in
 *      Actual after the snapshot would be written back to its old value by an
 *      update that was only ever meant to touch the note. These are refreshed
 *      from the live row rather than withheld — there is no conflict to resolve,
 *      the session simply holds an out-of-date copy.
 *
 * Pure: it compares snapshots against live rows the caller supplies, and
 * produces a revised plan. Reading the live rows belongs to the caller, so the
 * decision of what to do about drift stays testable without a transport.
 */

import type { ActualTransactionSnapshot, StagedPatch } from "../types";
import type { ApplyOperation, ApplyPlan, UpdateOperation } from "./operations";
import { rebaseNotes } from "./rebase";

/** A field an operation would write, in the wording shown to the user. */
const FIELD_LABELS: Record<string, string> = {
  amount: "amount",
  date: "date",
  payeeId: "payee",
  notes: "notes",
};

export type DriftVerdict =
  /** Nothing relevant moved; the operation stands as planned. */
  | { operationId: string; status: "clean" }
  /** The row moved, but only in fields nobody staged; carried values refreshed. */
  | { operationId: string; status: "refreshed"; fields: string[] }
  /** The note moved and the staged change was replayed onto the current text. */
  | { operationId: string; status: "rebased"; notes: string | null; was: string | null }
  /** The row is gone from Actual. */
  | { operationId: string; status: "vanished"; reason: string }
  /** The row moved under a staged change; the user has to look. */
  | { operationId: string; status: "conflict"; fields: string[]; reason: string };

export type DriftReport = {
  verdicts: DriftVerdict[];
  /** Operations that must not run until the user has seen them. */
  withheld: DriftVerdict[];
  /** True when nothing needs the user's attention. */
  clean: boolean;
};

export type DriftInput = {
  plan: ApplyPlan;
  /** What the session recorded when it loaded, by transaction id. */
  snapshots: Map<string, ActualTransactionSnapshot>;
  /**
   * What Actual says now, by transaction id. A key mapped to `null` means the
   * row no longer exists; a key that is absent was not re-read and is assumed
   * unchanged, so a partial re-read degrades to today's behaviour rather than
   * withholding everything.
   */
  latest: Map<string, ActualTransactionSnapshot | null>;
};

function targetedTransactionId(operation: ApplyOperation): string | null {
  return operation.kind === "create" ? null : operation.transactionId;
}

/** The fields this operation would write, beyond the ones it merely carries. */
function stagedFieldsOf(operation: ApplyOperation): (keyof StagedPatch)[] {
  if (operation.kind !== "update") return [];
  return (Object.keys(operation.patch) as (keyof StagedPatch)[]).filter(
    (field) => operation.patch[field] !== undefined
  );
}

function labelsFor(fields: string[]): string {
  return fields.map((field) => FIELD_LABELS[field] ?? field).join(" and ");
}

/**
 * Compare the plan against the live rows and revise it.
 *
 * Returns both the report and the plan actually safe to run: withheld
 * operations are removed, rebased and refreshed ones are rewritten in place.
 * The caller applies the returned plan and shows the report.
 */
export function reconcilePlanWithDrift(input: DriftInput): {
  report: DriftReport;
  plan: ApplyPlan;
} {
  const verdicts: DriftVerdict[] = [];
  const operations: ApplyOperation[] = [];

  for (const operation of input.plan.operations) {
    const transactionId = targetedTransactionId(operation);

    // Creates target nothing that can have drifted. Their safety rests on the
    // deterministic marker instead.
    if (!transactionId) {
      operations.push(operation);
      continue;
    }

    if (!input.latest.has(transactionId)) {
      operations.push(operation);
      continue;
    }

    const live = input.latest.get(transactionId) ?? null;
    const snapshot = input.snapshots.get(transactionId);

    if (!live) {
      // A delete whose target is already gone is the outcome the user asked
      // for, so it is dropped rather than reported as a problem.
      if (operation.kind === "delete") {
        verdicts.push({
          operationId: operation.id,
          status: "vanished",
          reason: "Already deleted in Actual - nothing left to do.",
        });
        continue;
      }
      verdicts.push({
        operationId: operation.id,
        status: "vanished",
        reason: "This transaction no longer exists in Actual, so it cannot be updated.",
      });
      continue;
    }

    if (!snapshot) {
      operations.push(operation);
      continue;
    }

    // Reconciled since the snapshot: locked in Actual, and not something to
    // work around silently.
    if (live.reconciled && !snapshot.reconciled) {
      verdicts.push({
        operationId: operation.id,
        status: "conflict",
        fields: ["reconciled"],
        reason: "This transaction has been reconciled in Actual since the session loaded it.",
      });
      continue;
    }

    if (operation.kind === "delete") {
      const moved = ["amount", "date", "notes", "payeeId"].filter(
        (field) =>
          live[field as keyof ActualTransactionSnapshot] !==
          snapshot[field as keyof ActualTransactionSnapshot]
      );
      if (moved.length > 0) {
        verdicts.push({
          operationId: operation.id,
          status: "conflict",
          fields: moved,
          reason: `This transaction's ${labelsFor(moved)} changed in Actual after the session loaded it, so it is no longer clearly the duplicate that was marked for deletion.`,
        });
        continue;
      }
      operations.push(operation);
      continue;
    }

    // Creates left by the early return above; this restates it for the type.
    if (operation.kind !== "update") {
      operations.push(operation);
      continue;
    }

    const staged = stagedFieldsOf(operation);
    const conflicts: string[] = [];
    let revised: UpdateOperation = operation;
    let rebasedTo: { notes: string | null; was: string | null } | null = null;

    // The note moved under a staged note change — the one case worth trying to
    // reconcile rather than refuse, because it is also the common one.
    const stagedNotes = operation.patch.notes;
    if (stagedNotes && live.notes !== stagedNotes.original) {
      const outcome = rebaseNotes(stagedNotes.original, stagedNotes.staged, live.notes);
      if (outcome.status === "conflict") {
        conflicts.push("notes");
      } else {
        // Whether it was replayed or already converged, the recorded original
        // moves to what Actual says now, so the write describes itself honestly.
        if (outcome.status === "rebased") {
          rebasedTo = { notes: outcome.notes, was: stagedNotes.staged };
        }
        revised = {
          ...revised,
          patch: {
            ...revised.patch,
            notes: { ...stagedNotes, original: live.notes, staged: outcome.notes },
          },
        };
      }
    }

    for (const field of staged) {
      if (field === "notes") continue;
      const value = operation.patch[field];
      if (!value) continue;
      if (live[field] === value.original) continue;
      conflicts.push(field);
    }

    if (conflicts.length > 0) {
      verdicts.push({
        operationId: operation.id,
        status: "conflict",
        fields: conflicts,
        reason: `The ${labelsFor(conflicts)} changed in Actual after the session loaded it, so applying would overwrite that change.`,
      });
      continue;
    }

    // Fields the update carries but does not change. Left stale, they would be
    // written back over whatever the row says now.
    const refreshed: string[] = [];
    if (!staged.includes("amount") && live.amount !== revised.amount) {
      revised = { ...revised, amount: live.amount };
      refreshed.push("amount");
    }
    if (!staged.includes("date") && live.date !== revised.date) {
      revised = { ...revised, date: live.date };
      refreshed.push("date");
    }

    // Already cleared in Actual: the write would be a no-op, but saying so is
    // better than a silent one.
    if (revised.cleared === true && live.cleared) {
      revised = { ...revised, cleared: undefined };
    }

    operations.push(revised);

    if (rebasedTo) {
      verdicts.push({
        operationId: operation.id,
        status: "rebased",
        notes: rebasedTo.notes,
        was: rebasedTo.was,
      });
    } else if (refreshed.length > 0) {
      verdicts.push({ operationId: operation.id, status: "refreshed", fields: refreshed });
    } else {
      verdicts.push({ operationId: operation.id, status: "clean" });
    }
  }

  const withheld = verdicts.filter(
    (verdict) => verdict.status === "conflict" || verdict.status === "vanished"
  );

  return {
    report: {
      verdicts,
      withheld,
      clean: withheld.length === 0 && verdicts.every((verdict) => verdict.status === "clean"),
    },
    plan: { ...input.plan, operations },
  };
}

/** Transaction ids an Apply run would touch, for the pre-flight re-read. */
export function driftTargets(plan: ApplyPlan): string[] {
  const ids = new Set<string>();
  for (const operation of plan.operations) {
    const id = targetedTransactionId(operation);
    if (id) ids.add(id);
  }
  return [...ids];
}
