"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ConnectionInstance } from "@/store/connection";
import { connectSavedBudget, useSavedBudgets, type SavedBudget } from "./savedBudgets";
import { UnlockVaultDialog } from "./UnlockVaultDialog";

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
  const { saved, locked } = useSavedBudgets();
  const [connecting, setConnecting] = useState(false);
  const [waiting, setWaiting] = useState<{ saved: SavedBudget; resolve: (value: ConnectionInstance | null) => void } | null>(
    null
  );

  async function run(budget: SavedBudget): Promise<ConnectionInstance | null> {
    setConnecting(true);
    try {
      return await connectSavedBudget(budget, { activate: false });
    } catch (err) {
      toast.error(`Could not connect to ${budget.name}: ${err instanceof Error ? err.message : "the server did not answer"}`);
      return null;
    } finally {
      setConnecting(false);
    }
  }

  function connect(budget: SavedBudget): Promise<ConnectionInstance | null> {
    if (!locked) return run(budget);
    return new Promise((resolve) => setWaiting({ saved: budget, resolve }));
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
        if (pending) void run(pending.saved).then(pending.resolve);
      }}
    />
  );

  return { saved, locked, connecting, connect, dialog };
}
