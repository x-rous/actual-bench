import { getBudgetFileSyncCapabilities } from "../capabilities";
import { connectionMatchesBudget } from "../connectionRef";
import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "../flowConfig";
import {
  DEFAULT_SOURCE_FILTER,
  decodeSourceFilter,
  filterSourceItems,
  filterSourceTransactions,
  type SyncSourceFilter,
} from "../sourceFilter";
import { expandSourceTransactions, type SyncSourceItem } from "../sourceItems";
import { planExpandedItems } from "../syncPlanner";
import {
  describeSyncError,
  registerSyncKindAdapter,
  SyncKindError,
  type AdapterApplyContext,
  type AdapterCreateInput,
  type AdapterCreateResult,
  type AdapterMutateInput,
  type AdapterMutateResult,
  type AdapterSourceResult,
  type AdapterSummary,
  type AdapterValidateInput,
  type SyncKindAdapter,
} from "../syncKind";
import { fxNeedDates } from "../fxPolicy";
import { hashTargetFields, targetMatchesBaseline } from "../targetFingerprint";
import type {
  ActualBenchTransport,
  SyncAppliedSnapshot,
  SyncSourceTransaction,
  SyncTargetSplitChild,
  SyncTargetTransactionInput,
} from "@/lib/actual/transport";
import type { JsonObject, SyncCapabilitySet, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { SyncPlannerTargetSnapshot, SyncPlanResult } from "../plannedChanges";

/**
 * Transaction data-type adapter for the unified sync engine (RD-053 behavior,
 * unchanged - this is the behavior-preserving extraction of the original
 * inline transaction logic behind the `SyncKindAdapter` interface).
 */

type MaterializedSource = {
  items: SyncSourceItem[];
  filter: SyncSourceFilter;
  config: SyncFlowPlanConfig;
  /** Every item key in the source account before filters; set when deletions are detected. */
  presentSourceKeys?: string[];
};

/** Keys in both split shapes, so changing the split setting never reads as a deletion. */
function allItemKeys(transactions: SyncSourceTransaction[]): string[] {
  return [
    ...expandSourceTransactions(transactions, { groupSplits: false }),
    ...expandSourceTransactions(transactions, { groupSplits: true }),
  ].map((item) => item.itemKey);
}

/** The persisted fields of every target row, from one account read. */
async function readTargetRows(
  transport: ActualBenchTransport,
  accountId: string
): Promise<Map<string, SyncAppliedSnapshot & { transferId: string | null }>> {
  const rows = await transport.listTransactionsForSync({ accountId, resolveNames: false });
  return new Map(
    rows.map((row) => [
      row.id,
      {
        amount: row.amount,
        date: row.date,
        cleared: row.cleared,
        categoryId: row.categoryId,
        payeeId: row.payeeId,
        notes: row.notes,
        importedPayee: row.importedPayee ?? null,
        transferId: row.transferId ?? null,
      },
    ])
  );
}

function decodeFilterOrDefault(flow: SyncFlow): SyncSourceFilter {
  try {
    return decodeSourceFilter(flow);
  } catch {
    return { ...DEFAULT_SOURCE_FILTER };
  }
}

async function loadTargetSnapshot(
  transport: ActualBenchTransport,
  config: SyncFlowPlanConfig,
  filter: SyncSourceFilter
): Promise<SyncPlannerTargetSnapshot> {
  // The whole account: a mapped row may have moved outside the flow's date window
  // without being deleted. Duplicate checks still only consider the window.
  const lookup = await transport.getTargetLookupForSync({ accountId: config.targetAccountId });
  const categoryGroups = await transport.getCategoryGroups();
  const inWindow = (date: string) =>
    (!filter.startDate || date >= filter.startDate) && (!filter.endDate || date <= filter.endDate);

  return {
    payees: lookup.payees.map((p) => ({ id: p.id, name: p.name })),
    categories: categoryGroups.categories.map((c) => ({ id: c.id, name: c.name })),
    importedIdIndex: lookup.importedIdIndex,
    transactions: lookup.transactions.filter((t) => inWindow(t.date)).map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      payeeName: t.payeeName,
      categoryId: t.categoryId,
    })),
    allTransactionIds: new Set(lookup.transactions.map((t) => t.id)),
  };
}

