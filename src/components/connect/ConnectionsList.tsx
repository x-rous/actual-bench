"use client";

import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, Loader2, Lock, Plus, Server, Settings2, Trash2, Unlock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ConnectionInstance } from "@/store/connection";
import type { RememberedBudget, ServerCredentialMeta } from "@/lib/app-db/types";
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import type { MergedBudget, MergedServer } from "./mergeConnections";
import { deriveLabel, parseApiError } from "./utils";

const MIN_PASSPHRASE_LENGTH = 8;

type Vault = ReturnType<typeof useConnectionVault>;

/**
 * Connections (RD-063) — one server-grouped list of everything you can open:
 * budgets loaded this session (instant, no unlock) and budgets saved in the
 * vault (unlock once, then reconnect without re-typing). Each budget appears
 * once with `open` / `saved` state; "Open another budget" loads a saved
 * server's full list to reach a budget you haven't opened here yet. A dedicated
 * security bar makes the vault state (and its lock / change-passphrase actions)
 * unmistakable.
 */
export function ConnectionsList({
  vault,
  servers,
  onReconnectInstance,
  reconnectBusyId,
  onOpenBudget,
  onOpenServer,
  onForgetInstance,
  busy,
}: {
  vault: Vault;
  servers: MergedServer[];
  /** Instantly reconnect an in-memory session connection. */
  onReconnectInstance: (instance: ConnectionInstance) => void;
  /** Id of the session connection currently reconnecting (for its spinner). */
  reconnectBusyId: string | null;
  /** Reveal + reconnect straight into a saved budget. Rejects on failure. */
  onOpenBudget: (server: ServerCredentialMeta, budget: RememberedBudget) => Promise<void>;
  /** Reveal a saved server and load its full budget list. Rejects on failure. */
  onOpenServer: (server: ServerCredentialMeta) => Promise<void>;
  /** Drop a session connection from memory. */
  onForgetInstance: (id: string) => void;
  busy: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [locking, setLocking] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [currentPass, setCurrentPass] = useState("");
  const [nextPass, setNextPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [changing, setChanging] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  if (servers.length === 0) return null;

  const locked = !vault.status.unlocked;
  const hasSaved = servers.some((s) => s.savedServer);
  const budgetCount = servers.reduce((n, s) => n + s.budgets.length, 0);

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

  async function handleLock() {
    setLocking(true);
    try {
      await vault.lock();
      toast.success("Vault locked.");
    } catch (err) {
      toast.error(parseApiError(err));
    } finally {
      setLocking(false);
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

  function openChangePassphrase() {
    setCurrentPass("");
    setNextPass("");
    setConfirmPass("");
    setChangeError(null);
    setChangeOpen(true);
  }

  async function handleChangePassphrase() {
    setChangeError(null);
    if (!currentPass) {
      setChangeError("Current passphrase is required.");
      return;
    }
    if (nextPass.length < MIN_PASSPHRASE_LENGTH) {
      setChangeError(`New passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    if (nextPass !== confirmPass) {
      setChangeError("New passphrases do not match.");
      return;
    }
    setChanging(true);
    try {
      await vault.changePassphrase(currentPass, nextPass);
      setChangeOpen(false);
      toast.success("Passphrase changed. Your saved servers were re-encrypted.");
    } catch (err) {
      setChangeError(parseApiError(err));
    } finally {
      setChanging(false);
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

  function openBudget(server: MergedServer, budget: MergedBudget) {
    if (budget.instance) {
      onReconnectInstance(budget.instance);
      return;
    }
    if (server.savedServer && budget.saved) {
      const saved = budget.saved;
      void runBusy(`${server.serverFingerprint}:${budget.budgetSyncId}`, () =>
        onOpenBudget(server.savedServer!, saved)
      );
    }
  }

  async function forgetBudget(server: MergedServer, budget: MergedBudget) {
    if (budget.saved) {
      try {
        await vault.forgetBudget(server.serverFingerprint, budget.budgetSyncId);
      } catch (err) {
        toast.error(parseApiError(err));
      }
      const savedRemaining = server.budgets.filter((b) => b.saved && b.budgetSyncId !== budget.budgetSyncId);
      if (server.savedServer && savedRemaining.length === 0) {
        try {
          await vault.forgetServer(server.serverFingerprint);
        } catch {
          // Non-fatal.
        }
      }
    }
    if (budget.instance) onForgetInstance(budget.instance.id);
  }

  async function forgetServer(server: MergedServer) {
    if (server.savedServer) {
      try {
        await vault.forgetServer(server.serverFingerprint);
        toast.success(`Forgot "${server.label || deriveLabel(server.baseUrl)}".`);
      } catch (err) {
        toast.error(parseApiError(err));
      }
    }
    for (const budget of server.budgets) {
      if (budget.instance) onForgetInstance(budget.instance.id);
    }
  }

  return (
    <section className="flex flex-col gap-4">
      {/* ── Vault security bar ─────────────────────────────────────────────── */}
      {hasSaved && (
        <div
          className={cn(
            "overflow-hidden rounded-xl border bg-card shadow-sm",
            locked ? "border-staged-updated/40" : "border-border"
          )}
        >
          <div className="flex items-center gap-3 p-3">
            <div
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
                locked
                  ? "bg-staged-updated/15 text-staged-updated"
                  : "bg-staged-new/12 text-staged-new"
              )}
            >
              {locked ? <Lock className="size-[18px]" /> : <Unlock className="size-[18px]" />}
            </div>
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                <span
                  className={cn(
                    "size-2 rounded-full",
                    locked
                      ? "bg-staged-updated shadow-[0_0_0_3px] shadow-staged-updated/25"
                      : "animate-pulse bg-staged-new shadow-[0_0_0_3px] shadow-staged-new/25"
                  )}
                />
                {locked ? "Vault locked" : "Vault unlocked"}
              </span>
              {locked && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Unlock once to reopen your saved budgets.
                </p>
              )}
            </div>
            {!locked && (
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={openChangePassphrase}
                  aria-label="Change passphrase"
                >
                  <Settings2 className="size-3.5" />
                  <span className="hidden sm:inline">Change passphrase</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => void handleLock()}
                  disabled={locking}
                >
                  {locking ? <Loader2 className="size-3.5 animate-spin" /> : <Lock className="size-3.5" />}
                  Lock
                </Button>
              </div>
            )}
          </div>

          {locked && (
            <div className="px-3 pb-3">
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleUnlock();
                  }}
                  placeholder="Enter your passphrase"
                  aria-label="Vault passphrase"
                  autoComplete="off"
                  disabled={unlocking}
                  className="h-9"
                />
                <Button className="h-9 shrink-0" onClick={() => void handleUnlock()} disabled={unlocking || !passphrase}>
                  {unlocking ? <Loader2 className="size-4 animate-spin" /> : "Unlock"}
                </Button>
              </div>
              {confirmReset ? (
                <div className="mt-2.5 flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
                  <p className="text-xs text-muted-foreground">
                    Forgot it? Resetting removes all saved servers and clears the passphrase so you can set a new
                    one. Your budgets and their data are untouched.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      className="h-8"
                      onClick={() => void handleReset()}
                      disabled={resetting}
                    >
                      {resetting ? <Loader2 className="size-3.5 animate-spin" /> : "Reset vault"}
                    </Button>
                    <Button variant="outline" size="sm" className="h-8" onClick={() => setConfirmReset(false)} disabled={resetting}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className="mt-2.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Forgot passphrase?
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Section label ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 px-0.5">
        <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Your servers</h2>
        <span className="text-xs tabular-nums text-muted-foreground">
          {servers.length} {servers.length === 1 ? "server" : "servers"} · {budgetCount}{" "}
          {budgetCount === 1 ? "budget" : "budgets"}
        </span>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* ── Servers ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {servers.map((server, i) => {
          const isDirect = server.mode === "browser-api";
          const openAnotherKey = `server:${server.serverFingerprint}`;
          return (
            <div
              key={server.serverFingerprint}
              className={cn("flex flex-col gap-1.5", i > 0 && "border-t pt-4")}
            >
              {/* Server header row */}
              <div className="flex items-center gap-2 px-0.5">
                {isDirect ? (
                  <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Server className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0 truncate font-mono text-xs font-medium">
                  {server.label || deriveLabel(server.baseUrl)}
                </span>
                <span className="shrink-0 rounded-full border bg-muted/60 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                  {isDirect ? "Direct" : "HTTP API"}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => void forgetServer(server)}
                  disabled={busy}
                  title="Forget this server and its saved budgets"
                  aria-label={`Forget ${server.label || deriveLabel(server.baseUrl)}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>

              {/* Budget rows — the whole row connects */}
              {server.budgets.map((budget) => {
                const key = `${server.serverFingerprint}:${budget.budgetSyncId}`;
                const isOpen = !!budget.instance;
                const isSaved = !!budget.saved;
                const needsUnlock = !isOpen && locked;
                const opening =
                  busyKey === key || (budget.instance ? reconnectBusyId === budget.instance.id : false);
                return (
                  <div key={key} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openBudget(server, budget)}
                      disabled={busy || busyKey !== null || needsUnlock}
                      title={needsUnlock ? "Unlock the vault to open this saved budget" : undefined}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border bg-background px-3 py-2.5 text-left transition-colors hover:border-muted-foreground/40 hover:bg-muted/40 disabled:opacity-50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {budget.name || budget.budgetSyncId}
                      </span>
                      {isOpen && (
                        <span className="shrink-0 rounded-full bg-staged-new/12 px-2 py-0.5 text-[10px] font-medium text-staged-new">
                          open
                        </span>
                      )}
                      {isSaved && !isOpen && (
                        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          saved
                        </span>
                      )}
                      {opening ? (
                        <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
                      ) : (
                        <span className="shrink-0 text-xs font-semibold text-action">Connect</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void forgetBudget(server, budget)}
                      disabled={busy || busyKey !== null}
                      title="Forget this budget"
                      aria-label={`Forget ${budget.name || budget.budgetSyncId}`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}

              {server.savedServer && (
                <button
                  type="button"
                  onClick={() => void runBusy(openAnotherKey, () => onOpenServer(server.savedServer!))}
                  disabled={locked || busy || busyKey !== null}
                  className="flex items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {busyKey === openAnotherKey ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Plus className="size-3.5" />
                  )}
                  Open another budget
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Change-passphrase dialog ───────────────────────────────────────── */}
      <Dialog
        open={changeOpen}
        onOpenChange={(open) => {
          if (!open && !changing) setChangeOpen(false);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Change passphrase</DialogTitle>
            <DialogDescription>
              Enter your current passphrase and a new one. Your saved servers are re-encrypted with the new
              passphrase, and other tabs are signed out of the vault.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Input
              type="password"
              value={currentPass}
              onChange={(e) => setCurrentPass(e.target.value)}
              placeholder="Current passphrase"
              aria-label="Current passphrase"
              autoComplete="current-password"
              autoFocus
              disabled={changing}
            />
            <Input
              type="password"
              value={nextPass}
              onChange={(e) => setNextPass(e.target.value)}
              placeholder="New passphrase"
              aria-label="New passphrase"
              autoComplete="new-password"
              disabled={changing}
            />
            <Input
              type="password"
              value={confirmPass}
              onChange={(e) => setConfirmPass(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleChangePassphrase();
              }}
              placeholder="Confirm new passphrase"
              aria-label="Confirm new passphrase"
              autoComplete="new-password"
              disabled={changing}
            />
            {changeError && <p className="text-xs text-destructive">{changeError}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeOpen(false)} disabled={changing}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleChangePassphrase()}
              disabled={changing || !currentPass || !nextPass || !confirmPass}
            >
              {changing ? <Loader2 className="size-4 animate-spin" /> : "Change passphrase"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
