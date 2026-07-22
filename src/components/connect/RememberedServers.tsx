"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Lock, Server, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import type { ServerCredentialMeta } from "@/lib/app-db/types";
import { deriveLabel, parseApiError } from "./utils";

type Vault = ReturnType<typeof useConnectionVault>;

/**
 * Remembered servers (RD-063). A saved server credential opens *any* of its
 * budgets, so this replaces per-budget reconnect: unlock once, click a server,
 * and its budget list loads for you to pick from. Direct servers release their
 * password to the browser on reconnect — the same exposure as typing it.
 */
export function RememberedServers({
  vault,
  onStart,
  busy,
}: {
  vault: Vault;
  /** Reveal the server's secret and load its budgets. Rejects on failure. */
  onStart: (server: ServerCredentialMeta) => Promise<void>;
  busy: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [startingFp, setStartingFp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  if (!vault.status.supported || vault.servers.length === 0) return null;

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

  async function handleStart(server: ServerCredentialMeta) {
    setStartingFp(server.serverFingerprint);
    setError(null);
    try {
      await onStart(server);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setStartingFp(null);
    }
  }

  async function handleReset() {
    setResetting(true);
    setError(null);
    try {
      await vault.reset();
      setConfirmReset(false);
      setPassphrase("");
      toast.success("Vault reset. Set a passphrase to start saving servers again.");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setResetting(false);
    }
  }

  async function handleForget(server: ServerCredentialMeta) {
    try {
      await vault.forgetServer(server.serverFingerprint);
      toast.success(`Forgot "${server.label || deriveLabel(server.baseUrl)}".`);
    } catch (err) {
      toast.error(parseApiError(err));
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Continue
      </h2>

      {locked && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" />
            Unlock with your passphrase to open a saved server.
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

          {confirmReset ? (
            <div className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5">
              <p className="text-xs text-muted-foreground">
                Forgot it? Resetting removes all saved servers and clears the passphrase so you can set a
                new one. Your budgets and their data are untouched.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  disabled={resetting}
                  className="flex h-8 items-center gap-1.5 rounded-md bg-destructive px-3 text-xs font-medium text-white disabled:opacity-50"
                >
                  {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reset vault"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  disabled={resetting}
                  className="flex h-8 items-center rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="self-start text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Forgot passphrase?
            </button>
          )}
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto">
        {vault.servers.map((server) => {
          const isDirect = server.mode === "browser-api";
          const starting = startingFp === server.serverFingerprint;
          return (
            <div
              key={server.serverFingerprint}
              className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                {isDirect ? <KeyRound className="h-4 w-4" /> : <Server className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{server.label || deriveLabel(server.baseUrl)}</span>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                    {isDirect ? "Direct" : "HTTP API"}
                  </span>
                </div>
                <div className="truncate text-xs text-muted-foreground">{server.baseUrl}</div>
              </div>
              <button
                type="button"
                onClick={() => void handleStart(server)}
                disabled={locked || busy || starting}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Open"}
              </button>
              <button
                type="button"
                onClick={() => void handleForget(server)}
                disabled={busy}
                title="Forget this server"
                aria-label={`Forget ${server.label || deriveLabel(server.baseUrl)}`}
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
