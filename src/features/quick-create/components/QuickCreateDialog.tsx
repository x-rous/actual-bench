"use client";

import { useState, useMemo } from "react";
import { Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SearchableCombobox } from "@/components/ui/combobox";
import { cn } from "@/lib/utils";
import { generateId } from "@/lib/uuid";
import { useStagedStore } from "@/store/staged";
import { useQuickCreateStore } from "../store/useQuickCreateStore";
import type { QuickCreateEntityType } from "../store/useQuickCreateStore";

const DEFAULT_TAG_COLOR = "#E4D4FF";

const ENTITY_LABELS: Record<QuickCreateEntityType, string> = {
  payee: "Payee",
  category: "Category",
  account: "Account",
  tag: "Tag",
};

const ENTITY_TYPES: QuickCreateEntityType[] = ["payee", "category", "account", "tag"];

// ─── Inner form — keyed so it remounts fresh on each open/preselect change ────

function QuickCreateForm({
  preselectedType,
  prefillName,
  close,
}: {
  preselectedType: QuickCreateEntityType | null;
  prefillName: string;
  close: () => void;
}) {
  const stageNew             = useStagedStore((s) => s.stageNew);
  const pushUndo             = useStagedStore((s) => s.pushUndo);
  const stagedPayees         = useStagedStore((s) => s.payees);
  const stagedCategories     = useStagedStore((s) => s.categories);
  const stagedAccounts       = useStagedStore((s) => s.accounts);
  const stagedTags           = useStagedStore((s) => s.tags);
  const stagedCategoryGroups = useStagedStore((s) => s.categoryGroups);

  // Initial values come from props — no effect needed (component is re-keyed on each open)
  const [selectedType, setSelectedType] = useState<QuickCreateEntityType>(preselectedType ?? "payee");
  const [name, setName]                 = useState(prefillName);
  const [groupId, setGroupId]           = useState("");
  const [offBudget, setOffBudget]       = useState(false);
  const [color, setColor]               = useState<string | undefined>(undefined);

  function handleTypeChange(type: QuickCreateEntityType) {
    setSelectedType(type);
    setGroupId("");
    setOffBudget(false);
    setColor(undefined);
  }

  const groupOptions = useMemo(
    () =>
      Object.values(stagedCategoryGroups)
        .filter((s) => !s.isDeleted)
        .sort((a, b) => a.entity.name.localeCompare(b.entity.name))
        .map((s) => ({ id: s.entity.id, name: s.entity.name })),
    [stagedCategoryGroups]
  );

  const isDuplicate = useMemo(() => {
    const lower = name.trim().toLowerCase();
    if (!lower) return false;
    const map =
      selectedType === "payee"    ? stagedPayees
      : selectedType === "category" ? stagedCategories
      : selectedType === "account"  ? stagedAccounts
      : stagedTags;
    return Object.values(map).some(
      (s) => !s.isDeleted && s.entity.name.trim().toLowerCase() === lower
    );
  }, [name, selectedType, stagedPayees, stagedCategories, stagedAccounts, stagedTags]);

  const trimmedName = name.trim();
  const isValid =
    trimmedName.length > 0 &&
    trimmedName.length <= 100 &&
    !(selectedType === "category" && !groupId);

  function handleCreate() {
    if (!isValid) return;
    pushUndo();
    const id = generateId();
    const label = ENTITY_LABELS[selectedType];

    switch (selectedType) {
      case "payee":
        stageNew("payees", { id, name: trimmedName });
        break;
      case "category":
        stageNew("categories", { id, name: trimmedName, groupId, hidden: false, isIncome: false });
        break;
      case "account":
        stageNew("accounts", { id, name: trimmedName, offBudget, closed: false });
        break;
      case "tag":
        stageNew("tags", { id, name: trimmedName, ...(color ? { color } : {}) });
        break;
    }

    toast.success(`${label} staged — save to persist.`);
    close();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && isValid) {
      e.preventDefault();
      handleCreate();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Quick Create
        </DialogTitle>
      </DialogHeader>

      {/* Type selector */}
      <div className="flex gap-1.5">
        {ENTITY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => handleTypeChange(type)}
            className={cn(
              "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
              selectedType === type
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
            )}
          >
            {ENTITY_LABELS[type]}
          </button>
        ))}
      </div>

      {/* Name field */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-foreground">
          Name <span className="text-destructive">*</span>
        </label>
        <input
          autoFocus
          maxLength={100}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`${ENTITY_LABELS[selectedType]} name…`}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50"
        />
        {isDuplicate && (
          <p className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            A {ENTITY_LABELS[selectedType].toLowerCase()} named &ldquo;{trimmedName}&rdquo; already exists — it will still be staged.
          </p>
        )}
      </div>

      {/* Secondary field — Category group */}
      {selectedType === "category" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">
            Group <span className="text-destructive">*</span>
          </label>
          <SearchableCombobox
            options={groupOptions}
            value={groupId}
            onChange={setGroupId}
            placeholder="Select group…"
          />
          {groupOptions.length === 0 && (
            <p className="text-xs text-muted-foreground italic">
              No category groups exist yet — create one on the Categories page first.
            </p>
          )}
        </div>
      )}

      {/* Secondary field — Account budget type */}
      {selectedType === "account" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Budget type</label>
          <div className="flex gap-1.5">
            {(["on-budget", "off-budget"] as const).map((opt) => {
              const isOffBudget = opt === "off-budget";
              const active = offBudget === isOffBudget;
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setOffBudget(isOffBudget)}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                  )}
                >
                  {opt === "on-budget" ? "On-budget" : "Off-budget"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Secondary field — Tag color */}
      {selectedType === "tag" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Color (optional)</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={color ?? DEFAULT_TAG_COLOR}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Tag color"
              className="h-7 w-10 cursor-pointer rounded border border-border bg-transparent p-0.5"
            />
            {color && (
              <button
                type="button"
                onClick={() => setColor(undefined)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={close}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleCreate} disabled={!isValid}>
          Create {ENTITY_LABELS[selectedType]}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Dialog shell — owns open state; re-keys form on each open ────────────────

export function QuickCreateDialog() {
  const { isOpen, preselectedType, prefillName, close } = useQuickCreateStore();

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-sm" aria-describedby={undefined}>
        <QuickCreateForm
          key={`${String(isOpen)}-${preselectedType ?? "payee"}-${prefillName}`}
          preselectedType={preselectedType}
          prefillName={prefillName}
          close={close}
        />
      </DialogContent>
    </Dialog>
  );
}
