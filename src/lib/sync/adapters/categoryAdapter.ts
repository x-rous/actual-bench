import { getBudgetFileSyncCapabilities } from "../capabilities";
import { connectionFingerprint } from "../connectionRef";
import {
  buildEntityPlannedItem,
  decodeEntityFlowConfig,
  mappingFor,
  normalizeName,
  toPlanResult,
} from "./entitySupport";
import {
  registerSyncKindAdapter,
  SyncKindError,
  type AdapterApplyContext,
  type AdapterCreateInput,
  type AdapterCreateResult,
  type AdapterSourceResult,
  type AdapterSummary,
  type AdapterValidateInput,
  type SyncKindAdapter,
} from "../syncKind";
import type { ActualBenchTransport } from "@/lib/actual/transport";
import type { JsonObject, SyncCapabilitySet, SyncFlow, SyncMapping } from "@/lib/app-db/types";
import type { EntityTargetPayload, SyncPlanResult } from "../plannedChanges";

/** Category master-data adapter for the unified sync engine (RD-055). */

type SourceCategory = { id: string; name: string; isIncome: boolean; groupName: string };
type MaterializedCategories = { categories: SourceCategory[] };
type TargetCategories = {
  /** `${normName}|${isIncome}` -> category id, for name matching. */
  categoryByKey: Map<string, string>;
  /** `${normGroupName}|${isIncome}` -> group id, for placement. */
  groupByKey: Map<string, string>;
};

const key = (name: string, isIncome: boolean) => `${normalizeName(name)}|${isIncome}`;

function assertEntityRoute({ flow, sourceConnection, targetConnection }: AdapterValidateInput): void {
  const config = decodeEntityFlowConfig(flow);
  if (!config.sourceBudgetId || !config.targetBudgetId) {
    throw new SyncKindError("missing_route", "Source and target budgets must both be selected.");
  }
  for (const [fp, conn, side] of [
    [config.sourceConnectionFingerprint, sourceConnection, "source"],
    [config.targetConnectionFingerprint, targetConnection, "target"],
  ] as const) {
    if (fp && connectionFingerprint(conn) !== fp) {
      throw new SyncKindError("connection_mismatch", `The ${side} connection does not match the one this flow was saved with.`);
    }
    if (!getBudgetFileSyncCapabilities({ mode: conn.mode }).supported) {
      throw new SyncKindError("unsupported_connection", `The ${side} connection does not support Budget File Sync.`);
    }
  }
}

