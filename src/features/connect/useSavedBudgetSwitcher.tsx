"use client";

import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ConnectionInstance } from "@/store/connection";
import {
  connectFailureMessage,
  connectSavedBudget,
  useSavedBudgets,
  type SavedBudget,
} from "./savedBudgets";
import { UnlockVaultDialog } from "./UnlockVaultDialog";
import { isVaultLockedError } from "./vaultApi";
import { invalidateVault } from "./vaultQueries";

/**
 * For the toolbar (PR-071b): open a saved budget and switch to it, asking to
 * unlock the vault first when it is locked - or when the unlock ran out since
 * the list was read - and carrying on after the unlock. Render `dialog` once.
 *
 * `prepare` runs once the budget is known to work and before it becomes
 * active: the toolbar drops staged edits and cached data there, so a failure
 * leaves the current budget exactly as it was.
 */
export function useSavedBudgetSwitcher({ prepare }: { prepare: () => void }): {
  saved: SavedBudget[];
  locked: boolean;
  /** The saved budget being connected right now. */
  connectingTo: string | null;
  open: (saved: SavedBudget) => Promise<void>;
  /** Ask for the passphrase with nothing waiting on it. */
  unlock: () => void;
  dialog: ReactNode;
} {
  const queryClient = useQueryClient();
  const { saved, locked } = useSavedBudgets();
  const [connectingTo, setConnectingTo] = useState<string | null>(null);
  const connectingRef = useRef(false);
  // `null`: closed. `{ saved: null }`: an unlock with nothing waiting on it.
  const [unlockFor, setUnlockFor] = useState<{ saved: SavedBudget | null } | null>(null);

  async function connectAndSwitch(budget: SavedBudget) {
    // One at a time: a second pick while one connects would race it.
    if (connectingRef.current) return;
    connectingRef.current = true;
    setConnectingTo(budget.name);
    const pending = toast.loading(`Connecting to ${budget.name}...`);
    try {
      await connectSavedBudget(budget, {
        activate: true,
        prepare: (instance: ConnectionInstance) => {
          prepare();
          return instance;
        },
      });
      toast.success(`Switched to ${budget.name}`, { id: pending });
    } catch (err) {
      if (isVaultLockedError(err)) {
        // The unlock ran out, or it was locked elsewhere: ask again and carry on.
        toast.dismiss(pending);
        void invalidateVault(queryClient);
        setUnlockFor({ saved: budget });
        return;
      }
      toast.error(`${connectFailureMessage(budget.name, err)} Open it from the Connect page to check its details.`, {
        id: pending,
      });
    } finally {
      connectingRef.current = false;
      setConnectingTo(null);
    }
  }

  async function open(budget: SavedBudget) {
    if (locked) {
      setUnlockFor({ saved: budget });
      return;
    }
    await connectAndSwitch(budget);
  }

  const dialog = (
    <UnlockVaultDialog
      open={unlockFor !== null}
      onOpenChange={(next) => {
        if (!next) setUnlockFor(null);
      }}
      onUnlocked={() => {
        const waiting = unlockFor?.saved;
        setUnlockFor(null);
        // Straight to the connect step. This callback was made while the vault
        // still read as locked, so going through `open` would ask again.
        if (waiting) void connectAndSwitch(waiting);
      }}
    />
  );

  return { saved, locked, connectingTo, open, unlock: () => setUnlockFor({ saved: null }), dialog };
}
