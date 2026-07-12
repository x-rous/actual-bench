import type {
  JsonObject,
  SyncCredentialInput,
  SyncCredentialMeta,
  SyncFlow,
  SyncFlowRun,
  SyncFlowRunItem,
  SyncMapping,
  SyncMappingInput,
  SyncMappingPatch,
  SyncRunTrigger,
} from "@/lib/app-db/types";
import type { SyncPlanResult } from "@/lib/sync/plannedChanges";
import type {
  UpdateSyncFlowRunItemPatch,
  UpdateSyncFlowRunPatch,
} from "@/lib/app-db/syncRunRepository";

/**
 * Thin client for the Budget File Sync server routes (RD-053 / PR-019 Slice 5).
 *
 * The Direct transport runs in the browser; the app DB runs server-side. These
 * helpers are the only bridge - the preview/apply orchestrators run client-side
 * and reach the DB exclusively through here. No sync logic lives in this module.
 */

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    ...init,
  });
  const text = await response.text();
  let data: (T & { error?: string }) | null = null;
  try {
    data = (text ? JSON.parse(text) : {}) as T & { error?: string };
  } catch {
    // Non-JSON body (e.g. an HTML 500 page): fall through to a status-based error.
  }
  if (!response.ok) {
    throw new Error(data?.error ?? `Request to ${input} failed (${response.status})`);
  }
  if (data === null) {
    throw new Error(`Request to ${input} returned a malformed response.`);
  }
  return data;
}

// --- Flows ------------------------------------------------------------------

export function listFlows(): Promise<{ flows: SyncFlow[] }> {
  return jsonFetch("/api/sync-flows");
}

export function getFlow(flowId: string): Promise<{ flow: SyncFlow }> {
  return jsonFetch(`/api/sync-flows/${flowId}`);
}

export function createFlow(body: unknown): Promise<{ flow: SyncFlow }> {
  return jsonFetch("/api/sync-flows", { method: "POST", body: JSON.stringify(body) });
}

export function updateFlow(flowId: string, body: unknown): Promise<{ flow: SyncFlow }> {
  return jsonFetch(`/api/sync-flows/${flowId}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteFlow(flowId: string): Promise<void> {
  return jsonFetch(`/api/sync-flows/${flowId}`, { method: "DELETE" }).then(() => undefined);
}

// --- Mappings ---------------------------------------------------------------

export function listMappings(flowId: string): Promise<{ mappings: SyncMapping[] }> {
  return jsonFetch(`/api/sync-mappings?flowId=${encodeURIComponent(flowId)}`);
}

export function getMappingBySource(flowId: string, sourceItemKey: string): Promise<{ mapping: SyncMapping | null }> {
  return jsonFetch(
    `/api/sync-mappings?flowId=${encodeURIComponent(flowId)}&sourceItemKey=${encodeURIComponent(sourceItemKey)}`
  );
}

export function createMapping(input: SyncMappingInput): Promise<{ mapping: SyncMapping }> {
  return jsonFetch("/api/sync-mappings", { method: "POST", body: JSON.stringify(input) });
}

/** Bulk-create mappings in one request/transaction (apply-run flush). */
export function createMappings(inputs: SyncMappingInput[]): Promise<{ mappings: SyncMapping[] }> {
  return jsonFetch("/api/sync-mappings", { method: "POST", body: JSON.stringify(inputs) });
}

/** Patch a single mapping (RD-057: refresh fingerprints / disable after delete). */
export function updateMapping(
  mappingId: string,
  patch: SyncMappingPatch
): Promise<{ mapping: SyncMapping }> {
  return jsonFetch(`/api/sync-mappings?mappingId=${encodeURIComponent(mappingId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// --- Runs -------------------------------------------------------------------

export function listRuns(flowId: string, limit = 20): Promise<{ runs: SyncFlowRun[] }> {
  return jsonFetch(`/api/sync-flow-runs?flowId=${encodeURIComponent(flowId)}&limit=${limit}`);
}

export function getRun(runId: string): Promise<{ run: SyncFlowRun; items: SyncFlowRunItem[] }> {
  return jsonFetch(`/api/sync-flow-runs/${runId}`);
}

export function persistDraftRun(body: {
  plan: SyncPlanResult;
  summary?: JsonObject;
  sourceSnapshotSummary?: JsonObject;
  trigger?: SyncRunTrigger;
}): Promise<{ runId: string }> {
  return jsonFetch("/api/sync-flow-runs", {
    method: "POST",
    body: JSON.stringify({ kind: "draft", ...body }),
  });
}

export function persistFailedRun(body: {
  flowId: string | null;
  summary?: JsonObject;
  error?: JsonObject;
}): Promise<{ runId: string }> {
  return jsonFetch("/api/sync-flow-runs", {
    method: "POST",
    body: JSON.stringify({ kind: "failed", ...body }),
  });
}

export function updateRun(runId: string, patch: UpdateSyncFlowRunPatch): Promise<{ run: SyncFlowRun }> {
  return jsonFetch(`/api/sync-flow-runs/${runId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function updateRunItem(itemId: string, patch: UpdateSyncFlowRunItemPatch): Promise<{ item: SyncFlowRunItem }> {
  return jsonFetch(`/api/sync-flow-run-items/${itemId}`, { method: "PATCH", body: JSON.stringify(patch) });
}

/** Bulk-update run item statuses in one request/transaction (apply-run flush). */
export function updateRunItems(
  items: { itemId: string; patch: UpdateSyncFlowRunItemPatch }[]
): Promise<{ updated: number }> {
  return jsonFetch("/api/sync-flow-run-items", { method: "PATCH", body: JSON.stringify({ items }) });
}

// --- Credential vault (RD-058 / PR-024) -------------------------------------

/** Vault status + enrolled connection metadata (never secrets). */
export function getVaultStatus(): Promise<{ enabled: boolean; credentials: SyncCredentialMeta[] }> {
  return jsonFetch("/api/sync-credentials");
}

/** Enroll (seal + store) a connection's secret for unattended sync. */
export function enrollCredential(input: SyncCredentialInput): Promise<{ credential: SyncCredentialMeta }> {
  return jsonFetch("/api/sync-credentials", { method: "POST", body: JSON.stringify(input) });
}

/** Withdraw an enrolled credential by connection fingerprint. */
export function withdrawCredential(connectionFingerprint: string): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/sync-credentials?connectionFingerprint=${encodeURIComponent(connectionFingerprint)}`, { method: "DELETE" });
}

/** Trigger one unattended (server-side) safe-sync for a flow immediately. */
export function runFlowNow(flowId: string): Promise<{ result: { status: string; message: string | null } }> {
  return jsonFetch(`/api/sync-flows/${encodeURIComponent(flowId)}/run-now`, { method: "POST" });
}
