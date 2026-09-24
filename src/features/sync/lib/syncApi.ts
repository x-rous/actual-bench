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
import { startAndWaitForRun } from "@/features/automations/lib/runPolling";
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
}): Promise<{ runId: string; items: SyncFlowRunItem[] }> {
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

/** An enrolment the server checked and turned down, with its reason code. */
export class EnrolmentFailedError extends Error {
  constructor(
    message: string,
    readonly code: string | null
  ) {
    super(message);
    this.name = "EnrolmentFailedError";
  }
}

/** Reads of the enrolment's status that may fail in a row before the page gives up. */
const MAX_ENROLMENT_READ_FAILURES = 5;
/** Longer than the server's three-minute check, with room to read the answer. */
const ENROLMENT_WAIT_MS = 5 * 60_000;

/**
 * Enrol a connection for unattended use (RD-095 M4).
 *
 * The server checks it against the Actual server first - for Direct that means
 * opening the budget, which can take a while - and stores it only if the check
 * passes. The request answers with an id at once; this follows it to the end,
 * so a caller simply awaits the enrolment as it always has.
 */
export async function enrollCredential(
  input: SyncCredentialInput,
  options: { sleep?: (ms: number) => Promise<void> } = {}
): Promise<{ credential: SyncCredentialMeta }> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const { enrolmentId } = await jsonFetch<{ enrolmentId: string }>("/api/sync-credentials", {
    method: "POST",
    body: JSON.stringify(input),
  });

  const url = `/api/sync-credentials/enrolments/${encodeURIComponent(enrolmentId)}`;
  const deadline = Date.now() + ENROLMENT_WAIT_MS;
  let failures = 0;

  for (;;) {
    await sleep(1_000);
    let response: Response;
    try {
      response = await fetch(url, { cache: "no-store" });
    } catch (error) {
      failures += 1;
      if (failures >= MAX_ENROLMENT_READ_FAILURES) {
        throw new Error(error instanceof Error ? error.message : "Could not reach the server.");
      }
      continue;
    }

    let body: { status?: string; credential?: SyncCredentialMeta; code?: string | null; message?: string; error?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      // Keep the status code.
    }
    // Not found is an answer, not a blip: the server no longer knows this enrolment.
    if (response.status === 404) throw new Error(body.error ?? "This enrolment is no longer being tracked.");
    if (!response.ok) {
      failures += 1;
      if (failures >= MAX_ENROLMENT_READ_FAILURES) throw new Error(body.error ?? `Could not read the enrolment (${response.status}).`);
      continue;
    }
    failures = 0;

    if (body.status === "enrolled" && body.credential) return { credential: body.credential };
    if (body.status === "failed") throw new EnrolmentFailedError(body.message ?? "The check failed.", body.code ?? null);
    if (Date.now() > deadline) {
      throw new Error("The check is taking longer than expected. Look in Connections in a minute to see whether it finished.");
    }
  }
}

/** Withdraw an enrolled credential by connection fingerprint. */
export function withdrawCredential(connectionFingerprint: string): Promise<{ ok: boolean }> {
  return jsonFetch(`/api/sync-credentials?connectionFingerprint=${encodeURIComponent(connectionFingerprint)}`, { method: "DELETE" });
}

/**
 * Run one unattended (server-side) safe-sync for a flow now, and wait for it.
 *
 * The route starts the flow's automation and answers with the run's id; this
 * follows the run to its end and reports it in the sync's own vocabulary
 * ("applied", "no_safe_items", ...), which the job records in its result.
 */
export async function runFlowNow(flowId: string): Promise<{ result: { status: string; message: string | null } }> {
  const run = await startAndWaitForRun(`/api/sync-flows/${encodeURIComponent(flowId)}/run-now`, {
    method: "POST",
  });
  const data = (run.result?.data ?? {}) as { status?: unknown; message?: unknown };
  return {
    result: {
      // A run that threw before the sync reported anything has only the
      // engine's own status to go by.
      status: typeof data.status === "string" ? data.status : run.status,
      message:
        typeof data.message === "string" && data.message ? data.message : (run.rollup?.message ?? null),
    },
  };
}

/** Persist an immutable FX snapshot for a created transaction (RD-056 / PR-025c). */
export function persistFxSnapshot(input: {
  transactionId: string;
  fxRateId: string | null;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  convertedAmount: number;
  appliedRate: string;
  requestedDate: string;
  effectiveDate: string;
  source: string;
  provider: string | null;
}): Promise<{ snapshot: unknown }> {
  return jsonFetch("/api/fx/snapshot", { method: "POST", body: JSON.stringify(input) });
}

/** Update an FX snapshot after a confirmed rate-change re-sync (RD-056 / PR-025 rate-change update). */
export function updateFxSnapshot(input: {
  transactionId: string;
  fxRateId: string | null;
  appliedRate: string;
  convertedAmount: number;
  requestedDate: string;
  effectiveDate: string;
  source: string;
  provider: string | null;
}): Promise<{ ok: boolean }> {
  return jsonFetch("/api/fx/snapshot", { method: "PATCH", body: JSON.stringify(input) });
}

/** Resolve FX rates for a preview's (base, quote, date) needs (RD-056 / PR-025b). */
export function resolveFxRates(
  needs: { baseCurrency: string; quoteCurrency: string; date: string }[],
  allowProvider: boolean
): Promise<{ resolved: Record<string, { requestedDate: string; rate: string; effectiveDate: string; source: string; provider: string | null; fxRateId: string | null }>; pending: Record<string, { code: string; message: string }> }> {
  return jsonFetch("/api/fx/resolve", { method: "POST", body: JSON.stringify({ needs, allowProvider }) });
}
