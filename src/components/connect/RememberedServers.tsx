"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Lock, Plus, Server, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import { deriveLabel, parseApiError } from "./utils";

type Vault = ReturnType<typeof useConnectionVault>;

/**
 * Continue (RD-063) — one-click reconnect straight into a budget you've opened
 * before. Credentials are server-scoped, so unlock once and any budget on a
 * saved server reopens without re-typing; its encryption password (if any) is
 * revealed behind the scenes. "Open another budget" loads a server's full list
 * to reach a budget you haven't opened here yet.
 */
export function RememberedServers({
  vault,
  onOpenBudget,
  onOpenServer,
  busy,
}: {
  vault: Vault;
  /** Reveal + reconnect straight into a remembered budget. Rejects on failure. */
  onOpenBudget: (server: ServerCredentialMeta, budget: RememberedBudget) => Promise<void>;
  /** Reveal the server and load its budget list to pick a different budget. Rejects on failure. */
  onOpenServer: (server: ServerCredentialMeta) => Promise<void>;
  busy: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
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

  async function runBusy(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setBusyKey(null);
    }
  }

  async function handleForgetBudget(server: ServerCredentialMeta, budget: RememberedBudget) {
    try {
      await vault.forgetBudget(budget.serverFingerprint, budget.budgetSyncId);
    } catch (err) {
      toast.error(parseApiError(err));
    }
    // Forgetting the last budget leaves the server saved; drop it too so the
    // list doesn't keep an unreachable server around.
    const remaining = vault.budgets.filter(
      (b) => b.serverFingerprint === server.serverFingerprint && b.budgetSyncId !== budget.budgetSyncId
    );
    if (remaining.length === 0) {
      try {
        await vault.forgetServer(server.serverFingerprint);
      } catch {
        // Non-fatal — the server row simply stays with no budgets.
      }
    }
  }

  async function handleForgetServer(server: ServerCredentialMeta) {
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
            Unlock with your passphrase to reopen a saved budget.
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

      <div className="flex max-h-[26rem] flex-col gap-4 overflow-y-auto">
        {vault.servers.map((server) => {
          const isDirect = server.mode === "browser-api";
          const serverBudgets = vault.budgets.filter(
            (b) => b.serverFingerprint === server.serverFingerprint
          );
          const openAnotherKey = `server:${server.serverFingerprint}`;
          return (
            <div key={server.serverFingerprint} className="flex flex-col gap-1.5">
              {/* Server header */}
              <div className="flex items-center gap-2 px-0.5">
                {isDirect ? (
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate text-xs font-medium">{server.label || deriveLabel(server.baseUrl)}</span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  {isDirect ? "Direct" : "HTTP API"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{server.baseUrl}</span>
                <button
                  type="button"
                  onClick={() => void handleForgetServer(server)}
                  disabled={busy}
                  title="Forget this server and its saved budgets"
                  aria-label={`Forget ${server.label || deriveLabel(server.baseUrl)}`}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Remembered budgets — one-click reconnect */}
              {serverBudgets.map((budget) => {
                const key = `budget:${budget.serverFingerprint}:${budget.budgetSyncId}`;
                const opening = busyKey === key;
                return (
                  <div key={key} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void runBusy(key, () => onOpenBudget(server, budget))}
                      disabled={locked || busy || busyKey !== null}
                      className={cn(
                        "flex min-w-0 flex-1 items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors",
                        "hover:border-muted-foreground/40 hover:bg-muted/40 disabled:opacity-50"
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {budget.name || budget.budgetSyncId}
                      </span>
                      {opening ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="shrink-0 text-xs font-medium text-primary">Open</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleForgetBudget(server, budget)}
                      disabled={busy || busyKey !== null}
                      title="Forget this budget"
                      aria-label={`Forget ${budget.name || budget.budgetSyncId}`}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}

              {/* Open a budget not opened here yet */}
              <button
                type="button"
                onClick={() => void runBusy(openAnotherKey, () => onOpenServer(server))}
                disabled={locked || busy || busyKey !== null}
                className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {busyKey === openAnotherKey ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Open another budget
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
