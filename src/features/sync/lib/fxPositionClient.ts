import { ensureTransportReady, getTransport, syncTransportAfterChanges } from "@/lib/actual";
import { impliedRate } from "@/lib/fx/fxMath";
import { decodeFlowPlanConfig } from "@/lib/sync/flowConfig";
import {
  buildConversionRows,
  buildRevaluationInput,
  computeFxPosition,
  countEarlierDateRates,
  findTransferCandidates,
  isRevaluationKey,
  revaluationFingerprint,
  type FxConversionRow,
  type FxPosition,
  type TransferCandidate,
  type TransferRow,
} from "@/lib/sync/fxPosition";
import { planCategoryReturn, type CategoryReturnPlan } from "@/lib/sync/categoryReturn";
import { decodeSourceFilter } from "@/lib/sync/sourceFilter";
import { allKeysOf, expandSourceTransactions } from "@/lib/sync/sourceItems";
import { hashTargetFields } from "@/lib/sync/targetFingerprint";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { TransactionPreflight } from "@/lib/actual/transactionStructure";
import type { SyncFlow } from "@/lib/app-db/types";
import type { ConnectionInstance } from "@/store/connection";
import * as api from "./syncApi";

/**
 * Reads and explicit writes behind the Currency position view. Each write here is
 * started by a button the user confirmed, and goes through the active transport.
 */

export type FxPositionCategory = { id: string; name: string; groupId: string; isIncome: boolean };

export type FxTransferPair = TransferCandidate & {
  synced: TransferRow;
  counterpartAccountName: string;
  /** Target units per source unit if the pair is linked at the counterpart's amount. */
  realisedRate: string | null;
};

export type FxPositionData = {
  position: FxPosition;
  rateDate: string;
  earlierDateRates: number;
  targetOffBudget: boolean;
  categories: FxPositionCategory[];
  categoryGroups: { id: string; name: string }[];
  transfers: FxTransferPair[];
  conversions: FxConversionRow[];
  /** Categories set on the target that the source rows could take. */
  categoryReturn: CategoryReturnPlan;
};

