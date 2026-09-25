"use client";

import { useQuery } from "@tanstack/react-query";
import { useConnectionStore, type ConnectionInstance, type ConnectionMode } from "@/store/connection";
import { buildInstanceFromRevealed, ensureConnectionReady } from "./reconnectFromVault";
import { getVaultStatus, listRememberedServers, revealServerSecret, type VaultStatus } from "./vaultApi";

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

async function readSavedBudgets(): Promise<{ status: VaultStatus; budgets: SavedBudget[] }> {
  const status = await getVaultStatus();
  if (!status.supported) return { status, budgets: [] };
  const { servers, budgets } = await listRememberedServers();
  const byServer = new Map(servers.map((server) => [server.serverFingerprint, server]));
  return {
    status,
    budgets: budgets.flatMap((budget) => {
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
    }),
  };
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
 * connection and add it to the session - the same rebuild the Connect page's
 * one-click reconnect uses.
 *
 *   * `activate`: make it the active budget (the toolbar), after checking it
 *     is reachable, so a dead connection never becomes active.
 *   * otherwise it joins the session in the background (a picker) without
 *     changing the active budget; a Direct budget opens when it is first used.
 */
export async function connectSavedBudget(
  saved: SavedBudget,
  options: { activate: boolean }
): Promise<ConnectionInstance> {
  const revealed = await revealServerSecret(saved.serverFingerprint, saved.budgetSyncId);
  const instance = buildInstanceFromRevealed(revealed, saved.budgetSyncId, saved.name);
  if (options.activate) await ensureConnectionReady(instance);
  const store = useConnectionStore.getState();
  store.addInstance(instance);
  if (options.activate) store.setActiveInstance(instance.id);
  return instance;
}
