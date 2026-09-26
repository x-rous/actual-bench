import type { QueryClient } from "@tanstack/react-query";
import { AUTH_STATUS_QUERY_KEY } from "@/hooks/useAuthStatus";
import { getVaultStatus, listRememberedServers } from "./vaultApi";

/**
 * The saved-connections vault's two answers, cached once for everyone who
 * reads them: the sign-in page, the connect page, the account menu and the
 * budget switcher. Fetched in parallel; neither waits on the other.
 */

export const REMEMBERED_SERVERS_QUERY_KEY = ["remembered-servers"] as const;

export const vaultStatusQuery = { queryKey: AUTH_STATUS_QUERY_KEY, queryFn: getVaultStatus };
export const rememberedServersQuery = { queryKey: REMEMBERED_SERVERS_QUERY_KEY, queryFn: listRememberedServers };

/** Fetch both now, whatever the cache holds (after the vault changed). */
export function fetchVault(queryClient: QueryClient) {
  return Promise.all([
    queryClient.fetchQuery({ ...vaultStatusQuery, staleTime: 0 }),
    queryClient.fetchQuery({ ...rememberedServersQuery, staleTime: 0 }).catch(() => null),
  ]);
}

/**
 * Load both into the cache. The sign-in page calls it before moving on, so the
 * next page opens on the saved budgets instead of loading them itself.
 */
export async function preloadVault(queryClient: QueryClient): Promise<void> {
  await fetchVault(queryClient);
}

/** The vault changed (unlocked, locked, a budget remembered): read it again. */
export function invalidateVault(queryClient: QueryClient): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: AUTH_STATUS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: REMEMBERED_SERVERS_QUERY_KEY }),
  ]).then(() => undefined);
}
