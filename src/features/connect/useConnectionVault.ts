"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import type { VaultUnlockDuration } from "@/lib/connectionVault/unlockDuration";
import {
  changeVaultPassphrase,
  forgetBudget,
  forgetBudgetEncryption,
  forgetRememberedServer,
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
import { AUTH_STATUS_QUERY_KEY } from "@/hooks/useAuthStatus";
import { REMEMBERED_SERVERS_QUERY_KEY, fetchVault } from "./vaultQueries";

const CLOSED: VaultStatus = {
  supported: false,
  passphraseSet: false,
  unlocked: false,
  authMode: "none",
  passwordFromEnv: false,
};

type RememberedList = Awaited<ReturnType<typeof listRememberedServers>>;

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
 * sign-in, see `preloadVault` in vaultQueries.ts), and refreshes quietly in
 * the background; otherwise it reports `loading` until they arrive.
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
    try {
      // Both at once, through the shared cache: the account menu's own
      // request for the status is the same one, so it shows with the page.
      const [s, list] = await fetchVault(queryClient);
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
