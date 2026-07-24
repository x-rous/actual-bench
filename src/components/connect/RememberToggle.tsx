"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
import type { useConnectionVault } from "@/features/connect/useConnectionVault";
import { parseApiError } from "./utils";

type Vault = ReturnType<typeof useConnectionVault>;

const MIN_PASSPHRASE_LENGTH = 8;

/**
 * "Remember this connection on the server" (RD-061 / PR-026d). Opt-in, hidden
 * when the vault isn't available (e.g. the non-durable demo). Ticking it when
 * the vault is locked/unset opens a passphrase dialog (so the Connect button is
 * never pushed off-screen); enrollment happens on connect once unlocked.
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!vault.status.supported) return null;

  const setting = !vault.status.passphraseSet;

  function resetDialog() {
    setPassphrase("");
    setConfirm("");
    setError(null);
    setBusy(false);
  }

  function handleToggle(next: boolean) {
    onCheckedChange(next);
    if (next && !vault.status.unlocked) {
      resetDialog();
      setDialogOpen(true);
    }
  }

  function handleCancel() {
    setDialogOpen(false);
    // Can't remember while locked — reflect that by clearing the tick.
    if (!vault.status.unlocked) onCheckedChange(false);
  }

  async function handleConfirm() {
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
      setDialogOpen(false);
      resetDialog();
    } catch (err) {
      setError(parseApiError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/20 p-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => handleToggle(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="flex flex-col">
          <span className="text-sm font-medium">Remember this budget</span>
          <span className="text-xs text-muted-foreground">
            Adds this budget to your saved connections for one-click reopen. Stored encrypted with your passphrase.
            {checked && !vault.status.unlocked && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => { resetDialog(); setDialogOpen(true); }}
                  className="text-primary underline underline-offset-2"
                >
                  Enter passphrase
                </button>{" "}
                to enable.
              </>
            )}
          </span>
        </span>
      </label>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) handleCancel(); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{setting ? "Protect saved credentials" : "Unlock the vault"}</DialogTitle>
            <DialogDescription>
              {setting
                ? "Create a passphrase to encrypt your saved servers. You'll enter it once per session to reconnect. It is not stored; if you forget it, you can reset the vault and start over."
                : "Enter your passphrase to unlock your saved servers for this session."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !setting) void handleConfirm(); }}
              placeholder="Passphrase"
              autoComplete="new-password"
              autoFocus
              disabled={busy}
            />
            {setting && (
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleConfirm(); }}
                placeholder="Confirm passphrase"
                autoComplete="new-password"
                disabled={busy}
              />
            )}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCancel} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void handleConfirm()} disabled={busy || !passphrase}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : setting ? "Set passphrase" : "Unlock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
