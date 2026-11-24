import type {
  SyncSourceSplitLine,
  SyncSourceTransaction,
} from "@/lib/actual/transport";
import { fnv1aHex } from "./hash";

/**
 * Source item identity and fingerprints for Cross Budget Sync (RD-053 / PR-019).
 *
 * Identity answers "is this the same source item we saw before" (drives the
 * `sync_mappings` primary key). Fingerprint answers "did the source item's
 * content change since we synced it" (drives change-since-sync warnings). They
 * are deliberately separate: an Actual transaction id is stable identity even
 * when the user later edits the amount/notes.
 */

export type SyncSourceItemKind = "transaction" | "split_line";

export type SyncSourceItem = {
  kind: SyncSourceItemKind;
  /** Stable per-flow mapping key, e.g. `txn:<id>` or `split:<id>:<splitId>`. */
  itemKey: string;
  sourceTransactionId: string;
  /** Present for split lines only. Null when a fallback key was required. */
  sourceSplitId: string | null;
  /** True when the split line had no stable id and a positional key was used. */
  usedFallbackKey: boolean;
  /** Content fingerprint for change-since-sync detection. */
  fingerprint: string;
  /**
   * What this item's fingerprint would have been under the previous format, for
   * each cleared/reconciled state. A mapping stored before those fields left the
   * fingerprint is unchanged if it matches any of them.
   */
  legacyFingerprints?: string[];
  /**
   * For a split line with no stable id, whose key embeds a fingerprint: the keys
   * it could have been mapped under, for each cleared/reconciled state.
   */
  keyAliases?: string[];
  /** Those keys point at different target rows, so a person has to decide. */
  identityConflict?: boolean;
  // Denormalized fields the engine transforms/classifies against.
  date: string;
  amount: number;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  importedId: string | null;
  /** The source row is one leg of a transfer inside the source budget. */
  isTransfer?: boolean;
  /**
   * Present only for a grouped split parent (RD-057 §6, `createTargetSplits`):
   * the child lines to create as subtransactions under one target parent. Absent
   * for exploded split lines and normal transactions.
   */
  splitLines?: SyncSourceSplitLine[];
};

const FINGERPRINT_VERSION = "v2";
const LEGACY_FINGERPRINT_VERSION = "v1";
const FIELD_SEP = "␟"; // ␟ SYMBOL FOR UNIT SEPARATOR - safe against field collisions.

export function sourceTransactionItemKey(sourceTransactionId: string): string {
  return "txn:" + sourceTransactionId;
}

export function sourceSplitItemKey(
  sourceTransactionId: string,
  sourceSplitId: string
): string {
  return "split:" + sourceTransactionId + ":" + sourceSplitId;
}

/**
 * Fallback key for split lines that lack a stable id. Includes the line index
 * and a fingerprint of the line's content so reordering or edits produce a
 * different key rather than silently colliding with an unrelated line.
 */
export function sourceSplitFallbackItemKey(
  sourceTransactionId: string,
  lineIndex: number,
  lineFingerprint: string
): string {
  return "split:" + sourceTransactionId + ":" + lineIndex + ":" + lineFingerprint;
}

function part(value: string | number | boolean | null): string {
  if (value === null) return "∅"; // ∅ distinguishes null from empty string.
  return String(value);
}

/**
 * Cleared and reconciled state are left out of every fingerprint: sync never
 * writes them to the target, so clearing or reconciling the source account is
 * not a change that needs review. `flags` carries them only for the legacy format.
 */
type LegacyFlags = { cleared: boolean; reconciled: boolean };
const LEGACY_FLAG_STATES: LegacyFlags[] = [
  { cleared: false, reconciled: false },
  { cleared: true, reconciled: false },
  { cleared: false, reconciled: true },
  { cleared: true, reconciled: true },
];

function statusParts(flags: LegacyFlags | null): string[] {
  return flags ? [part(flags.cleared), part(flags.reconciled)] : [];
}

function transactionCanonical(txn: SyncSourceTransaction, flags: LegacyFlags | null): string {
  return [
    flags ? LEGACY_FINGERPRINT_VERSION : FINGERPRINT_VERSION,
    "txn",
    part(txn.date),
    part(txn.amount),
    part(txn.payeeId),
    part(txn.payeeName),
    part(txn.categoryId),
    part(txn.categoryName),
    part(txn.notes),
    ...statusParts(flags),
    part(txn.importedId),
  ].join(FIELD_SEP);
}

/** Fingerprint of a normal (non-split-parent) transaction's content. */
export function transactionFingerprint(txn: SyncSourceTransaction): string {
  return fnv1aHex(transactionCanonical(txn, null));
}

function splitLineCanonical(
  parent: SyncSourceTransaction,
  line: SyncSourceSplitLine,
  lineIndex: number,
  flags: LegacyFlags | null
): string {
  return [
    flags ? LEGACY_FINGERPRINT_VERSION : FINGERPRINT_VERSION,
    "split",
    part(parent.date),
    part(parent.payeeId),
    part(parent.payeeName),
    ...statusParts(flags),
    part(lineIndex),
    part(line.amount),
    part(line.payeeId),
    part(line.payeeName),
    part(line.categoryId),
    part(line.categoryName),
    part(line.notes),
  ].join(FIELD_SEP);
}

/**
 * Fingerprint of a single split line. Includes parent context (date and parent
 * payee) so that a line's fingerprint changes when the surrounding parent is
 * edited, plus the line position so reordered lines are detectable.
 */
export function splitLineFingerprint(
  parent: SyncSourceTransaction,
  line: SyncSourceSplitLine,
  lineIndex: number
): string {
  return fnv1aHex(splitLineCanonical(parent, line, lineIndex, null));
}

