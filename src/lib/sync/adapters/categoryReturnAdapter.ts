import { decodeFlowPlanConfig, type SyncFlowPlanConfig } from "../flowConfig";
import { planCategoryReturn, type CategoryReturnRow } from "../categoryReturn";
import { allKeysOf, expandSourceTransactions, type SyncSourceItem } from "../sourceItems";
import {
  describeSyncError,
  registerSyncKindAdapter,
  SyncKindError,
  type AdapterApplyContext,
  type AdapterCreateResult,
  type AdapterMutateInput,
  type AdapterMutateResult,
  type AdapterSourceResult,
  type AdapterSummary,
  type AdapterValidateInput,
  type AdapterWriteOptions,
  type SyncKindAdapter,
} from "../syncKind";
import { transactionAdapter } from "./transactionAdapter";
import type { ActualBenchTransport, SyncSourceTransaction } from "@/lib/actual/transport";
import type { JsonObject, SyncCapabilitySet, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { SyncPlannedItem, SyncPlanResult } from "../plannedChanges";

/**
 * "Send categories back" on the shared engine. It previews and applies like any
 * other sync, with one difference: it reads a transaction flow in the usual
 * direction but writes to the flow's **source** budget, and only an empty category.
 */

type NamedCategory = { id: string; name: string };
type Source = { config: SyncFlowPlanConfig; transactions: SyncSourceTransaction[]; categories: NamedCategory[] };
type Target = { transactions: SyncSourceTransaction[]; categories: NamedCategory[] };

function itemsByKey(transactions: SyncSourceTransaction[], groupSplits: boolean): Map<string, SyncSourceItem> {
  return new Map(
    expandSourceTransactions(transactions, { groupSplits }).flatMap((item) => allKeysOf(item).map((key) => [key, item] as const))
  );
}

/** True when everything but the category and reconciled state is as it was. */
function sameExceptCategory(a: SyncSourceItem, b: Pick<SyncSourceItem, "amount" | "date" | "payeeId" | "notes">): boolean {
  return a.amount === b.amount && a.date === b.date && (a.payeeId ?? null) === (b.payeeId ?? null) && (a.notes ?? null) === (b.notes ?? null);
}

function plannedItem(row: CategoryReturnRow, config: SyncFlowPlanConfig): SyncPlannedItem {
  return {
    sourceItemKey: row.sourceItemKey,
    sourceEntityType: row.sourceSplitId ? "split_line" : "transaction",
    sourceTransactionId: row.sourceTransactionId,
    sourceSplitId: row.sourceSplitId,
    sourceFingerprint: row.fingerprint,
    usedFallbackKey: false,
    source: { date: row.date, amount: row.amount, payeeName: row.payeeName, categoryName: row.categoryName, notes: row.notes },
    classification: "source_changed_since_sync",
    duplicateConfidence: "none",
    action: "update",
    flags: ["category_return"],
    selectedForApply: true,
    plannedTargetPayload: {
      accountId: config.sourceAccountId,
      date: row.date,
      amount: row.amount,
      payeeId: row.payeeId,
      payeeName: null,
      categoryId: row.categoryId,
      notes: row.notes,
      cleared: false,
      importedId: null,
      mappedTargetId: row.mappedTargetId,
    },
    // The row this run writes to, which for this kind is in the source budget.
    targetTransactionId: row.sourceId,
    message: `Category from ${config.targetBudgetName || "the target"}: ${row.categoryName}`,
  };
}

export const categoryReturnAdapter: SyncKindAdapter = {
  flowType: "category_return",
  writeSide: "source",

  validate(input: AdapterValidateInput): void {
    transactionAdapter.validate(input);
  },

  async loadSource(transport: ActualBenchTransport, flow: SyncFlow): Promise<AdapterSourceResult> {
    const config = decodeFlowPlanConfig(flow);
    try {
      const transactions = await transport.listTransactionsForSync({ accountId: config.sourceAccountId });
      const { categories } = await transport.getCategoryGroups();
      const materialized: Source = { config, transactions, categories: categories.map((c) => ({ id: c.id, name: c.name })) };
      const count = transactions.length;
      return { materialized, stats: { scanned: count, generatedExcluded: 0, expandedCount: count, keptCount: count } };
    } catch (err) {
      throw new SyncKindError("source_load_failed", describeSyncError(err, "Failed to read the source account."));
    }
  },

  async loadTarget(transport: ActualBenchTransport, flow: SyncFlow): Promise<unknown> {
    const config = decodeFlowPlanConfig(flow);
    try {
      const transactions = await transport.listTransactionsForSync({ accountId: config.targetAccountId, resolveNames: false });
      const { categories } = await transport.getCategoryGroups();
      return { transactions, categories: categories.map((c) => ({ id: c.id, name: c.name })) } satisfies Target;
    } catch (err) {
      throw new SyncKindError("target_load_failed", describeSyncError(err, "Failed to read the target account."));
    }
  },

  plan({ flow, materialized, target, mappings }): SyncPlanResult {
    const source = materialized as Source;
    const { transactions, categories } = target as Target;
    const plan = planCategoryReturn({
      sourceTransactions: source.transactions,
      targetTransactions: transactions,
      mappings: mappings as SyncMapping[],
      sourceCategories: source.categories,
      targetCategories: categories,
      groupSplits: source.config.createTargetSplits,
    });
    const items = plan.rows.map((row) => plannedItem(row, source.config));
    return { flowId: flow.id, items, counts: items.length ? { source_changed_since_sync: items.length } : {} };
  },

  sourceSummary(flow: SyncFlow): JsonObject {
    const config = decodeFlowPlanConfig(flow);
    return { accountId: config.sourceAccountId, budgetId: config.sourceBudgetId, connectionFingerprint: config.sourceConnectionFingerprint };
  },

  buildSummary(plan: SyncPlanResult, stats): AdapterSummary {
    return {
      sourceTransactionsScanned: stats.scanned,
      generatedTransactionsExcluded: 0,
      sourceItemsScanned: stats.expandedCount,
      sourceItemsFilteredOut: 0,
      plannedItems: plan.items.length,
      createCandidates: 0,
      alreadySynced: 0,
      duplicatesSkipped: 0,
      exactDuplicatesAutoMapped: 0,
      sourceChangedWarnings: plan.items.length,
      targetMarkerMatches: 0,
      blocked: 0,
    };
  },

  async prepareApply(): Promise<AdapterApplyContext> {
    return { markerIndex: new Map() };
  },

  assertCanApply(caps: SyncCapabilitySet): void {
    if (!caps.updateTransaction) throw new SyncKindError("unsupported_connection", "This connection cannot update transactions.");
  },

  async createBatch(): Promise<AdapterCreateResult[]> {
    return [];
  },

  async updateBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterMutateInput[],
    options?: AdapterWriteOptions
  ): Promise<AdapterMutateResult[]> {
    const config = decodeFlowPlanConfig(flow);
    const before = itemsByKey(
      await transport.listTransactionsForSync({ accountId: config.sourceAccountId, resolveNames: false }),
      config.createTargetSplits
    );
    const results: AdapterMutateResult[] = [];
    const written: { result: AdapterMutateResult; key: string; was: SyncSourceItem }[] = [];
    // Set once a write has been sent: from then on each row is read again (one
    // day of the account) just before its own write.
    let readIsOld = false;
    for (const input of inputs) {
      const payload = input.payload ?? {};
      const key = String(input.sourceItemKey ?? "");
      let live = before.get(key);
      const skip = (message: string) => results.push({ itemId: input.itemId, outcome: "skipped", targetId: input.targetId, message });
      if (live && readIsOld && !options?.shouldStop?.()) {
        try {
          live = itemsByKey(
            await transport.listTransactionsForSync({ accountId: config.sourceAccountId, resolveNames: false, startDate: live.date, endDate: live.date }),
            config.createTargetSplits
          ).get(key);
        } catch (err) {
          results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "The source row could not be read again.") });
          continue;
        }
      }
      if (options?.shouldStop?.()) {
        skip("Apply stopped before this row; left unchanged.");
      } else if (!live) {
        skip("The source row no longer exists.");
      } else if (live.categoryId || live.reconciled) {
        skip("The source row now has a category or is reconciled; left unchanged.");
      } else if (live.splitLines?.length) {
        // The plan never includes a split parent; one that became a split since is not written.
        skip("The source row is now a split; left unchanged.");
      } else if (!sameExceptCategory(live, {
        amount: Number(payload.amount),
        date: String(payload.date),
        payeeId: (payload.payeeId as string | null) ?? null,
        notes: (payload.notes as string | null) ?? null,
      })) {
        // The write has to carry the amount, date and payee, so they must be current.
        skip("The source row changed after the preview; left unchanged.");
      } else {
        try {
          readIsOld = true;
          await transport.updateTransactionForSync({
            transactionId: input.targetId,
            accountId: config.sourceAccountId,
            date: live.date,
            amount: live.amount,
            // Named because Actual gives a split line its parent's payee otherwise.
            payeeId: live.payeeId,
            categoryId: payload.categoryId as string,
            returnApplied: false,
          });
          const result: AdapterMutateResult = { itemId: input.itemId, outcome: "updated", targetId: input.targetId, mappingPatch: {}, message: "Category sent to the source budget." };
          results.push(result);
          written.push({ result, key, was: live });
        } catch (err) {
          results.push({ itemId: input.itemId, outcome: "failed", targetId: input.targetId, message: describeSyncError(err, "The category could not be written.") });
        }
      }
    }
    if (written.length === 0) return results;

    // Acknowledge only the category. A row that changed in any other way keeps its
    // old fingerprint, so the next preview still reports that change.
    try {
      const after = itemsByKey(await transport.listTransactionsForSync({ accountId: config.sourceAccountId }), config.createTargetSplits);
      for (const { result, key, was } of written) {
        const item = after.get(key);
        // A row that is, or became, a grouped split changed shape: keep the old fingerprint.
        if (item && !item.splitLines && !was.splitLines && sameExceptCategory(item, was)) result.mappingPatch = { sourceFingerprint: item.fingerprint };
      }
    } catch {
      // The category is written. The next preview reports it as a source change,
      // which updates nothing the target owns.
    }
    return results;
  },
};

registerSyncKindAdapter(categoryReturnAdapter);
