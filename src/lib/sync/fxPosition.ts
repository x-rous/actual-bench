import { convertMinorUnits } from "@/lib/fx/fxMath";
import type { TransactionFxRecord } from "@/lib/fx/types";
import type { SyncSourceTransaction, SyncTargetTransactionInput } from "@/lib/actual/transport";
import type { SyncMapping } from "@/lib/app-db/types";
import type { SyncFlowPlanConfig } from "./flowConfig";
import { generateSyncMarker } from "./marker";
import type { ManualFxRate } from "./plannedChanges";
import { filterSourceItems, filterSourceTransactions, type SyncSourceFilter } from "./sourceFilter";
import { expandSourceTransactions } from "./sourceItems";

/**
 * Where a converted account stands: what the foreign balance is worth today
 * against what the target budget holds for it, and the entries that close the
 * gap. Pure; amounts are integer minor units and rates decimal strings.
 */

const REVALUATION_KEY_PREFIX = "fxreval:";
const REVALUATION_FINGERPRINT = "fx-revaluation";

/** True for a mapping that records a revaluation entry rather than a source transaction. */
export function isRevaluationKey(sourceItemKey: string): boolean {
  return sourceItemKey.startsWith(REVALUATION_KEY_PREFIX);
}

/** One revaluation per source account per day. */
export function revaluationItemKey(sourceAccountId: string, date: string): string {
  return `${REVALUATION_KEY_PREFIX}${sourceAccountId}:${date}`;
}

/** Rows whose rate the user set, by target transaction id. */
export function manualFxRates(snapshots: readonly TransactionFxRecord[]): Map<string, ManualFxRate> {
  return new Map(
    snapshots
      .filter((snapshot) => snapshot.isManual)
      .map((snapshot) => [snapshot.transactionId, { rate: snapshot.appliedRate, effectiveDate: snapshot.effectiveDate }])
  );
}

/** Synced rows converted with an earlier date's rate. */
export function countEarlierDateRates(snapshots: readonly TransactionFxRecord[]): number {
  return snapshots.filter((snapshot) => !snapshot.isManual && snapshot.effectiveDate < snapshot.requestedDate).length;
}

export type FxPosition = {
  /** Synced rows' source total, with the flow's sign applied (source minor units). */
  sourceTotal: number;
  /** What the target holds for those rows, revaluations included (target minor units). */
  targetTotal: number;
  /** `sourceTotal` at `rate` (target minor units). */
  valueAtRate: number;
  /** `valueAtRate - targetTotal`: the entry that would bring the target to today's value. */
  difference: number;
  /** Revaluation entries already in `targetTotal` (target minor units). */
  revaluedTotal: number;
  rate: string;
  syncedRows: number;
  /** Source rows matching the flow's filters that are not synced yet. */
  unsyncedRows: number;
  /** Mapped rows whose target transaction no longer exists. */
  missingOnTarget: number;
  /** Mapped rows whose source transaction no longer exists. */
  missingOnSource: number;
};

export function computeFxPosition(input: {
  config: Pick<SyncFlowPlanConfig, "amountDirection" | "createTargetSplits">;
  filter: SyncSourceFilter;
  sourceTransactions: SyncSourceTransaction[];
  targetTransactions: Pick<SyncSourceTransaction, "id" | "amount">[];
  mappings: SyncMapping[];
  /** Target units per source unit, as a decimal string. */
  rate: string;
}): FxPosition {
  const { config, filter, mappings, rate } = input;
  const amountByKey = new Map<string, number>();
  for (const groupSplits of [false, true]) {
    for (const item of expandSourceTransactions(input.sourceTransactions, { groupSplits })) {
      amountByKey.set(item.itemKey, item.amount);
    }
  }
  const targetAmount = new Map(input.targetTransactions.map((row) => [row.id, row.amount]));

  let sourceTotal = 0;
  let targetTotal = 0;
  let revaluedTotal = 0;
  let syncedRows = 0;
  let missingOnTarget = 0;
  let missingOnSource = 0;
  for (const mapping of mappings) {
    if (mapping.status !== "active" || !mapping.targetTransactionId) continue;
    const target = targetAmount.get(mapping.targetTransactionId);
    if (isRevaluationKey(mapping.sourceItemKey)) {
      if (target !== undefined) {
        targetTotal += target;
        revaluedTotal += target;
      }
      continue;
    }
    const source = amountByKey.get(mapping.sourceItemKey);
    if (source === undefined) {
      missingOnSource += 1;
      continue;
    }
    if (target === undefined) {
      missingOnTarget += 1;
      continue;
    }
    sourceTotal += config.amountDirection === "same" ? source : -source;
    targetTotal += target;
    syncedRows += 1;
  }

  const mappedKeys = new Set(mappings.map((mapping) => mapping.sourceItemKey));
  const eligible = filterSourceItems(
    expandSourceTransactions(filterSourceTransactions(input.sourceTransactions, filter), { groupSplits: config.createTargetSplits }),
    filter
  );
  const valueAtRate = convertMinorUnits(sourceTotal, rate);
  return {
    sourceTotal,
    targetTotal,
    valueAtRate,
    difference: valueAtRate - targetTotal,
    revaluedTotal,
    rate,
    syncedRows,
    unsyncedRows: eligible.filter((item) => !mappedKeys.has(item.itemKey)).length,
    missingOnTarget,
    missingOnSource,
  };
}

