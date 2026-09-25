"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, type ConnectionInstance, type ConnectionMode } from "@/store/connection";
import { buildInstanceFromRevealed, ensureConnectionReady } from "./reconnectFromVault";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import {
  getVaultStatus,
  listRememberedServers,
  rememberBudget,
  revealServerSecret,
  type VaultStatus,
} from "./vaultApi";

/**
 * Saved budgets - the ones remembered in the connection vault (RD-061/RD-063) -
 * that can be connected with one click from anywhere, not only the Connect
 * page (PR-071b). A remembered server opens any of its budgets, so a saved
 * budget needs nothing typed: the vault reveals its server's password or key
 * (and the budget's encryption password, when one is remembered) once the
 * vault is unlocked for this session.
 *
 * This is the remembered-credential vault (passphrase domain), not the
 * unattended one: nothing here reads or writes enrolled credentials.
 */

export type SavedBudget = {
  serverFingerprint: string;
  budgetSyncId: string;
  name: string;
  mode: ConnectionMode;
  baseUrl: string;
  serverLabel: string;
};

export const SAVED_BUDGETS_QUERY_KEY = ["saved-budgets"] as const;

/**
 * The remembered budgets joined with their servers: one entry per budget, in
 * the vault's order (most recently opened first). A budget whose server is
 * gone is left out. Shared with the Connect page.
 */
export function joinSavedBudgets(servers: ServerCredentialMeta[], budgets: RememberedBudget[]): SavedBudget[] {
  const byServer = new Map(servers.map((server) => [server.serverFingerprint, server]));
  return budgets.flatMap((budget) => {
    const server = byServer.get(budget.serverFingerprint);
    if (!server) return [];
    return [
      {
        serverFingerprint: budget.serverFingerprint,
        budgetSyncId: budget.budgetSyncId,
        name: budget.name || budget.budgetSyncId,
        mode: server.mode,
        baseUrl: server.baseUrl,
        serverLabel: server.label || server.baseUrl,
      },
    ];
  });
}

async function readSavedBudgets(): Promise<{ status: VaultStatus; budgets: SavedBudget[] }> {
  const status = await getVaultStatus();
  if (!status.supported) return { status, budgets: [] };
  const { servers, budgets } = await listRememberedServers();
  return { status, budgets: joinSavedBudgets(servers, budgets) };
}

/**
 * True when this saved budget is already connected in this session, in either
 * mode: the session holds one connection per budget, so connecting it again
 * would only replace that one.
 */
export function isConnected(saved: SavedBudget, instances: ConnectionInstance[]): boolean {
  return instances.some((instance) => instance.budgetSyncId === saved.budgetSyncId);
}

/**
 * The saved budgets that are not connected in this session, and whether the
 * vault must be unlocked before one can be connected.
 */
export function useSavedBudgets(options: { enabled?: boolean } = {}) {
  const instances = useConnectionStore((state) => state.instances);
  const query = useQuery({
    queryKey: SAVED_BUDGETS_QUERY_KEY,
    queryFn: readSavedBudgets,
    enabled: options.enabled ?? true,
    staleTime: 30_000,
    retry: false,
  });
  const status = query.data?.status;
  return {
    saved: (query.data?.budgets ?? []).filter((budget) => !isConnected(budget, instances)),
    /** A passphrase is set and this session has not unlocked it. */
    locked: !!status?.passphraseSet && !status.unlocked,
    refetch: query.refetch,
  };
}

/**
 * Connect a saved budget: reveal its credentials from the vault, rebuild the
 * connection and add it to the session.
 *
 *   * `activate`: make it the active budget (the toolbar, the Connect page),
 *     after checking it is reachable, so a dead connection never joins the
 *     session or replaces a working one.
 *   * otherwise it joins the session in the background (a picker) without
 *     changing the active budget; a Direct budget opens when it is first used.
 *
 * `prepare` runs once the check has passed and before the connection joins the
 * session: the caller drops staged edits and cached data for the budget being
 * left, or reads server versions onto the connection it returns.
 */
export async function connectSavedBudget(
  saved: SavedBudget,
  options: { activate: boolean; prepare?: (instance: ConnectionInstance) => ConnectionInstance | Promise<ConnectionInstance> }
): Promise<ConnectionInstance> {
  const revealed = await revealServerSecret(saved.serverFingerprint, saved.budgetSyncId);
  let instance = buildInstanceFromRevealed(revealed, saved.budgetSyncId, saved.name);
  if (options.activate) await ensureConnectionReady(instance);
  if (options.prepare) instance = await options.prepare(instance);
  const store = useConnectionStore.getState();
  store.addInstance(instance);
  if (options.activate) store.setActiveInstance(instance.id);
  // Keeps the Saved list most-recently-opened first. Best effort: a failure
  // here only leaves the order as it was.
  void Promise.resolve()
    .then(() =>
      rememberBudget({ serverFingerprint: saved.serverFingerprint, budgetSyncId: saved.budgetSyncId, name: saved.name })
    )
    .catch(() => undefined);
  return instance;
}

/** "Could not connect to X: why." - one sentence, whether or not the reason ends in a full stop. */
export function connectFailureMessage(name: string, error: unknown): string {
  const reason = (error instanceof Error && error.message.trim()) || "the server did not answer";
  return `Could not connect to ${name}: ${reason.replace(/[.\s]+$/, "")}.`;
}
