"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import { parseApiError } from "./utils";

type Vault = ReturnType<typeof useConnectionVault>;

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * "Remember this connection on the server" (RD-061 / PR-026d). Opt-in, hidden
 * when the vault isn't available (e.g. the non-durable demo). When ticked but
 * the vault is locked/unset, an inline control creates or unlocks the passphrase
 * so enrollment on connect succeeds.
 */
export function RememberToggle({
  vault,
  checked,
  onCheckedChange,
  disabled,
}: {
  vault: Vault;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled: boolean;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vault.status.supported) return null;

  const needsPassphrase = checked && !vault.status.unlocked;
  const setting = !vault.status.passphraseSet;

  async function handleReady() {
    setError(null);
    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
      setError(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters.`);
      return;
    }
    if (setting && passphrase !== confirm) {
      setError("Passphrases do not match.");
      return;
    }
    setBusy(true);
    try {
      if (setting) await vault.setPassphrase(passphrase);
      else await vault.unlock(passphrase);
      setPassphrase("");
      setConfirm("");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
      <label className="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Remember this connection on the server</span>
          <span className="text-xs text-muted-foreground">
            Encrypted with your passphrase so you can reconnect next time without re-typing.
          </span>
        </span>
      </label>

      {needsPassphrase && (
        <div className="flex flex-col gap-2 border-t border-border/60 pt-2">
          <p className="text-xs text-muted-foreground">
            {setting
              ? "Create a passphrase to protect saved credentials. You'll enter it once per session to reconnect."
              : "Unlock the vault with your passphrase to remember this connection."}
          </p>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            placeholder="Passphrase"
            autoComplete="new-password"
            disabled={busy}
            className="h-9 rounded-md border border-border bg-background px-3 text-sm"
          />
          {setting && (
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void handleReady(); }}
              placeholder="Confirm passphrase"
              autoComplete="new-password"
              disabled={busy}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm"
            />
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
          <button
            type="button"
            onClick={() => void handleReady()}
            disabled={busy || !passphrase}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : setting ? "Set passphrase" : "Unlock"}
          </button>
        </div>
      )}
    </div>
  );
}