/** The target transaction for a revaluation entry, with its once-per-day marker. */
export function buildRevaluationInput(input: {
  config: Pick<SyncFlowPlanConfig, "sourceBudgetId" | "targetBudgetId" | "sourceAccountId" | "targetAccountId" | "fxSourceCurrency" | "fxTargetCurrency">;
  date: string;
  /** Signed target minor units. */
  amount: number;
  rate: string;
  categoryId: string | null;
}): { itemKey: string; transaction: SyncTargetTransactionInput } {
  const { config, date, amount, rate, categoryId } = input;
  const itemKey = revaluationItemKey(config.sourceAccountId, date);
  const importedId = generateSyncMarker({
    sourceBudgetId: config.sourceBudgetId,
    targetBudgetId: config.targetBudgetId,
    targetAccountId: config.targetAccountId,
    sourceItemKey: itemKey,
  });
  return {
    itemKey,
    transaction: {
      accountId: config.targetAccountId,
      date,
      amount,
      payeeId: null,
      payeeName: "FX revaluation",
      categoryId,
      notes: `[FX revaluation ${config.fxSourceCurrency}→${config.fxTargetCurrency} @ ${rate}]`,
      cleared: false,
      importedId,
    },
  };
}

export const revaluationFingerprint = REVALUATION_FINGERPRINT;

// --- Cross-currency transfers ------------------------------------------------

export type TransferRow = Pick<
  SyncSourceTransaction,
  "id" | "accountId" | "date" | "amount" | "payeeName" | "notes" | "reconciled" | "transferId" | "isParent" | "isChild"
>;

export type TransferCandidate = {
  /** The synced row in the converted account. */
  syncedId: string;
  /** The other side, in another account of the target budget. */
  counterpart: TransferRow;
  /** How far the two amounts are apart, in basis points of the synced amount. */
  differenceBps: number;
};

const DAY_MS = 86_400_000;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

/**
 * The most likely other side of each synced transfer: an opposite-sign, unlinked,
 * unsplit, unreconciled row in another account, within `maxDays` and `maxBps` of
 * the converted amount. Closest amount wins, then closest date. Each counterpart
 * is offered to one row only.
 */
export function findTransferCandidates(
  synced: readonly TransferRow[],
  others: readonly TransferRow[],
  options: { maxDays?: number; maxBps?: number } = {}
): TransferCandidate[] {
  const maxDays = options.maxDays ?? 3;
  const maxBps = options.maxBps ?? 500;
  const usable = (row: TransferRow) => !row.transferId && !row.reconciled && !row.isParent && !row.isChild && row.amount !== 0;
  const pairs: (TransferCandidate & { days: number })[] = [];
  for (const row of synced) {
    if (!usable(row)) continue;
    for (const other of others) {
      if (!usable(other) || other.accountId === row.accountId || Math.sign(other.amount) === Math.sign(row.amount)) continue;
      const days = dayGap(row.date, other.date);
      if (days > maxDays) continue;
      const differenceBps = Math.round((Math.abs(Math.abs(other.amount) - Math.abs(row.amount)) * 10_000) / Math.abs(row.amount));
      if (differenceBps <= maxBps) pairs.push({ syncedId: row.id, counterpart: other, differenceBps, days });
    }
  }
  pairs.sort((a, b) => a.differenceBps - b.differenceBps || a.days - b.days || a.syncedId.localeCompare(b.syncedId));
  const usedSynced = new Set<string>();
  const usedCounterparts = new Set<string>();
  const out: TransferCandidate[] = [];
  for (const { days: _days, ...pair } of pairs) {
    void _days;
    if (usedSynced.has(pair.syncedId) || usedCounterparts.has(pair.counterpart.id)) continue;
    usedSynced.add(pair.syncedId);
    usedCounterparts.add(pair.counterpart.id);
    out.push(pair);
  }
  return out;
}