/** Today in the user's own time zone, as `YYYY-MM-DD`. */
export function localToday(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Upload a write now; false when it is still only in this browser's copy. */
async function uploaded(transport: ActualBenchTransport): Promise<boolean> {
  try {
    await syncTransportAfterChanges(transport, true);
    return true;
  } catch {
    return false;
  }
}

async function open(connection: ConnectionInstance): Promise<ActualBenchTransport> {
  await ensureTransportReady(connection);
  return getTransport(connection);
}

function shiftDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

async function currentRate(flow: SyncFlow, date: string): Promise<string> {
  const config = decodeFlowPlanConfig(flow);
  if (config.fxRatePolicy === "fixed") {
    if (!config.fxFixedRate) throw new Error("This flow's fixed rate is not set.");
    return config.fxFixedRate;
  }
  const { resolved, pending } = await api.resolveFxRates(
    [{ baseCurrency: config.fxSourceCurrency, quoteCurrency: config.fxTargetCurrency, date }],
    config.fxAllowProvider
  );
  const rate = Object.values(resolved)[0]?.rate;
  if (!rate) throw new Error(Object.values(pending)[0]?.message ?? `No ${config.fxSourceCurrency}/${config.fxTargetCurrency} rate is available for ${date}.`);
  return rate;
}

export async function loadFxPosition(input: {
  flow: SyncFlow;
  sourceConnection: ConnectionInstance;
  targetConnection: ConnectionInstance;
}): Promise<FxPositionData> {
  const { flow } = input;
  const config = decodeFlowPlanConfig(flow);
  const filter = decodeSourceFilter(flow);
  const rateDate = localToday();

  // One budget at a time: a Direct runtime holds only one.
  const sourceTransport = await open(input.sourceConnection);
  const sourceTransactions = await sourceTransport.listTransactionsForSync({ accountId: config.sourceAccountId });
  const { categories: sourceCategories } = await sourceTransport.getCategoryGroups();

  const targetTransport = await open(input.targetConnection);
  const targetTransactions = await targetTransport.listTransactionsForSync({ accountId: config.targetAccountId });
  const accounts = await targetTransport.getAccounts();
  const { groups, categories } = await targetTransport.getCategoryGroups();

  const [{ mappings }, { snapshots }, rate] = await Promise.all([
    api.listMappings(flow.id),
    api.listFlowFxSnapshots(flow.id),
    currentRate(flow, rateDate),
  ]);
  const position = computeFxPosition({ config, filter, sourceTransactions, targetTransactions, mappings, rate });

  // Synced rows that are transfers in the source and not yet linked here.
  const transferKeys = new Set(
    [false, true].flatMap((groupSplits) => expandSourceTransactions(sourceTransactions, { groupSplits }))
      .filter((item) => item.isTransfer)
      .flatMap(allKeysOf)
  );
  const targetById = new Map(targetTransactions.map((row) => [row.id, row]));
  const synced = mappings
    .filter((m) => m.status === "active" && !isRevaluationKey(m.sourceItemKey) && transferKeys.has(m.sourceItemKey) && m.targetTransactionId)
    .map((m) => targetById.get(m.targetTransactionId as string))
    .filter((row): row is SyncSourceTransaction => !!row && !row.transferId);

  let transfers: FxTransferPair[] = [];
  if (synced.length > 0) {
    const dates = synced.map((row) => row.date).sort();
    const startDate = shiftDays(dates[0], -3);
    const endDate = shiftDays(dates[dates.length - 1], 3);
    const others: SyncSourceTransaction[] = [];
    for (const account of accounts) {
      if (account.closed || account.id === config.targetAccountId) continue;
      others.push(...(await targetTransport.listTransactionsForSync({ accountId: account.id, startDate, endDate })));
    }
    const accountName = new Map(accounts.map((account) => [account.id, account.name]));
    const sourceByTarget = new Map(mappings.map((m) => [m.targetTransactionId, m.sourceItemKey]));
    const sourceAmounts = new Map(
      [false, true].flatMap((groupSplits) => expandSourceTransactions(sourceTransactions, { groupSplits }))
        .flatMap((item) => allKeysOf(item).map((key) => [key, item.amount] as const))
    );
    transfers = findTransferCandidates(synced, others).map((pair) => {
      const row = targetById.get(pair.syncedId) as SyncSourceTransaction;
      const sourceAmount = sourceAmounts.get(sourceByTarget.get(pair.syncedId) ?? "");
      return {
        ...pair,
        synced: row,
        counterpartAccountName: accountName.get(pair.counterpart.accountId) ?? pair.counterpart.accountId,
        realisedRate: sourceAmount ? impliedRate(sourceAmount, pair.counterpart.amount) : null,
      };
    });
  }

  return {
    position,
    rateDate,
    earlierDateRates: countEarlierDateRates(snapshots),
    targetOffBudget: accounts.find((account) => account.id === config.targetAccountId)?.offBudget === true,
    categories: categories.map((c) => ({ id: c.id, name: c.name, groupId: c.groupId, isIncome: c.isIncome })),
    categoryGroups: groups.map((g) => ({ id: g.id, name: g.name })),
    transfers,
    conversions: buildConversionRows(snapshots, targetTransactions),
    categoryReturn: planCategoryReturn({
      sourceTransactions,
      targetTransactions,
      mappings,
      sourceCategories,
      targetCategories: categories,
      groupSplits: config.createTargetSplits,
    }),
  };
}

/**
 * Post one revaluation entry. A second one for the same account and day is
 * refused. If an earlier post wrote the row but lost its mapping, this records
 * the mapping for that row and writes nothing, and returns `recovered: true`.
 */
export async function postFxRevaluation(input: {
  flow: SyncFlow;
  targetConnection: ConnectionInstance;
  amount: number;
  rate: string;
  categoryId: string | null;
  date: string;
}): Promise<{ recovered: boolean; uploaded: boolean }> {
  const config = decodeFlowPlanConfig(input.flow);
  if (!Number.isInteger(input.amount) || input.amount === 0) throw new Error("There is no difference to post.");
  const { itemKey, transaction } = buildRevaluationInput({ config, date: input.date, amount: input.amount, rate: input.rate, categoryId: input.categoryId });
  const transport = await open(input.targetConnection);
  const lookup = await transport.getTargetLookupForSync({ accountId: config.targetAccountId });
  const mapRevaluation = (targetId: string, fingerprint: string | null) => api.createMapping({
    flowId: input.flow.id,
    sourceConnectionFingerprint: config.sourceConnectionFingerprint,
    sourceBudgetId: config.sourceBudgetId,
    sourceAccountId: config.sourceAccountId,
    sourceEntityType: "transaction",
    sourceTransactionId: null,
    sourceSplitId: null,
    sourceItemKey: itemKey,
    sourceFingerprint: revaluationFingerprint,
    targetConnectionFingerprint: config.targetConnectionFingerprint,
    targetBudgetId: config.targetBudgetId,
    targetAccountId: config.targetAccountId,
    targetEntityType: "transaction",
    targetTransactionId: targetId,
    targetItemKey: `txn:${targetId}`,
    targetFingerprint: fingerprint,
    targetMarker: transaction.importedId ?? null,
    createdRunId: null,
    lastAppliedAt: new Date().toISOString(),
  });

  const existingId = transaction.importedId ? lookup.importedIdIndex.get(transaction.importedId) : undefined;
  if (existingId) {
    const { mappings } = await api.listMappings(input.flow.id);
    if (mappings.some((mapping) => mapping.sourceItemKey === itemKey)) {
      throw new Error("A revaluation for this account was already posted today.");
    }
    await mapRevaluation(existingId, null);
    return { recovered: true, uploaded: true };
  }
  const { created } = await transport.createTransactionsForSync([transaction]);
  const row = created[0];
  if (!row?.transactionId) throw new Error("The revaluation could not be confirmed on the target budget. Check the account before trying again.");
  await mapRevaluation(row.transactionId, row.applied ? hashTargetFields(row.applied) : null);
  return { recovered: false, uploaded: await uploaded(transport) };
}

function preflight(row: SyncSourceTransaction): TransactionPreflight {
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: row.amount,
    payeeId: row.payeeId,
    categoryId: row.categoryId,
    notes: row.notes,
    reconciled: row.reconciled,
    transferId: row.transferId ?? null,
    isParent: row.isParent,
    isChild: row.isChild,
    parentId: row.parentId,
    childCount: row.splitLines.length,
  };
}

