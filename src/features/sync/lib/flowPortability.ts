import { emptyFlowForm, type SyncFlowFormState } from "./flowForm";

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

export type FlowExport = {
  kind: typeof EXPORT_KIND;
  version: number;
  flow: SyncFlowFormState;
};

/** Strip the ephemeral connection id from an endpoint (names are kept as hints). */
function scrubEndpoint(ep: SyncFlowFormState["source"]): SyncFlowFormState["source"] {
  return { ...ep, connectionId: "" };
}

/** Serialize a flow form to a portable JSON string (no secrets, no connection ids). */
export function exportFlowDefinition(form: SyncFlowFormState): string {
  const flow: SyncFlowFormState = {
    ...form,
    source: scrubEndpoint(form.source),
    target: scrubEndpoint(form.target),
  };
  const payload: FlowExport = { kind: EXPORT_KIND, version: EXPORT_VERSION, flow };
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
  return {
    ...base,
    ...flow,
    // Never trust an imported connection id; force re-selection.
    source: { ...base.source, ...(flow.source ?? {}), connectionId: "" },
    target: { ...base.target, ...(flow.target ?? {}), connectionId: "" },
    filter: { ...base.filter, ...(flow.filter ?? {}) },
    transform: { ...base.transform, ...(flow.transform ?? {}) },
    automation: { ...base.automation, ...(flow.automation ?? {}) },
    entity: { ...base.entity, ...(flow.entity ?? {}) },
  };
}

// --- Starter templates ------------------------------------------------------

export type FlowTemplate = {
  key: string;
  label: string;
  description: string;
  apply: (form: SyncFlowFormState) => SyncFlowFormState;
};

/**
 * Richer starter templates for the create dialog. Each returns a form pre-filled
 * with a common configuration; the user still picks the connections/accounts.
 */
export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "cross_budget_oneway",
    label: "Cross-budget copy",
    description: "One-way transaction sync into another budget, reversing amounts (the default).",
    apply: (form) => ({
      ...form,
      flowType: "transaction_sync",
      transform: { ...form.transform, amountDirection: "reverse" },
    }),
  },
  {
    key: "same_budget_mirror",
    label: "Mirror account (same budget)",
    description: "Copy one account's transactions into another account in the same budget, same sign.",
    apply: (form) => ({
      ...form,
      flowType: "transaction_sync",
      transform: { ...form.transform, amountDirection: "same" },
    }),
  },
  {
    key: "keep_current",
    label: "Keep targets current",
    description: "One-way sync that also updates targets when the source changes.",
    apply: (form) => ({
      ...form,
      flowType: "transaction_sync",
      automation: { ...form.automation, updateMappedTargets: true },
    }),
  },
  {
    key: "shared_payees",
    label: "Shared payees",
    description: "Keep payees in sync between two budgets (no transactions created).",
    apply: (form) => ({ ...form, flowType: "payee_sync" }),
  },
];
