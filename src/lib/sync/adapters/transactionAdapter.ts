import { getBudgetFileSyncCapabilities } from "../capabilities";
import { connectionFingerprint } from "../connectionRef";
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
import { hashTargetFields } from "../targetFingerprint";
import type {
  ActualBenchTransport,
  SyncAppliedSnapshot,
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

type MaterializedSource = { items: SyncSourceItem[]; filter: SyncSourceFilter; config: SyncFlowPlanConfig };

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
  const range = { accountId: config.targetAccountId, startDate: filter.startDate ?? undefined, endDate: filter.endDate ?? undefined };
  const lookup = await transport.getTargetLookupForSync(range);
  const categoryGroups = await transport.getCategoryGroups();

  return {
    payees: lookup.payees.map((p) => ({ id: p.id, name: p.name })),
    categories: categoryGroups.categories.map((c) => ({ id: c.id, name: c.name })),
    importedIdIndex: lookup.importedIdIndex,
    transactions: lookup.transactions.map((t) => ({
      id: t.id,
      date: t.date,
      amount: t.amount,
      payeeName: t.payeeName,
      categoryId: t.categoryId,
    })),
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
    assertConnectionMatches(config.sourceConnectionFingerprint, sourceConnection, "source");
    assertConnectionMatches(config.targetConnectionFingerprint, targetConnection, "target");

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
      throw new SyncKindError("source_load_failed", err instanceof Error ? err.message : "Failed to read source transactions.");
    }
    const scanned = rawSource.length;
    const nonGenerated = filterSourceTransactions(rawSource, filter);
    const generatedExcluded = scanned - nonGenerated.length;
    const expanded = expandSourceTransactions(nonGenerated, { groupSplits: config.createTargetSplits });
    const expandedCount = expanded.length;
    const kept = filterSourceItems(expanded, filter);
    const items = JSON.parse(JSON.stringify(kept)) as SyncSourceItem[];
    const materialized: MaterializedSource = { items, filter, config };
    return { materialized, stats: { scanned, generatedExcluded, expandedCount, keptCount: items.length } };
  },

  async loadTarget(transport: ActualBenchTransport, flow: SyncFlow): Promise<unknown> {
    const config = decodeFlowPlanConfig(flow);
    const filter = decodeFilterOrDefault(flow);
    try {
      return await loadTargetSnapshot(transport, config, filter);
    } catch (err) {
      throw new SyncKindError("target_load_failed", err instanceof Error ? err.message : "Failed to read target lookup data.");
    }
  },

  plan({ flow, materialized, target, mappings, targetCapabilities }): SyncPlanResult {
    const source = materialized as MaterializedSource;
    void flow;
    // Deleted-source detection is only safe for a whole-account scan: with a date
    // window, a source item outside the range would look "missing" (RD-057 §5).
    const wholeAccount = !source.filter.startDate && !source.filter.endDate;
    return planExpandedItems({
      config: source.config,
      capabilities: { mode: "browser-api", supported: true, reason: null, capabilities: targetCapabilities },
      sourceItems: source.items,
      target: target as SyncPlannerTargetSnapshot,
      existingMappings: mappings as SyncMapping[],
      detectDeletedSource: source.config.detectDeletedSource && wholeAccount,
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
    for (const input of inputs) {
      const payload = input.payload ?? {};
      // Guard: if the live target no longer matches what sync last wrote, it was
      // edited outside sync - never overwrite a manual edit (RD-057 §4).
      const live = await transport.readTargetTransactionForSync({
        accountId: config.targetAccountId,
        transactionId: input.targetId,
        date: typeof payload.date === "string" ? payload.date : undefined,
      });
      if (!live) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target no longer exists; not updated." });
        continue;
      }
      if (input.expectedTargetFingerprint && hashTargetFields(live) !== input.expectedTargetFingerprint) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; left unchanged." });
        continue;
      }
      const applied: SyncAppliedSnapshot | null = await transport.updateTransactionForSync({
        transactionId: input.targetId,
        accountId: config.targetAccountId,
        date: String(payload.date ?? live.date),
        amount: Number(payload.amount ?? live.amount),
        payeeId: (payload.payeeId as string | null) ?? null,
        payeeName: (payload.payeeName as string | null) ?? null,
        categoryId: (payload.categoryId as string | null) ?? null,
        notes: (payload.notes as string | null) ?? null,
        cleared: payload.cleared === true,
      });
      results.push({
        itemId: input.itemId,
        outcome: "updated",
        targetId: input.targetId,
        targetFingerprint: applied ? hashTargetFields(applied) : null,
      });
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
    for (const input of inputs) {
      // Guard: only delete a target that still matches what sync last wrote, so a
      // target re-used or edited outside sync is never removed (RD-057 §5).
      const live = await transport.readTargetTransactionForSync({
        accountId: config.targetAccountId,
        transactionId: input.targetId,
      });
      if (!live) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: null, message: "Target already gone." });
        continue;
      }
      if (input.expectedTargetFingerprint && hashTargetFields(live) !== input.expectedTargetFingerprint) {
        results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message: "Target was edited outside sync; not deleted." });
        continue;
      }
      await transport.deleteTransactionForSync({ transactionId: input.targetId });
      results.push({ itemId: input.itemId, outcome: "deleted", targetId: input.targetId });
    }
    return results;
  },
};

function assertConnectionMatches(savedFingerprint: string, connection: AdapterValidateInput["sourceConnection"], side: "source" | "target"): void {
  if (!savedFingerprint) return;
  if (connectionFingerprint(connection) !== savedFingerprint) {
    throw new SyncKindError("connection_mismatch", `The ${side} connection does not match the one this flow was saved with.`);
  }
}

registerSyncKindAdapter(transactionAdapter);
