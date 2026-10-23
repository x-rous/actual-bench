"use client";

import { useState, type ReactNode } from "react";
import { useStagedStore, selectHasChanges } from "@/store/staged";
import { useBudgetEditsStore } from "@/store/budgetEdits";
import type { FeatureDefinition } from "@/lib/features/catalogue";
import { getFeatureEntryState } from "@/lib/features/pendingChanges";

/** Check drafts on entry; later global edits must never unmount an admitted editor. */
export function FeatureEntryGuard({ feature, children }: { feature?: FeatureDefinition; children: ReactNode }) {
  const hasEntities = useStagedStore(selectHasChanges);
  const hasBudget = useBudgetEditsStore(s => Object.keys(s.edits).length > 0 || Object.keys(s.holds).length > 0);
  const { blocked } = getFeatureEntryState(feature, hasEntities, hasBudget);
  const [entered, setEntered] = useState(!blocked);
  // The shell keys this guard by route and connection. Remember admission for
  // this entry so Quick Create or global Redo cannot discard local editor state.
  if (!blocked && !entered) setEntered(true);
  if (entered || !blocked) return children;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-sm font-semibold">Resolve your pending changes</h1>
        <p className="text-sm text-muted-foreground">
          Review and save or discard your changes in the panel to open {feature?.label}.
        </p>
      </div>
    </div>
  );
}