/**
 * Link a synced row to its other side as a real transfer. The synced row takes
 * the counterpart's exact amount, because a transfer's legs must match, and the
 * rate that implies is recorded as what this conversion really cost.
 */
export async function linkSyncedTransfer(input: {
  flow: SyncFlow;
  targetConnection: ConnectionInstance;
  syncedId: string;
  /** The synced row's amount as the user reviewed it. */
  syncedAmount: number;
  /** The other side as the user reviewed it; `amount` is what the synced row will take. */
  counterpart: Pick<TransferRow, "id" | "accountId" | "date" | "amount">;
}): Promise<{ uploaded: boolean }> {
  const config = decodeFlowPlanConfig(input.flow);
  const transport = await open(input.targetConnection);
  if (!transport.linkTransferCounterpart) throw new Error("This connection cannot link transfers.");

  const [targetRows, otherRows, payees, { mappings }] = await Promise.all([
    transport.listTransactionsForSync({ accountId: config.targetAccountId, resolveNames: false }),
    transport.listTransactionsForSync({ accountId: input.counterpart.accountId, startDate: input.counterpart.date, endDate: input.counterpart.date, resolveNames: false }),
    transport.getPayees(),
    api.listMappings(input.flow.id),
  ]);
  const synced = targetRows.find((row) => row.id === input.syncedId);
  const counterpart = otherRows.find((row) => row.id === input.counterpart.id);
  if (!synced || !counterpart) throw new Error("One of these transactions no longer exists. Refresh and try again.");
  if (synced.amount !== input.syncedAmount || counterpart.amount !== input.counterpart.amount) {
    throw new Error("One of these amounts changed after this list was loaded. Refresh and review it again.");
  }
  if (synced.reconciled || synced.transferId || synced.isParent || synced.isChild) {
    throw new Error("The synced transaction is reconciled, split or already a transfer, so it cannot be linked.");
  }
  const transferPayee = payees.find((payee) => payee.transferAccountId === counterpart.accountId);
  if (!transferPayee) throw new Error("The other account has no transfer payee.");
  const mapping = mappings.find((m) => m.targetTransactionId === synced.id);
  if (!mapping) throw new Error("This transaction is no longer linked to its source.");

  const realAmount = -counterpart.amount;
  const originalAmount = synced.amount;
  if (realAmount !== originalAmount) {
    await transport.updateTransactionForSync({
      transactionId: synced.id,
      accountId: synced.accountId,
      date: synced.date,
      amount: realAmount,
      returnApplied: false,
    });
  }
  try {
    await transport.linkTransferCounterpart({
      source: { ...preflight(synced), amount: realAmount },
      counterpart: preflight(counterpart),
      transferPayeeId: transferPayee.id,
    });
  } catch (err) {
    if (realAmount !== originalAmount) {
      await transport.updateTransactionForSync({
        transactionId: synced.id,
        accountId: synced.accountId,
        date: synced.date,
        amount: originalAmount,
        returnApplied: false,
      }).catch(() => undefined);
    }
    throw err;
  }

  // The link is in place; the rest is bookkeeping and must not report it as failed.
  const didUpload = await uploaded(transport);
  try {
    const after = (await transport.listTransactionsForSync({ accountId: synced.accountId, startDate: synced.date, endDate: synced.date, resolveNames: false }))
      .find((row) => row.id === synced.id);
    if (after) {
      await api.updateMapping(mapping.id, {
        targetFingerprint: hashTargetFields({ amount: after.amount, date: after.date, cleared: after.cleared, categoryId: after.categoryId, payeeId: after.payeeId, notes: after.notes }),
      });
    }
    const { snapshots } = await api.listFlowFxSnapshots(input.flow.id);
    const snapshot = snapshots.find((entry) => entry.transactionId === synced.id);
    if (snapshot) {
      await api.updateFxSnapshot({
        transactionId: synced.id,
        fxRateId: null,
        isManual: true,
        appliedRate: impliedRate(snapshot.sourceAmount, realAmount),
        convertedAmount: realAmount,
        requestedDate: snapshot.requestedDate,
        effectiveDate: snapshot.requestedDate,
        source: "manual",
        provider: null,
      });
    }
  } catch {
    // The next preview still sees a linked transfer and leaves it alone.
  }
  return { uploaded: didUpload };
}
