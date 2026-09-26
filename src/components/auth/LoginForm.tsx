"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseApiError } from "@/components/connect/utils";
import { getVaultStatus, setVaultPassphrase, unlockVault, type VaultStatus } from "@/features/connect/vaultApi";
import { readVaultUnlockDuration, saveVaultUnlockDuration } from "@/features/connect/vaultUnlockPreference";
import { preloadVault } from "@/features/connect/useConnectionVault";
import {
  VAULT_UNLOCK_DURATION_OPTIONS,
  type VaultUnlockDuration,
} from "@/lib/connectionVault/unlockDuration";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/authMode";

/**
 * Sign in, or on a fresh install set the password (RD-096). One password:
 * it signs in and it encrypts saved connections, so signing in also opens them.
 * The button keeps spinning until the next page's data is loaded, so signing
 * in is one wait, not a spinner followed by another on the connect page.
 */
export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [duration, setDuration] = useState<VaultUnlockDuration>(readVaultUnlockDuration);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getVaultStatus()
      .then((result) => {
        if (result.authMode === "none" || result.unlocked) {
          router.replace(next);
          return;
        }
        setStatus(result);
      })
      .catch((err: unknown) => setLoadError(parseApiError(err)));
  }, [next, router]);

  const settingUp = status !== null && !status.passphraseSet;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (settingUp) {
      if (password.length < MIN_PASSWORD_LENGTH) {
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The passwords do not match.");
        return;
      }
    }
    setBusy(true);
    try {
      if (settingUp) await setVaultPassphrase(password, duration);
      else await unlockVault(password, duration);
      saveVaultUnlockDuration(duration);
      // Load what the next page shows while this button still spins, then
      // move on without a reload: it opens ready, one wait instead of two.
      await preloadVault(queryClient).catch(() => undefined);
      router.replace(next);
    } catch (err) {
      setError(parseApiError(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full max-w-sm flex-col">
      <div className="mb-7 flex justify-center">
        <Image src="/logo.png" alt="Actual Bench" width={160} height={40} priority />
      </div>

      <div className="rounded-xl border bg-card p-5 shadow-sm">
        {status === null ? (
          loadError ? (
            <p className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              {loadError}
            </p>
          ) : (
            <div className="flex justify-center py-6">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading" />
            </div>
          )
        ) : (
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleSubmit(event)}>
            <div className="flex flex-col gap-1">
              <h1 className="text-base font-semibold tracking-tight">
                {settingUp ? "Set a password" : "Sign in"}
              </h1>
              <p className="text-xs text-muted-foreground">
                {settingUp
                  ? "Choose the password for this Actual Bench. It also encrypts the connections you save."
                  : "Enter your Actual Bench password."}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password" className="text-sm text-muted-foreground">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={settingUp ? "new-password" : "current-password"}
                autoFocus
                disabled={busy}
              />
            </div>

            {settingUp && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="confirm" className="text-sm text-muted-foreground">
                  Confirm password
                </Label>
                <Input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  disabled={busy}
                />
              </div>
            )}

            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Keep me signed in for</span>
              <select
                value={duration}
                onChange={(event) => setDuration(event.target.value as VaultUnlockDuration)}
                disabled={busy}
                className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
              >
                {VAULT_UNLOCK_DURATION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            {error && (
              <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" disabled={busy || !password || (settingUp && !confirm)}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : settingUp ? "Set password and continue" : "Sign in"}
            </Button>

            {!settingUp && (
              <p className="text-xs text-muted-foreground">
                Forgot your password? Set a new one with the <code className="font-mono">ACTUAL_BENCH_PASSWORD</code>{" "}
                environment variable and restart Actual Bench.
              </p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