function diffPlannedVsActual(
  payload: JsonObject,
  resolvedPayeeId: string | null,
  actual: { amount: number; date: string; cleared: boolean; categoryId: string | null; payeeId: string | null; notes: string | null }
): string[] {
  const changed: string[] = [];
  if (payload.amount !== actual.amount) changed.push("amount");
  if (payload.date !== actual.date) changed.push("date");
  if ((payload.cleared ?? false) !== actual.cleared) changed.push("cleared");
  if ((payload.categoryId ?? null) !== (actual.categoryId ?? null)) changed.push("category");
  if ((resolvedPayeeId ?? null) !== (actual.payeeId ?? null)) changed.push("payee");
  if ((payload.notes ?? null) !== (actual.notes ?? null)) changed.push("notes");
  return changed;
}

export const transactionAdapter: SyncKindAdapter = {
  flowType: "transaction_sync",

  validate({ flow, sourceConnection, targetConnection }: AdapterValidateInput): void {
    const config = decodeFlowPlanConfig(flow);
    if (!config.sourceAccountId || !config.targetAccountId) {
      throw new SyncKindError("missing_route", "Source and target accounts must both be selected before previewing.");
    }
    assertConnectionMatches(config.sourceBudgetId, sourceConnection, "source");
    assertConnectionMatches(config.targetBudgetId, targetConnection, "target");

    const sourceCaps = getBudgetFileSyncCapabilities({ mode: sourceConnection.mode });
    const targetCaps = getBudgetFileSyncCapabilities({ mode: targetConnection.mode });
    if (!sourceCaps.supported) throw new SyncKindError("unsupported_connection", sourceCaps.reason ?? "Source connection is unsupported.");
    if (!targetCaps.supported) throw new SyncKindError("unsupported_connection", targetCaps.reason ?? "Target connection is unsupported.");
    if (!sourceCaps.capabilities.listTransactions || !sourceCaps.capabilities.readSplitLines) {
      throw new SyncKindError("unsupported_connection", "Source connection cannot list transactions or split lines.");
    }
    if (!targetCaps.capabilities.listTransactions) {
      throw new SyncKindError("unsupported_connection", "Target connection cannot list transactions for lookup.");
    }
  },

  async loadSource(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterSourceResult> {
    const config = decodeFlowPlanConfig(flow);
    const filter = decodeFilterOrDefault(flow);
    let rawSource;
    try {
      rawSource = await transport.listTransactionsForSync({
        accountId: config.sourceAccountId,
        startDate: filter.startDate ?? undefined,
        endDate: filter.endDate ?? undefined,
      });
    } catch (err) {
      throw new SyncKindError("source_load_failed", describeSyncError(err, "Failed to read source transactions."));
    }
    const scanned = rawSource.length;
    const nonGenerated = filterSourceTransactions(rawSource, filter);
    const generatedExcluded = scanned - nonGenerated.length;
    const expanded = expandSourceTransactions(nonGenerated, { groupSplits: config.createTargetSplits });
    const expandedCount = expanded.length;
    const kept = filterSourceItems(expanded, filter);
    const items = JSON.parse(JSON.stringify(kept)) as SyncSourceItem[];
    // Deletions are judged against the whole account, not the filtered rows.
    let presentSourceKeys: string[] | undefined;
    if (config.detectDeletedSource) {
      try {
        const whole = filter.startDate || filter.endDate
          ? await transport.listTransactionsForSync({ accountId: config.sourceAccountId, resolveNames: false })
          : rawSource;
        presentSourceKeys = allItemKeys(whole);
      } catch (err) {
        throw new SyncKindError("source_load_failed", describeSyncError(err, "Failed to read the source account."));
      }
    }
    const materialized: MaterializedSource = { items, filter, config, presentSourceKeys };
    return { materialized, stats: { scanned, generatedExcluded, expandedCount, keptCount: items.length } };
  },

  async loadTarget(transport: ActualBenchTransport, flow: SyncFlow): Promise<unknown> {
    const config = decodeFlowPlanConfig(flow);
    const filter = decodeFilterOrDefault(flow);
    try {
      return await loadTargetSnapshot(transport, config, filter);
    } catch (err) {
      throw new SyncKindError("target_load_failed", describeSyncError(err, "Failed to read target lookup data."));
    }
  },

  /** Distinct (sourceCurrency → targetCurrency, date) rates this run needs (RD-056). */
  collectFxNeeds(materialized: unknown): { baseCurrency: string; quoteCurrency: string; date: string }[] {
    const source = materialized as MaterializedSource;
    const { config } = source;
    if (!config.fxEnabled || config.fxSourceCurrency === config.fxTargetCurrency) return [];
    const today = new Date().toISOString().slice(0, 10);
    return fxNeedDates(config, source.items.map((item) => item.date), today)
      .map((date) => ({ baseCurrency: config.fxSourceCurrency, quoteCurrency: config.fxTargetCurrency, date }));
  },

  plan({ flow, materialized, target, mappings, targetCapabilities, fxRateByDate, fxPendingByDate, manualFxRates }): SyncPlanResult {
    const source = materialized as MaterializedSource;
    void flow;
    return planExpandedItems({
      config: source.config,
      capabilities: { mode: "browser-api", supported: true, reason: null, capabilities: targetCapabilities },
      sourceItems: source.items,
      target: target as SyncPlannerTargetSnapshot,
      existingMappings: mappings as SyncMapping[],
      detectDeletedSource: source.config.detectDeletedSource && !!source.presentSourceKeys,
      presentSourceKeys: source.presentSourceKeys ? new Set(source.presentSourceKeys) : undefined,
      fxRateByDate,
      fxPendingByDate,
      manualFxRates,
    });
  },

  sourceSummary(flow: SyncFlow): JsonObject {
    const config = decodeFlowPlanConfig(flow);
    return {
      accountId: config.sourceAccountId,
      budgetId: config.sourceBudgetId,
      connectionFingerprint: config.sourceConnectionFingerprint,
    };
  },

  buildSummary(plan: SyncPlanResult, stats): AdapterSummary {
    const c = plan.counts;
    const autoMapped = plan.items.filter((i) => i.flags.includes("exact_duplicate_auto_map")).length;
    const dup = (c.exact_duplicate ?? 0) + (c.strong_duplicate ?? 0) + (c.weak_duplicate ?? 0) - autoMapped;
    return {
      sourceTransactionsScanned: stats.scanned,
      generatedTransactionsExcluded: stats.generatedExcluded,
      sourceItemsScanned: stats.expandedCount,
      sourceItemsFilteredOut: stats.expandedCount - stats.keptCount,
      plannedItems: plan.items.length,
      createCandidates: c.new ?? 0,
      alreadySynced: c.already_synced ?? 0,
      duplicatesSkipped: Math.max(0, dup),
      exactDuplicatesAutoMapped: autoMapped,
      sourceChangedWarnings: c.source_changed_since_sync ?? 0,
      targetMarkerMatches: c.target_marker_match ?? 0,
      blocked: c.blocked ?? 0,
      targetMissing: c.target_missing ?? 0,
    };
  },

  async prepareApply(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterApplyContext> {
    const config = decodeFlowPlanConfig(flow);
    const lookup = await transport.getTargetLookupForSync({ accountId: config.targetAccountId });
    return { markerIndex: lookup.importedIdIndex };
  },

  assertCanApply(caps: SyncCapabilitySet, willCreate: boolean): void {
    if (!willCreate) return;
    if (!caps.createTransaction || !caps.createTransactionWithImportedId) {
      throw new SyncKindError("unsupported_connection", "Target cannot create transactions with a durable marker.");
    }
  },

  async createBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterCreateInput[]
  ): Promise<AdapterCreateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const createInputs: SyncTargetTransactionInput[] = inputs.map(({ payload }) => ({
      accountId: config.targetAccountId,
      date: String(payload.date ?? ""),
      amount: Number(payload.amount ?? 0),
      payeeId: (payload.payeeId as string | null) ?? null,
      payeeName: (payload.payeeName as string | null) ?? null,
      categoryId: (payload.categoryId as string | null) ?? null,
      notes: (payload.notes as string | null) ?? null,
      cleared: payload.cleared === true,
      importedId: (payload.importedId as string | null) ?? null,
      subtransactions: Array.isArray(payload.subtransactions)
        ? (payload.subtransactions as SyncTargetSplitChild[])
        : null,
    }));
    const { created } = await transport.createTransactionsForSync(createInputs);
    return inputs.map((input, i) => {
      const res = created[i];
      const actual = res?.applied ?? null;
      const changedFields = actual
        ? diffPlannedVsActual(input.payload, res?.resolvedPayeeId ?? (input.payload.payeeId as string | null) ?? null, actual)
        : [];
      return {
        itemId: input.itemId,
        targetId: res?.transactionId ?? null,
        changedFields,
        targetFingerprint: actual ? hashTargetFields(actual) : null,
      };
    });
  },

  async updateBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[]
  ): Promise<AdapterMutateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const results: AdapterMutateResult[] = [];
    // Read by id from one account read: the row may still be on its old date when
    // the source date changed.
    const liveRows = await readTargetRows(transport, config.targetAccountId);
    for (const input of inputs) {
      // Per-item try/catch: one failed target write must not discard the results
      // of items already updated earlier in the batch.
      try {
        const payload = input.payload ?? {};
        const live = liveRows.get(input.targetId);
        if (!live) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target no longer exists; not updated." });
          continue;
        }
        // Without a recorded baseline we cannot prove the target is unmodified, so
        // refuse to overwrite it (RD-057 §4). With one, only overwrite a match.
        if (!input.expectedTargetFingerprint) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "No sync baseline for this target; left unchanged." });
          continue;
        }
        if (!targetMatchesBaseline(live, input.expectedTargetFingerprint)) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; left unchanged." });
          continue;
        }
        // A linked transfer's amount and payee are shared with its other leg.
        if (live.transferId) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target is a linked transfer; left unchanged." });
          continue;
        }
        const keepPayee = payload.keepTargetPayee === true;
        const plannedCategory = (payload.categoryId as string | null) ?? null;
        await transport.updateTransactionForSync({
          transactionId: input.targetId,
          accountId: config.targetAccountId,
          date: String(payload.date ?? live.date),
          amount: Number(payload.amount ?? live.amount),
          payeeId: keepPayee ? undefined : (payload.payeeId as string | null) ?? null,
          payeeName: keepPayee ? undefined : (payload.payeeName as string | null) ?? null,
          // Category and cleared state belong to the target budget. A category is
          // only filled in when the target row has none.
          categoryId: live.categoryId == null && plannedCategory ? plannedCategory : undefined,
          notes: (payload.notes as string | null) ?? null,
          returnApplied: false,
        });
        results.push({ itemId: input.itemId, outcome: "updated", targetId: input.targetId });
      } catch (err) {
        results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "Update failed.") });
      }
    }
    // One read for the new baselines. If it fails the writes still stand, so the
    // affected rows simply have no baseline until they are next repaired.
    if (results.some((r) => r.outcome === "updated")) {
      let written: Map<string, SyncAppliedSnapshot> | null = null;
      try {
        written = await readTargetRows(transport, config.targetAccountId);
      } catch {
        written = null;
      }
      for (const result of results) {
        if (result.outcome !== "updated" || !result.targetId) continue;
        const row = written?.get(result.targetId);
        result.targetFingerprint = row ? hashTargetFields(row) : null;
      }
    }
    return results;
  },

  async deleteBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[]
  ): Promise<AdapterMutateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const results: AdapterMutateResult[] = [];
    const liveRows = await readTargetRows(transport, config.targetAccountId);
    for (const input of inputs) {
      // Per-item try/catch so one failed delete doesn't discard earlier successes.
      try {
        const live = liveRows.get(input.targetId);
        if (!live) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target already gone." });
          continue;
        }
        // Only delete a target we can prove is exactly what sync wrote: no baseline
        // (or a mismatch) means it may have been re-used/edited - never delete it.
        if (!input.expectedTargetFingerprint) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "No sync baseline for this target; not deleted." });
          continue;
        }
        if (!targetMatchesBaseline(live, input.expectedTargetFingerprint)) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; not deleted." });
          continue;
        }
        // Deleting one leg of a linked transfer would delete the other account's row too.
        if (live.transferId) {
          results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target is a linked transfer; not deleted." });
          continue;
        }
        await transport.deleteTransactionForSync({ transactionId: input.targetId });
        results.push({ itemId: input.itemId, outcome: "deleted", targetId: input.targetId });
      } catch (err) {
        results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "Delete failed.") });
      }
    }
    return results;
  },
};

function assertConnectionMatches(savedBudgetId: string, connection: AdapterValidateInput["sourceConnection"], side: "source" | "target"): void {
  if (!savedBudgetId) return;
  // Match on the budget's stable id, not the mode/URL fingerprint, so a flow
  // built in Direct mode also runs in HTTP mode against the same budget.
  if (!connectionMatchesBudget(connection, savedBudgetId)) {
    throw new SyncKindError("connection_mismatch", `The ${side} connection is not the budget this flow was saved for.`);
  }
}

registerSyncKindAdapter(transactionAdapter);
