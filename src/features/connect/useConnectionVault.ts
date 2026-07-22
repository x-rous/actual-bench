"use client";

import { useCallback, useEffect, useState } from "react";
import type { ServerCredentialMeta } from "@/lib/app-db/types";
import {
  forgetBudgetEncryption,
  forgetRememberedServer,
  getVaultStatus,
  listRememberedServers,
  lockVault,
  rememberBudgetEncryption,
  rememberServer,
  resetVault,
  revealServerSecret,
  setVaultPassphrase,
  unlockVault,
  type RememberBudgetEncryptionInput,
  type RememberServerInput,
  type RevealedServerSecret,
  type VaultStatus,
} from "./vaultApi";

const CLOSED: VaultStatus = { supported: false, passphraseSet: false, unlocked: false };

/**
 * Client state + actions for the remembered-server vault (RD-061 / RD-063).
 * Encapsulates status, the saved-server list, and the passphrase/enroll
 * operations so the connect UI stays thin. All actions refresh status on
 * completion.
 */
export function useConnectionVault() {
  const [status, setStatus] = useState<VaultStatus>(CLOSED);
  const [servers, setServers] = useState<ServerCredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getVaultStatus();
      setStatus(s);
      if (s.supported) {
        const { servers: serverList } = await listRememberedServers();
        setServers(serverList);
      } else {
        setServers([]);
      }
    } catch {
      // Vault route unavailable → treat as unsupported rather than surface an error.
      setStatus(CLOSED);
      setServers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setPassphrase = useCallback(
    async (passphrase: string) => {
      await setVaultPassphrase(passphrase);
      await refresh();
    },
    [refresh]
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      await unlockVault(passphrase);
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

  return {
    status,
    servers,
    loading,
    refresh,
    setPassphrase,
    unlock,
    lock,
    reset,
    rememberServer: rememberSrv,
    forgetServer: forgetSrv,
    revealServer: revealSrv,
    rememberBudgetEncryption: rememberBudgetEnc,
    forgetBudgetEncryption: forgetBudgetEnc,
  };
}
