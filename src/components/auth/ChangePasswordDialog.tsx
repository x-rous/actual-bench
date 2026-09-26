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
import { parseApiError } from "@/components/connect/utils";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/authMode";

/**
 * Change the Actual Bench password. It is also what encrypts saved connections,
 * so they are re-encrypted with the new one, and every other browser is signed
 * out (their sessions hold the old key).
 */
export function ChangePasswordDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (currentPassword: string, newPassword: string) => Promise<void>;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    onOpenChange(false);
  }

  async function handleSubmit() {
    setError(null);
    if (next.length < MIN_PASSWORD_LENGTH) {
      setError(`The new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(current, next);
      setBusy(false);
      setCurrent("");
      setNext("");
      setConfirm("");
      onOpenChange(false);
    } catch (err) {
      setError(parseApiError(err));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            Your saved connections are re-encrypted with the new password, and other browsers are signed out.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder="Current password"
            aria-label="Current password"
            autoComplete="current-password"
            autoFocus
            disabled={busy}
          />
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder="New password"
            aria-label="New password"
            autoComplete="new-password"
            disabled={busy}
          />
          <Input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void handleSubmit(); }}
            placeholder="Confirm new password"
            aria-label="Confirm new password"
            autoComplete="new-password"
            disabled={busy}
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={busy || !current || !next || !confirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : "Change password"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
