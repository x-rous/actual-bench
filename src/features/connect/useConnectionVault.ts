"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConnectionCredentialMeta } from "@/lib/app-db/types";
import {
  forgetRememberedConnection,
  getVaultStatus,
  listRememberedConnections,
  lockVault,
  rememberConnection,
  resetVault,
  revealRememberedSecret,
  setVaultPassphrase,
  unlockVault,
  type RememberConnectionInput,
  type RevealedConnectionSecret,
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
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const s = await getVaultStatus();
      setStatus(s);
      if (s.supported) {
        const { connections: list } = await listRememberedConnections();
        setConnections(list);
      } else {
        setConnections([]);
      }
    } catch {
      // Vault route unavailable → treat as unsupported rather than surface an error.
      setStatus(CLOSED);
      setConnections([]);
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

  return { status, connections, loading, refresh, setPassphrase, unlock, lock, reset, remember, forget, reveal };
}
