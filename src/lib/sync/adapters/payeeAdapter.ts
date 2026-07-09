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
import type { SyncPlanResult } from "../plannedChanges";

/** Payee master-data adapter for the unified sync engine (RD-055). */

type Payee = { id: string; name: string };
type MaterializedPayees = { payees: Payee[] };
type TargetPayees = { byName: Map<string, string> };

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

export const payeeAdapter: SyncKindAdapter = {
  flowType: "payee_sync",

  validate: assertEntityRoute,

  async loadSource(transport: ActualBenchTransport): Promise<AdapterSourceResult> {
    let payees: Payee[];
    try {
      payees = (await transport.getPayees()).map((p) => ({ id: p.id, name: p.name }));
    } catch (err) {
      throw new SyncKindError("source_load_failed", err instanceof Error ? err.message : "Failed to read source payees.");
    }
    const materialized: MaterializedPayees = { payees };
    return { materialized, stats: { scanned: payees.length, generatedExcluded: 0, expandedCount: payees.length, keptCount: payees.length } };
  },

  async loadTarget(transport: ActualBenchTransport): Promise<unknown> {
    try {
      const byName = new Map<string, string>();
      for (const p of await transport.getPayees()) {
        const key = normalizeName(p.name);
        if (key && !byName.has(key)) byName.set(key, p.id);
      }
      return { byName } satisfies TargetPayees;
    } catch (err) {
      throw new SyncKindError("target_load_failed", err instanceof Error ? err.message : "Failed to read target payees.");
    }
  },

  plan({ flow, materialized, target, mappings }): SyncPlanResult {
    const source = materialized as MaterializedPayees;
    const { byName } = target as TargetPayees;
    const items = source.payees
      .filter((p) => p.name.trim() !== "")
      .map((payee) => {
        const key = `payee:${payee.id}`;
        const mapping = mappingFor(mappings as SyncMapping[], key);
        if (mapping) {
          return buildEntityPlannedItem({
            entityType: "payee", sourceId: payee.id, name: payee.name,
            classification: "already_synced", action: "skip", targetId: mapping.targetTransactionId,
            entityPayload: null, selectedForApply: false, message: "Already synced.",
          });
        }
        const match = byName.get(normalizeName(payee.name));
        if (match) {
          return buildEntityPlannedItem({
            entityType: "payee", sourceId: payee.id, name: payee.name,
            classification: "target_name_match", action: "skip", targetId: match,
            entityPayload: null, selectedForApply: true,
            message: "A payee with this name exists on the target; mapping can be recorded.",
          });
        }
        return buildEntityPlannedItem({
          entityType: "payee", sourceId: payee.id, name: payee.name,
          classification: "new", action: "create", targetId: null,
          entityPayload: { entity: "payee", name: payee.name }, selectedForApply: true, message: null,
        });
      });
    return toPlanResult(flow.id, items);
  },

  sourceSummary(flow: SyncFlow): JsonObject {
    const config = decodeEntityFlowConfig(flow);
    return { budgetId: config.sourceBudgetId, connectionFingerprint: config.sourceConnectionFingerprint, entity: "payee" };
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
      // Name matches are the entity analogue of marker matches (safe map-only).
      targetMarkerMatches: c.target_name_match ?? 0,
      blocked: c.blocked ?? 0,
    };
  },

  async prepareApply(): Promise<AdapterApplyContext> {
    return { markerIndex: new Map() };
  },

  assertCanApply(caps: SyncCapabilitySet, willCreate: boolean): void {
    if (willCreate && !caps.createPayee) {
      throw new SyncKindError("unsupported_connection", "Target cannot create payees in this mode.");
    }
  },

  async createBatch(
    transport: ActualBenchTransport,
    flow: SyncFlow,
    inputs: AdapterCreateInput[]
  ): Promise<AdapterCreateResult[]> {
    void flow;
    const results: AdapterCreateResult[] = [];
    // Sequential (no batch primitive) but cheap. Isolate per item so one failure
    // doesn't abort the batch and lose the successes recorded before it.
    for (const { itemId, payload } of inputs) {
      try {
        const name = String(payload.name ?? "");
        const created = await transport.createPayee({ name });
        results.push({ itemId, targetId: created.id, changedFields: [] });
      } catch {
        results.push({ itemId, targetId: null, changedFields: [] });
      }
    }
    return results;
  },
};

registerSyncKindAdapter(payeeAdapter);