export const categoryAdapter: SyncKindAdapter = {
  flowType: "category_sync",

  validate: assertEntityRoute,

  async loadSource(transport: ActualBenchTransport): Promise<AdapterSourceResult> {
    try {
      const { groups, categories } = await transport.getCategoryGroups();
      const groupName = new Map(groups.map((g) => [g.id, g.name]));
      const src: SourceCategory[] = categories.map((c) => ({
        id: c.id,
        name: c.name,
        isIncome: c.isIncome,
        groupName: groupName.get(c.groupId) ?? "",
      }));
      const materialized: MaterializedCategories = { categories: src };
      return { materialized, stats: { scanned: src.length, generatedExcluded: 0, expandedCount: src.length, keptCount: src.length } };
    } catch (err) {
      throw new SyncKindError("source_load_failed", err instanceof Error ? err.message : "Failed to read source categories.");
    }
  },

  async loadTarget(transport: ActualBenchTransport): Promise<unknown> {
    try {
      const { groups, categories } = await transport.getCategoryGroups();
      const categoryByKey = new Map<string, string>();
      for (const c of categories) {
        const k = key(c.name, c.isIncome);
        if (c.name.trim() && !categoryByKey.has(k)) categoryByKey.set(k, c.id);
      }
      const groupByKey = new Map<string, string>();
      for (const g of groups) {
        const k = key(g.name, g.isIncome);
        if (g.name.trim() && !groupByKey.has(k)) groupByKey.set(k, g.id);
      }
      return { categoryByKey, groupByKey } satisfies TargetCategories;
    } catch (err) {
      throw new SyncKindError("target_load_failed", err instanceof Error ? err.message : "Failed to read target categories.");
    }
  },

  plan({ flow, materialized, target, mappings }): SyncPlanResult {
    const source = materialized as MaterializedCategories;
    const { categoryByKey, groupByKey } = target as TargetCategories;
    const config = decodeEntityFlowConfig(flow);

    const items = source.categories
      .filter((c) => c.name.trim() !== "")
      .map((cat) => {
        const itemKey = `category:${cat.id}`;
        const incomeKind = cat.isIncome ? "income" : "expense";
        const common = { entityType: "category" as const, sourceId: cat.id, name: cat.name, groupName: cat.groupName };

        const mapping = mappingFor(mappings as SyncMapping[], itemKey);
        if (mapping) {
          return buildEntityPlannedItem({ ...common, classification: "already_synced", action: "skip", targetId: mapping.targetTransactionId, entityPayload: null, selectedForApply: false, message: "Already synced." });
        }
        const nameMatch = categoryByKey.get(key(cat.name, cat.isIncome));
        if (nameMatch) {
          return buildEntityPlannedItem({ ...common, classification: "target_name_match", action: "skip", targetId: nameMatch, entityPayload: null, selectedForApply: true, message: "A category with this name and kind exists on the target." });
        }

        // Resolve the target group: matching source group, else configured default.
        let groupId = groupByKey.get(key(cat.groupName, cat.isIncome)) ?? null;
        let placedGroupName = cat.groupName;
        if (!groupId && config.defaultGroupName) {
          groupId = groupByKey.get(key(config.defaultGroupName, cat.isIncome)) ?? null;
          if (groupId) placedGroupName = config.defaultGroupName;
        }

        const payload: EntityTargetPayload = { entity: "category", name: cat.name, incomeKind, groupId, groupName: placedGroupName };
        if (groupId) {
          return buildEntityPlannedItem({ ...common, classification: "new", action: "create", targetId: null, entityPayload: payload, selectedForApply: true, message: null });
        }
        if (config.createMissingGroup && placedGroupName.trim()) {
          return buildEntityPlannedItem({ ...common, classification: "new", action: "create", targetId: null, entityPayload: { ...payload, groupId: null }, selectedForApply: true, flags: [], message: `Will create group “${placedGroupName}”.` });
        }
        // Ambiguous placement - no matching group and no default → review-required.
        return buildEntityPlannedItem({ ...common, classification: "blocked", action: "blocked", targetId: null, entityPayload: null, selectedForApply: false, message: "No matching target group; choose a default group or enable group creation." });
      });

    return toPlanResult(flow.id, items);
  },

  sourceSummary(flow: SyncFlow): JsonObject {
    const config = decodeEntityFlowConfig(flow);
    return { budgetId: config.sourceBudgetId, connectionFingerprint: config.sourceConnectionFingerprint, entity: "category" };
  },

  buildSummary(plan: SyncPlanResult, stats): AdapterSummary {
    const c = plan.counts;
    return {
      sourceTransactionsScanned: stats.scanned,
      generatedTransactionsExcluded: 0,
      sourceItemsScanned: stats.expandedCount,
      sourceItemsFilteredOut: stats.expandedCount - stats.keptCount,
      plannedItems: plan.items.length,
      createCandidates: c.new ?? 0,
      alreadySynced: c.already_synced ?? 0,
      duplicatesSkipped: 0,
      exactDuplicatesAutoMapped: 0,
      sourceChangedWarnings: 0,
      targetMarkerMatches: c.target_name_match ?? 0,
      blocked: c.blocked ?? 0,
    };
  },

  async prepareApply(): Promise<AdapterApplyContext> {
    return { markerIndex: new Map() };
  },

  assertCanApply(_caps: SyncCapabilitySet, _willCreate: boolean): void {
    // Direct mode (the only supported mode, enforced in validate) can create
    // categories and groups; no dedicated capability flag exists.
  },

  async createBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterCreateInput[]
  ): Promise<AdapterCreateResult[]> {
    void flow;
    const results: AdapterCreateResult[] = [];
    const groupCache = new Map<string, string>(); // key(groupName,isIncome) -> created group id
    for (const { itemId, payload } of inputs) {
      try {
        const name = String(payload.name ?? "");
        const isIncome = payload.incomeKind === "income";
        let groupId = (payload.groupId as string | null) ?? null;
        const groupName = String(payload.groupName ?? "");
        if (!groupId && groupName) {
          const gk = key(groupName, isIncome);
          groupId = groupCache.get(gk) ?? (await transport.createCategoryGroup({ name: groupName, isIncome, hidden: false }));
          groupCache.set(gk, groupId);
        }
        if (!groupId) {
          results.push({ itemId, targetId: null, changedFields: [] });
          continue;
        }
        const catId = await transport.createCategory({ name, groupId, isIncome, hidden: false });
        results.push({ itemId, targetId: catId, changedFields: [] });
      } catch {
        results.push({ itemId, targetId: null, changedFields: [] });
      }
    }
    return results;
  },
};

registerSyncKindAdapter(categoryAdapter);
