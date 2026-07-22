import type { ConnectionInstance, ConnectionMode } from "@/store/connection";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import { serverFingerprint } from "@/lib/sync/connectionRef";
import { deriveLabel } from "./utils";

/**
 * A budget under a server, merged across sources (RD-063). A budget can be open
 * this session (`instance`, an in-memory connection), saved in the vault
 * (`saved`), or both — so it appears exactly once in the Connections list with
 * the right state and action.
 */
export type MergedBudget = {
  budgetSyncId: string;
  name: string;
  instance?: ConnectionInstance;
  saved?: RememberedBudget;
};

/** A server grouping its budgets. `savedServer` is set when the server is in the vault. */
export type MergedServer = {
  serverFingerprint: string;
  mode: ConnectionMode;
  baseUrl: string;
  label: string;
  savedServer?: ServerCredentialMeta;
  budgets: MergedBudget[];
};

/**
 * Merge this-session connections with the vault's saved servers + budgets into
 * one server-grouped view. Saved servers/budgets come first (stable, ordered by
 * the vault), then any session-only servers/budgets are appended. Each budget is
 * deduped by its sync id within a server.
 */
export function mergeConnections(
  instances: ConnectionInstance[],
  servers: ServerCredentialMeta[],
  budgets: RememberedBudget[]
): MergedServer[] {
  const groups = new Map<string, MergedServer>();

  function ensureServer(fp: string, seed: () => Omit<MergedServer, "budgets">): MergedServer {
    let group = groups.get(fp);
    if (!group) {
      group = { ...seed(), budgets: [] };
      groups.set(fp, group);
    }
    return group;
  }

  function ensureBudget(group: MergedServer, budgetSyncId: string): MergedBudget {
    let budget = group.budgets.find((b) => b.budgetSyncId === budgetSyncId);
    if (!budget) {
      budget = { budgetSyncId, name: budgetSyncId };
      group.budgets.push(budget);
    }
    return budget;
  }

  // 1) Saved servers (credentialed, vault-ordered).
  for (const server of servers) {
    ensureServer(server.serverFingerprint, () => ({
      serverFingerprint: server.serverFingerprint,
      mode: server.mode as ConnectionMode,
      baseUrl: server.baseUrl,
      label: server.label || deriveLabel(server.baseUrl),
      savedServer: server,
    }));
  }

  // 2) Saved budgets (skip orphans whose server is gone).
  for (const saved of budgets) {
    const group = groups.get(saved.serverFingerprint);
    if (!group) continue;
    const budget = ensureBudget(group, saved.budgetSyncId);
    budget.saved = saved;
    if (saved.name) budget.name = saved.name;
  }

  // 3) This-session connections (may introduce servers/budgets not in the vault).
  for (const instance of instances) {
    const fp = serverFingerprint(instance);
    const group = ensureServer(fp, () => ({
      serverFingerprint: fp,
      mode: instance.mode,
      baseUrl: instance.baseUrl,
      label: deriveLabel(instance.baseUrl),
    }));
    const budget = ensureBudget(group, instance.budgetSyncId);
    budget.instance = instance;
    if (!budget.saved && instance.label) budget.name = instance.label;
  }

  return [...groups.values()];
}
