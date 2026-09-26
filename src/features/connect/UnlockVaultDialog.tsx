"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { invalidateVault } from "./vaultQueries";
import { unlockVault } from "./vaultApi";
import { readVaultUnlockDuration } from "./vaultUnlockPreference";

/**
 * Unlock the saved-connections vault in place (PR-071b), so a saved budget can
 * be opened from the toolbar or a picker without going to the Connect page.
 * Uses the unlock duration chosen there.
 */
export function UnlockVaultDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called once unlocked; the caller closes the dialog and carries on. */
  onUnlocked: () => void;
}) {
  const queryClient = useQueryClient();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unlock() {
    if (!passphrase) return;
    setBusy(true);
    setError(null);
    try {
      await unlockVault(passphrase, readVaultUnlockDuration());
      setPassphrase("");
      await invalidateVault(queryClient);
      // The caller closes the dialog: it knows what was waiting on the unlock.
      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The password was not accepted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Unlock saved connections</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">Enter your password to open saved budgets.</p>
          <Input
            type="password"
            autoFocus
            // As on the Connect page's unlock form.
            autoComplete="off"
            aria-label="Vault password"
            value={passphrase}
            disabled={busy}
            onChange={(event) => setPassphrase(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void unlock();
            }}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void unlock()} disabled={busy || !passphrase}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Unlock
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