function splitParentCanonical(txn: SyncSourceTransaction, flags: LegacyFlags | null): string {
  return [
    flags ? LEGACY_FINGERPRINT_VERSION : FINGERPRINT_VERSION,
    "split_parent",
    part(txn.date),
    part(txn.amount),
    part(txn.payeeId),
    part(txn.payeeName),
    part(txn.notes),
    ...statusParts(flags),
    part(txn.importedId),
    ...txn.splitLines.flatMap((line, i) => [
      part(i),
      part(line.amount),
      part(line.payeeName),
      part(line.categoryName),
      part(line.notes),
    ]),
  ].join(FIELD_SEP);
}

/** Fingerprint of a whole split parent (all lines), for grouped-split sync. */
export function splitParentFingerprint(txn: SyncSourceTransaction): string {
  return fnv1aHex(splitParentCanonical(txn, null));
}

function legacyFingerprints(canonical: (flags: LegacyFlags) => string): string[] {
  return LEGACY_FLAG_STATES.map((flags) => fnv1aHex(canonical(flags)));
}

/**
 * Expand a source transaction into the sync source items it contributes.
 *
 * - A split parent contributes one `split_line` item per child (explode mode,
 *   the default). When `groupSplits` is set (RD-057 §6), it instead contributes
 *   ONE `transaction` item carrying its child lines, to be created as a single
 *   grouped target split.
 * - Any other transaction contributes a single `transaction` item.
 *
 * Split children inherit the parent's date and - when the child has no payee of
 * its own - the parent's payee, since Actual split children commonly omit it.
 */
export function expandSourceTransaction(
  txn: SyncSourceTransaction,
  opts: { groupSplits?: boolean } = {}
): SyncSourceItem[] {
  // Grouped-split mode: the parent is one item carrying its lines (RD-057 §6).
  if (opts.groupSplits && txn.isParent && txn.splitLines.length > 0) {
    return [
      {
        kind: "transaction",
        itemKey: sourceTransactionItemKey(txn.id),
        sourceTransactionId: txn.id,
        sourceSplitId: null,
        usedFallbackKey: false,
        fingerprint: splitParentFingerprint(txn),
        legacyFingerprints: legacyFingerprints((flags) => splitParentCanonical(txn, flags)),
        date: txn.date,
        amount: txn.amount,
        payeeId: txn.payeeId,
        payeeName: txn.payeeName,
        categoryId: txn.categoryId,
        categoryName: txn.categoryName,
        notes: txn.notes,
        cleared: txn.cleared,
        reconciled: txn.reconciled,
        importedId: txn.importedId,
        isTransfer: !!txn.transferId,
        splitLines: txn.splitLines,
      } satisfies SyncSourceItem,
    ];
  }
  if (txn.isParent && txn.splitLines.length > 0) {
    return txn.splitLines.map((line, lineIndex) => {
      const fingerprint = splitLineFingerprint(txn, line, lineIndex);
      const hasStableId = typeof line.id === "string" && line.id.length > 0;
      // A positional key is part of the line's identity and of its target marker,
      // so it stays on the original fingerprint format.
      const positionalKey = (flags: LegacyFlags) =>
        sourceSplitFallbackItemKey(txn.id, lineIndex, fnv1aHex(splitLineCanonical(txn, line, lineIndex, flags)));
      const itemKey = hasStableId
        ? sourceSplitItemKey(txn.id, line.id as string)
        : positionalKey({ cleared: txn.cleared, reconciled: txn.reconciled });

      return {
        kind: "split_line",
        itemKey,
        sourceTransactionId: txn.id,
        sourceSplitId: hasStableId ? (line.id as string) : null,
        usedFallbackKey: !hasStableId,
        fingerprint,
        legacyFingerprints: legacyFingerprints((flags) => splitLineCanonical(txn, line, lineIndex, flags)),
        ...(hasStableId ? {} : { keyAliases: LEGACY_FLAG_STATES.map(positionalKey) }),
        date: txn.date,
        amount: line.amount,
        // Split children inherit the parent payee when they lack their own.
        payeeId: line.payeeId ?? txn.payeeId,
        payeeName: line.payeeName ?? txn.payeeName,
        categoryId: line.categoryId,
        categoryName: line.categoryName,
        notes: line.notes ?? txn.notes,
        cleared: txn.cleared,
        reconciled: txn.reconciled,
        // A split line has no independent Actual imported_id.
        importedId: null,
        isTransfer: !!line.transferId,
      } satisfies SyncSourceItem;
    });
  }

  return [
    {
      kind: "transaction",
      itemKey: sourceTransactionItemKey(txn.id),
      sourceTransactionId: txn.id,
      sourceSplitId: null,
      usedFallbackKey: false,
      fingerprint: transactionFingerprint(txn),
      legacyFingerprints: legacyFingerprints((flags) => transactionCanonical(txn, flags)),
      date: txn.date,
      amount: txn.amount,
      payeeId: txn.payeeId,
      payeeName: txn.payeeName,
      categoryId: txn.categoryId,
      categoryName: txn.categoryName,
      notes: txn.notes,
      cleared: txn.cleared,
      reconciled: txn.reconciled,
      importedId: txn.importedId,
      isTransfer: !!txn.transferId,
    } satisfies SyncSourceItem,
  ];
}

/** Every key this item may be mapped under. */
export function allKeysOf(item: Pick<SyncSourceItem, "itemKey" | "keyAliases">): string[] {
  return item.keyAliases ? [item.itemKey, ...item.keyAliases] : [item.itemKey];
}

/** Expand many source transactions, preserving order. */
export function expandSourceTransactions(
  txns: SyncSourceTransaction[],
  opts: { groupSplits?: boolean } = {}
): SyncSourceItem[] {
  return txns.flatMap((txn) => expandSourceTransaction(txn, opts));
}
