"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Lock, Server, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/uuid";
import type { ConnectionInstance } from "@/store/connection";
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import type { RevealedConnectionSecret } from "@/features/connect/vaultApi";
import type { ConnectionCredentialMeta } from "@/lib/app-db/types";
import { deriveLabel, parseApiError } from "./utils";

type Vault = ReturnType<typeof useConnectionVault>;

function buildInstance(meta: ConnectionCredentialMeta, revealed: RevealedConnectionSecret): ConnectionInstance {
  const base = {
    id: generateId(),
    label: meta.label || deriveLabel(meta.baseUrl),
    baseUrl: meta.baseUrl,
    budgetSyncId: meta.budgetSyncId,
    ...(revealed.secret.encryptionPassword ? { encryptionPassword: revealed.secret.encryptionPassword } : {}),
  };
  return revealed.mode === "browser-api"
    ? { ...base, mode: "browser-api", serverPassword: revealed.secret.serverPassword ?? "" }
    : { ...base, mode: "http-api", apiKey: revealed.secret.apiKey ?? "" };
}

/**
 * Remembered connections (RD-061 / PR-026d) — one-click reconnect without
 * re-typing credentials. Unlock once with the passphrase, then reconnect any
 * remembered connection; Direct connections are marked as the weaker path
 * (their password is released to the browser).
 */
export function RememberedConnections({
  vault,
  onReconnect,
  busy,
  activeFingerprints,
}: {
  vault: Vault;
  onReconnect: (instance: ConnectionInstance) => void;
  busy: boolean;
  /** Fingerprints already open in "Your connections" — hidden here to avoid duplicates. */
  activeFingerprints: Set<string>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A remembered connection that's already active this session lives under
  // "Your connections"; don't list it twice.
  const connections = vault.connections.filter(
    (meta) => !activeFingerprints.has(meta.connectionFingerprint)
  );

  if (!vault.status.supported || connections.length === 0) return null;

  const locked = !vault.status.unlocked;

  async function handleUnlock() {
    if (!passphrase) return;
    setUnlocking(true);
    setError(null);
    try {
      await vault.unlock(passphrase);
      setPassphrase("");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setUnlocking(false);
    }
  }

  async function handleReconnect(meta: ConnectionCredentialMeta) {
    setRevealingId(meta.connectionFingerprint);
    setError(null);
    try {
      const revealed = await vault.reveal(meta.connectionFingerprint);
      onReconnect(buildInstance(meta, revealed));
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setRevealingId(null);
    }
  }

  async function handleForget(meta: ConnectionCredentialMeta) {
    try {
      await vault.forget(meta.connectionFingerprint);
      toast.success(`Forgot "${meta.label || deriveLabel(meta.baseUrl)}".`);
    } catch (err) {
      toast.error(parseApiError(err));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Remembered connections
      </h2>

      {locked && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Unlock with your passphrase to reconnect.
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleUnlock(); }}
              placeholder="Passphrase"
              autoComplete="off"
              disabled={unlocking}
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              type="button"
              onClick={() => void handleUnlock()}
              disabled={unlocking || !passphrase}
              className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {unlocking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Unlock"}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {connections.map((meta) => {
          const isDirect = meta.mode === "browser-api";
          const revealing = revealingId === meta.connectionFingerprint;
          return (
            <div
              key={meta.connectionFingerprint}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                {isDirect ? <KeyRound className="h-4 w-4" /> : <Server className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{meta.label || deriveLabel(meta.baseUrl)}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {isDirect ? "Direct" : "HTTP API"}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{meta.baseUrl}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleReconnect(meta)}
                disabled={locked || busy || revealing}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {revealing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reconnect"}
              </button>
              <button
                type="button"
                onClick={() => void handleForget(meta)}
                disabled={busy}
                title="Forget this connection"
                aria-label={`Forget ${meta.label || deriveLabel(meta.baseUrl)}`}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground",
                  "hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
