"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConnectionCredentialMeta, ServerCredentialMeta } from "@/lib/app-db/types";
import {
  forgetBudgetEncryption,
  forgetRememberedConnection,
  forgetRememberedServer,
  getVaultStatus,
  listRememberedConnections,
  listRememberedServers,
  lockVault,
  rememberBudgetEncryption,
  rememberConnection,
  rememberServer,
  revealRememberedSecret,
  revealServerSecret,
  setVaultPassphrase,
  unlockVault,
  type RememberBudgetEncryptionInput,
  type RememberConnectionInput,
  type RememberServerInput,
  type RevealedConnectionSecret,
  type RevealedServerSecret,
  type VaultStatus,
} from "./vaultApi";

const CLOSED: VaultStatus = { supported: false, passphraseSet: false, unlocked: false };

/**
 * Client state + actions for the remembered-connection vault (RD-061 / PR-026d).
 * Encapsulates status, the remembered list, and the passphrase/enroll operations
 * so the connect UI stays thin. All actions refresh status on completion.
 */
export function useConnectionVault() {
  const [status, setStatus] = useState<VaultStatus>(CLOSED);
  const [connections, setConnections] = useState<ConnectionCredentialMeta[]>([]);
  const [servers, setServers] = useState<ServerCredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getVaultStatus();
      setStatus(s);
      if (s.supported) {
        const [{ connections: connList }, { servers: serverList }] = await Promise.all([
          listRememberedConnections(),
          listRememberedServers(),
        ]);
        setConnections(connList);
        setServers(serverList);
      } else {
        setConnections([]);
        setServers([]);
      }
    } catch {
      // Vault route unavailable → treat as unsupported rather than surface an error.
      setStatus(CLOSED);
      setConnections([]);
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

  const remember = useCallback(
    async (input: RememberConnectionInput) => {
      await rememberConnection(input);
      await refresh();
    },
    [refresh]
  );

  const forget = useCallback(
    async (connectionFingerprint: string) => {
      await forgetRememberedConnection(connectionFingerprint);
      await refresh();
    },
    [refresh]
  );

  const reveal = useCallback(
    (connectionFingerprint: string): Promise<RevealedConnectionSecret> =>
      revealRememberedSecret(connectionFingerprint),
    []
  );

  // ── Server-scoped actions (RD-063 / PR-028) ────────────────────────────────

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
    connections,
    servers,
    loading,
    refresh,
    setPassphrase,
    unlock,
    lock,
    remember,
    forget,
    reveal,
    rememberServer: rememberSrv,
    forgetServer: forgetSrv,
    revealServer: revealSrv,
    rememberBudgetEncryption: rememberBudgetEnc,
    forgetBudgetEncryption: forgetBudgetEnc,
  };
}
