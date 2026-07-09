import { connectionFingerprint } from "@/lib/sync/connectionRef";
import { emptyFlowForm, type SyncEndpointForm, type SyncFlowFormState } from "./flowForm";
import type { ConnectionInstance } from "@/store/connection";

/**
 * Build a reverse (mirror) flow form from an existing flow (RD-053 / PR-019
 * Slice 6). The reverse flow swaps source/target so two one-way flows form a
 * two-way sync.
 *
 * Safe defaults:
 * - source/target swapped;
 * - the amount direction is preserved (a reverse-sign flow's mirror is also
 *   reverse-sign, so each budget records the opposite of the other);
 * - filters reset to open-ended (the old filters were tuned for the old source
 *   account, not the swapped one);
 * - generated-transaction exclusion stays on (always enforced by the encoder),
 *   which is what prevents the two flows from echoing each other's writes;
 * - created **disabled** so the user reviews it before it runs.
 */
export function buildReverseFlowForm(
  form: SyncFlowFormState,
  connections: ConnectionInstance[]
): SyncFlowFormState {
  const reverse = emptyFlowForm();

  reverse.name = `${form.name} (reverse)`;
  reverse.enabled = false;
  // Preserve the data type + entity options; only the direction is mirrored.
  reverse.flowType = form.flowType;
  reverse.entity = { ...form.entity };

  // New source = old target. Backfill the budget display name from the live
  // connection when the loaded form did not carry it (cosmetic; self-heals).
  reverse.source = withBudgetName(form.target, connections);
  // New target = old source (already carries its display names).
  reverse.target = { ...form.source };

  // Preserve transform choices (amount direction, payee/category/notes policy).
  reverse.transform = { ...form.transform };

  // Filters reset to safe open-ended defaults; the user tailors them on review.
  reverse.filter = emptyFlowForm().filter;

  return reverse;
}

function withBudgetName(
  endpoint: SyncEndpointForm,
  connections: ConnectionInstance[]
): SyncEndpointForm {
  if (endpoint.budgetName) return { ...endpoint };
  const connection = connections.find((c) => c.id === endpoint.connectionId);
  return { ...endpoint, budgetName: connection?.label ?? "" };
}

/** A flow can be mirrored once both endpoints are chosen. */
export function canCreateReverseFlow(form: SyncFlowFormState): boolean {
  return (
    !!form.source.connectionId &&
    !!form.source.accountId &&
    !!form.target.connectionId &&
    !!form.target.accountId
  );
}

/** Fingerprints of a form's endpoints, for detecting an existing reverse flow. */
export function endpointFingerprints(
  form: SyncFlowFormState,
  connections: ConnectionInstance[]
): { source: string; target: string } {
  const fp = (id: string) => {
    const c = connections.find((conn) => conn.id === id);
    return c ? connectionFingerprint(c) : "";
  };
  return { source: fp(form.source.connectionId), target: fp(form.target.connectionId) };
}
