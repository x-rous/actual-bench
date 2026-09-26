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

/**
 * Client state + actions for the remembered-server vault (RD-061 / RD-063).
 * Encapsulates status, the saved-server list, and the passphrase/enroll
 * operations so the connect UI stays thin. All actions refresh status on
 * completion, and the shared saved-budgets data the toolbar and pickers read,
 * so an unlock, lock or forget here shows there at once.
 */
export function useConnectionVault() {
  const [status, setStatus] = useState<VaultStatus>(CLOSED);
  const [servers, setServers] = useState<ServerCredentialMeta[]>([]);
  const [budgets, setBudgets] = useState<RememberedBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const refresh = useCallback(async () => {
    void queryClient.invalidateQueries({ queryKey: SAVED_BUDGETS_QUERY_KEY });
    try {
      const s = await getVaultStatus();
      setStatus(s);
      queryClient.setQueryData(AUTH_STATUS_QUERY_KEY, s);
      if (s.supported) {
        const { servers: serverList, budgets: budgetList } = await listRememberedServers();
        setServers(serverList);
        setBudgets(budgetList);
      } else {
        setServers([]);
        setBudgets([]);
      }
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
