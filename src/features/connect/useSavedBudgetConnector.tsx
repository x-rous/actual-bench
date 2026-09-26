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
 * For budget pickers (PR-071b): the saved budgets not connected yet, and a
 * `connect` that adds one to the session in the background - the active
 * budget does not change - asking to unlock the vault first when it is locked.
 * Render `dialog` once in the picker.
 */
export function useSavedBudgetConnector(): {
  saved: SavedBudget[];
  locked: boolean;
  connecting: boolean;
  connect: (saved: SavedBudget) => Promise<ConnectionInstance | null>;
  dialog: ReactNode;
} {
  const queryClient = useQueryClient();
  const { saved, locked } = useSavedBudgets();
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const [waiting, setWaiting] = useState<{ saved: SavedBudget; resolve: (value: ConnectionInstance | null) => void } | null>(
    null
  );

  const askToUnlock = (budget: SavedBudget) =>
    new Promise<ConnectionInstance | null>((resolve) => setWaiting({ saved: budget, resolve }));

  async function run(budget: SavedBudget): Promise<ConnectionInstance | null | "locked"> {
    // One at a time: a second pick while one connects would race it.
    if (connectingRef.current) return null;
    connectingRef.current = true;
    setConnecting(true);
    try {
      return await connectSavedBudget(budget, { activate: false });
    } catch (err) {
      if (isVaultLockedError(err)) {
        // The unlock ran out, or it was locked elsewhere: ask again, then carry on.
        void invalidateVault(queryClient);
        return "locked";
      }
      toast.error(connectFailureMessage(budget.name, err));
      return null;
    } finally {
      connectingRef.current = false;
      setConnecting(false);
    }
  }

  async function connect(budget: SavedBudget): Promise<ConnectionInstance | null> {
    if (locked) return askToUnlock(budget);
    const result = await run(budget);
    return result === "locked" ? askToUnlock(budget) : result;
  }

  const dialog = (
    <UnlockVaultDialog
      open={waiting !== null}
      onOpenChange={(open) => {
        if (open || !waiting) return;
        waiting.resolve(null);
        setWaiting(null);
      }}
      onUnlocked={() => {
        const pending = waiting;
        setWaiting(null);
        if (pending) void run(pending.saved).then((result) => pending.resolve(result === "locked" ? null : result));
      }}
    />
  );

  return { saved, locked, connecting, connect, dialog };
}
