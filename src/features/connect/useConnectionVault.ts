"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import type { VaultUnlockDuration } from "@/lib/connectionVault/unlockDuration";
import {
  changeVaultPassphrase,
  forgetBudget,
  forgetBudgetEncryption,
  forgetRememberedServer,
  getVaultStatus,
  listRememberedServers,
  lockVault,
  rememberBudget,
  rememberBudgetEncryption,
  rememberServer,
  resetVault,
  revealServerSecret,
  setVaultPassphrase,
  unlockVault,
  type RememberBudgetEncryptionInput,
  type RememberBudgetInput,
  type RememberServerInput,
  type RevealedServerSecret,
  type VaultStatus,
} from "./vaultApi";
import { SAVED_BUDGETS_QUERY_KEY } from "./savedBudgets";
import { AUTH_STATUS_QUERY_KEY } from "@/hooks/useAuthStatus";

const CLOSED: VaultStatus = {
  supported: false,
  passphraseSet: false,
  unlocked: false,
  authMode: "none",
  passwordFromEnv: false,
};

export const REMEMBERED_SERVERS_QUERY_KEY = ["remembered-servers"] as const;

type RememberedList = Awaited<ReturnType<typeof listRememberedServers>>;

function fetchStatus(queryClient: QueryClient) {
  return queryClient.fetchQuery({ queryKey: AUTH_STATUS_QUERY_KEY, queryFn: getVaultStatus, staleTime: 0 });
}

function fetchRememberedList(queryClient: QueryClient) {
  return queryClient.fetchQuery({ queryKey: REMEMBERED_SERVERS_QUERY_KEY, queryFn: listRememberedServers, staleTime: 0 });
}

/**
 * Load the vault's status and saved servers into the shared cache, both at
 * once. The sign-in page calls it before moving on, so the connect page opens
 * on the saved budgets instead of loading them itself (RD-096).
 */
export async function preloadVault(queryClient: QueryClient): Promise<void> {
  await Promise.all([fetchStatus(queryClient), fetchRememberedList(queryClient)]);
}

type VaultView = { status: VaultStatus; servers: ServerCredentialMeta[]; budgets: RememberedBudget[] };

function viewOf(status: VaultStatus, list: RememberedList | null | undefined): VaultView {
  const usable = status.supported && list;
  return { status, servers: usable ? list.servers : [], budgets: usable ? list.budgets : [] };
}

/**
 * Client state + actions for the remembered-server vault (RD-061 / RD-063).
 * Encapsulates status, the saved-server list, and the passphrase/enroll
 * operations so the connect UI stays thin. All actions refresh status on
 * completion, and the shared saved-budgets data the toolbar and pickers read,
 * so an unlock, lock or forget here shows there at once.
 *
 * Starts from the shared cache when it already holds both halves (after
 * sign-in, see `preloadVault`), and refreshes quietly in the background;
 * otherwise it reports `loading` until they arrive.
 */
export function useConnectionVault() {
  const queryClient = useQueryClient();
  const [cached] = useState<VaultView | null>(() => {
    const status = queryClient.getQueryData<VaultStatus>(AUTH_STATUS_QUERY_KEY);
    const list = queryClient.getQueryData<RememberedList>(REMEMBERED_SERVERS_QUERY_KEY);
    return status && list ? viewOf(status, list) : null;
  });
  const [status, setStatus] = useState<VaultStatus>(cached?.status ?? CLOSED);
  const [servers, setServers] = useState<ServerCredentialMeta[]>(cached?.servers ?? []);
  const [budgets, setBudgets] = useState<RememberedBudget[]>(cached?.budgets ?? []);
  const [loading, setLoading] = useState(cached === null);

  const refresh = useCallback(async () => {
    void queryClient.invalidateQueries({ queryKey: SAVED_BUDGETS_QUERY_KEY });
    try {
      // Both at once, through the shared cache: the account menu's own
      // request for the status is the same one, so it shows with the page.
      const [s, list] = await Promise.all([
        fetchStatus(queryClient),
        fetchRememberedList(queryClient).catch(() => null),
      ]);
      const view = viewOf(s, list);
      setStatus(view.status);
      setServers(view.servers);
      setBudgets(view.budgets);
    } catch {
      // Vault route unavailable → treat as unsupported rather than surface an error.
      setStatus(CLOSED);
      setServers([]);
      setBudgets([]);
    } finally {
      setLoading(false);
    }
  }, [queryClient]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPassphrase = useCallback(
    async (passphrase: string, duration: VaultUnlockDuration) => {
      await setVaultPassphrase(passphrase, duration);
      await refresh();
    },
    [refresh]
  );

  const unlock = useCallback(
    async (passphrase: string, duration: VaultUnlockDuration) => {
      await unlockVault(passphrase, duration);
      await refresh();
    },
    [refresh]
  );

  const lock = useCallback(async () => {
    await lockVault();
    await refresh();
  }, [refresh]);

  const reset = useCallback(async () => {
    await resetVault();
    await refresh();
  }, [refresh]);

  const changePassphrase = useCallback(
    async (
      currentPassphrase: string,
      newPassphrase: string,
      duration: VaultUnlockDuration
    ) => {
      await changeVaultPassphrase(currentPassphrase, newPassphrase, duration);
      await refresh();
    },
    [refresh]
  );

  // ── Server-scoped actions (RD-063) ─────────────────────────────────────────

  const rememberSrv = useCallback(
    async (input: RememberServerInput) => {
      await rememberServer(input);
      await refresh();
    },
    [refresh]
  );

  const forgetSrv = useCallback(
    async (serverFingerprint: string) => {
      await forgetRememberedServer(serverFingerprint);
      await refresh();
    },
    [refresh]
  );

  const revealSrv = useCallback(
    (serverFingerprint: string, budgetSyncId?: string): Promise<RevealedServerSecret> =>
      revealServerSecret(serverFingerprint, budgetSyncId),
    []
  );

  const rememberBudgetEnc = useCallback(
    async (input: RememberBudgetEncryptionInput) => {
      await rememberBudgetEncryption(input);
      await refresh();
    },
    [refresh]
  );

  const forgetBudgetEnc = useCallback(
    async (serverFingerprint: string, budgetSyncId: string) => {
      await forgetBudgetEncryption(serverFingerprint, budgetSyncId);
      await refresh();
    },
    [refresh]
  );

  const rememberBudgetMeta = useCallback(
    async (input: RememberBudgetInput) => {
      await rememberBudget(input);
      await refresh();
    },
    [refresh]
  );

  const forgetBudgetMeta = useCallback(
    async (serverFingerprint: string, budgetSyncId: string) => {
      await forgetBudget(serverFingerprint, budgetSyncId);
      await refresh();
    },
    [refresh]
  );

  return {
    status,
    servers,
    budgets,
    loading,
    refresh,
    setPassphrase,
    unlock,
    lock,
    reset,
    changePassphrase,
    rememberServer: rememberSrv,
    forgetServer: forgetSrv,
    revealServer: revealSrv,
    rememberBudgetEncryption: rememberBudgetEnc,
    forgetBudgetEncryption: forgetBudgetEnc,
    rememberBudget: rememberBudgetMeta,
    forgetBudget: forgetBudgetMeta,
  };
}
