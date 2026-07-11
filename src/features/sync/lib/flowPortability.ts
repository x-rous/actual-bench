import { emptyFlowForm, type SyncEndpointForm, type SyncFlowFormState } from "./flowForm";

/**
 * Portable flow definitions (RD-057 §7 / candidate list): export a flow's
 * non-secret configuration to JSON and re-import it to recreate the flow.
 *
 * Connection ids are ephemeral and local to a session, and passwords/api keys
 * are never part of the form, so neither is exported. On import the endpoints
 * carry only their budget/account *names* as hints; the user re-selects live
 * connections before saving.
 */

const EXPORT_KIND = "actual-bench-sync-flow";
const EXPORT_VERSION = 1;

type ExportedEndpoint = Omit<SyncEndpointForm, "connectionId">;

export type FlowExport = {
  kind: typeof EXPORT_KIND;
  version: number;
  flow: Omit<SyncFlowFormState, "source" | "target"> & { source: ExportedEndpoint; target: ExportedEndpoint };
};

/** Drop the ephemeral connection id from an endpoint (names are kept as hints). */
function scrubEndpoint(ep: SyncEndpointForm): ExportedEndpoint {
  const { connectionId: _drop, ...rest } = ep;
  void _drop;
  return rest;
}

/** Serialize a flow form to a portable JSON string (no secrets, no connection ids). */
export function exportFlowDefinition(form: SyncFlowFormState): string {
  const payload: FlowExport = {
    kind: EXPORT_KIND,
    version: EXPORT_VERSION,
    flow: { ...form, source: scrubEndpoint(form.source), target: scrubEndpoint(form.target) },
  };
  return JSON.stringify(payload, null, 2);
}

export class FlowImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlowImportError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

/**
 * Parse an exported flow definition back into form state. Merges over a fresh
 * default form so a partial/older export still yields a valid, editable flow;
 * connection ids are cleared so the user re-selects live connections. Throws
 * FlowImportError on anything that isn't a recognizable export.
 */
export function importFlowDefinition(json: string): SyncFlowFormState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new FlowImportError("That file is not valid JSON.");
  }
  if (!isRecord(parsed) || parsed.kind !== EXPORT_KIND || !isRecord(parsed.flow)) {
    throw new FlowImportError("That file is not an Actual Bench sync-flow export.");
  }

  const base = emptyFlowForm();
  const flow = parsed.flow as Partial<SyncFlowFormState>;
  const flowType =
    flow.flowType === "transaction_sync" || flow.flowType === "payee_sync" || flow.flowType === "category_sync"
      ? flow.flowType
      : base.flowType;
  return {
    ...base,
    ...flow,
    // Top-level scalars must be well-typed: a non-string `name` would crash the
    // dialog on render (missingRouteFields calls name.trim()) outside the import
    // try/catch, bypassing the friendly FlowImportError.
    name: typeof flow.name === "string" ? flow.name : base.name,
    enabled: typeof flow.enabled === "boolean" ? flow.enabled : base.enabled,
    flowType,
    // Never trust an imported connection id; force re-selection.
    source: { ...base.source, ...(flow.source ?? {}), connectionId: "" },
    target: { ...base.target, ...(flow.target ?? {}), connectionId: "" },
    filter: { ...base.filter, ...(flow.filter ?? {}) },
    transform: { ...base.transform, ...(flow.transform ?? {}) },
    automation: { ...base.automation, ...(flow.automation ?? {}) },
    entity: { ...base.entity, ...(flow.entity ?? {}) },
  };
}
