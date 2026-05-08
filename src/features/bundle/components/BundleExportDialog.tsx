"use client";

import { useState } from "react";
import { Download, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useStagedStore } from "@/store/staged";
import { useConnectionStore, selectActiveInstance } from "@/store/connection";
import { useAccounts } from "@/features/accounts/hooks/useAccounts";
import { usePayees } from "@/features/payees/hooks/usePayees";
import { useCategoryGroups } from "@/features/categories/hooks/useCategoryGroups";
import { useTags } from "@/features/tags/hooks/useTags";
import { useSchedules } from "@/features/schedules/hooks/useSchedules";
import { useRules } from "@/features/rules/hooks/useRules";
import {
  exportBundle,
  ALL_BUNDLE_ENTITY_KEYS,
  BUNDLE_ENTITY_LABELS,
} from "../lib/bundleExport";
import type { BundleEntityKey } from "../lib/bundleExport";

// ─── Inner body (only mounted when dialog is open) ────────────────────────────

function ExportDialogBody({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  // Calling these hooks here triggers entity loading if not already cached.
  // Because base-ui's Dialog.Popup is unmounted when closed, these only run
  // when the dialog is actually open.
  const { isLoading: accountsLoading } = useAccounts();
  const { isLoading: payeesLoading } = usePayees();
  const { isLoading: categoriesLoading } = useCategoryGroups();
  const { isLoading: tagsLoading } = useTags();
  const { isLoading: schedulesLoading } = useSchedules();
  const { isLoading: rulesLoading } = useRules();

  const isLoading =
    accountsLoading ||
    payeesLoading ||
    categoriesLoading ||
    tagsLoading ||
    schedulesLoading ||
    rulesLoading;

  const accounts = useStagedStore((s) => s.accounts);
  const payees = useStagedStore((s) => s.payees);
  const categoryGroups = useStagedStore((s) => s.categoryGroups);
  const categories = useStagedStore((s) => s.categories);
  const tags = useStagedStore((s) => s.tags);
  const schedules = useStagedStore((s) => s.schedules);
  const rules = useStagedStore((s) => s.rules);
  const connection = useConnectionStore(selectActiveInstance);

  // State initialises fresh every time the dialog opens (component remounts)
  const [selected, setSelected] = useState<Set<BundleEntityKey>>(
    new Set(ALL_BUNDLE_ENTITY_KEYS)
  );

  const counts: Record<BundleEntityKey, number> = {
    accounts: Object.values(accounts).filter((s) => !s.isDeleted).length,
    payees: Object.values(payees).filter((s) => !s.isDeleted).length,
    categories:
      Object.values(categoryGroups).filter((s) => !s.isDeleted).length +
      Object.values(categories).filter((s) => !s.isDeleted).length,
    tags: Object.values(tags).filter((s) => !s.isDeleted).length,
    schedules: Object.values(schedules).filter((s) => !s.isDeleted).length,
    rules: Object.values(rules).filter((s) => !s.isDeleted).length,
  };

  const rulesMissingDeps =
    selected.has("rules") &&
    (!selected.has("payees") || !selected.has("categories") || !selected.has("accounts"));

  const schedulesMissingDeps =
    selected.has("schedules") &&
    (!selected.has("payees") || !selected.has("accounts"));

  function toggle(key: BundleEntityKey) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleDownload() {
    try {
      const blob = exportBundle(
        { accounts, payees, categoryGroups, categories, tags, schedules, rules },
        selected
      );
      const safeLabel = (connection?.label ?? "bundle").replace(/[^a-z0-9_-]/gi, "-");
      const date = new Date().toISOString().slice(0, 10);
      const filename = `budget-bundle-${safeLabel}-${date}.zip`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      try {
        a.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 100);
      }
      onOpenChange(false);
    } catch {
      toast.error("Export failed. Please try again.");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Export Bundle</DialogTitle>
        <DialogDescription>
          Select the entity types to include in the ZIP archive. Each type is
          exported as a separate CSV using the same format as per-page exports.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 py-1">
        {ALL_BUNDLE_ENTITY_KEYS.map((key) => (
          <div key={key} className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Checkbox
                id={`export-entity-${key}`}
                checked={selected.has(key)}
                onCheckedChange={() => toggle(key)}
              />
              <label
                htmlFor={`export-entity-${key}`}
                className="cursor-pointer text-sm font-medium leading-none select-none"
              >
                {BUNDLE_ENTITY_LABELS[key]}
              </label>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {isLoading ? "…" : counts[key]}
            </span>
          </div>
        ))}
      </div>

      {(rulesMissingDeps || schedulesMissingDeps) && (
        <div className="space-y-1.5">
          {rulesMissingDeps && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              Rules reference Payees, Categories, and Accounts — include them
              for a portable bundle.
            </p>
          )}
          {schedulesMissingDeps && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
              Schedules reference Payees and Accounts — include them for a
              portable bundle.
            </p>
          )}
        </div>
      )}

      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
        <Button
          onClick={handleDownload}
          disabled={selected.size === 0 || isLoading}
        >
          {isLoading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          {isLoading ? "Loading…" : "Download ZIP"}
        </Button>
      </DialogFooter>
    </>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BundleExportDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* ExportDialogBody is only mounted when the dialog is open.
          base-ui's Dialog.Popup unmounts its children when closed,
          so entity hooks inside only fire while the dialog is visible. */}
      <DialogContent>
        <ExportDialogBody onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}
