"use client";

import { useState, useEffect } from "react";
import { Plus, AlertCircle, Merge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { ConditionRow, selectCls } from "./ConditionRow";
import { ActionRow } from "./ActionRow";
import {
  CONDITION_FIELDS,
  ACTION_FIELDS,
  STAGE_OPTIONS,
  CONDITIONS_OP_OPTIONS,
} from "../utils/ruleFields";
import type { ConditionOrAction, RuleStage, ConditionsOp } from "@/types/entities";

// ─── Deduplication ────────────────────────────────────────────────────────────

function partsKey(p: ConditionOrAction): string {
  return JSON.stringify({ field: p.field, op: p.op, value: p.value });
}

function deduplicateParts(parts: ConditionOrAction[]): ConditionOrAction[] {
  const seen = new Set<string>();
  return parts.filter((p) => {
    const key = partsKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ─── MergeRulesDialog ─────────────────────────────────────────────────────────

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** IDs of the rules to merge. Should contain ≥2 entries. */
  ruleIds: string[];
};

export function MergeRulesDialog({ open, onOpenChange, ruleIds }: Props) {
  const stagedRules        = useStagedStore((s) => s.rules);
  const stageNew           = useStagedStore((s) => s.stageNew);
  const stageDelete        = useStagedStore((s) => s.stageDelete);
  const setMergeDependency = useStagedStore((s) => s.setMergeDependency);
  const pushUndo           = useStagedStore((s) => s.pushUndo);

  const [stage, setStage]               = useState<RuleStage>("default");
  const [conditionsOp, setConditionsOp] = useState<ConditionsOp>("and");
  const [conditions, setConditions]     = useState<ConditionOrAction[]>([]);
  const [actions, setActions]           = useState<ConditionOrAction[]>([]);
  const [deleteOriginals, setDeleteOriginals] = useState(false);

  // Auto-populate when the dialog opens with the selected rules
  useEffect(() => {
    if (!open || ruleIds.length === 0) return;

    const rules = ruleIds
      .map((id) => stagedRules[id]?.entity)
      .filter(Boolean);

    // Stage: unanimous → keep it, otherwise fall back to "default"
    const stages = [...new Set(rules.map((r) => r!.stage || "default"))];
    const mergedStage: RuleStage =
      stages.length === 1 ? (stages[0] as RuleStage) : "default";

    // ConditionsOp: all "or" → "or", otherwise "and"
    const mergedOp: ConditionsOp = rules.every((r) => r!.conditionsOp === "or")
      ? "or"
      : "and";

    const allConditions = rules.flatMap((r) => r!.conditions);
    const allActions    = rules.flatMap((r) => r!.actions);

    setStage(mergedStage);
    setConditionsOp(mergedOp);
    setConditions(deduplicateParts(structuredClone(allConditions)));
    setActions(deduplicateParts(structuredClone(allActions)));
    setDeleteOriginals(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function addCondition() {
    setConditions((prev) => [
      ...prev,
      { field: Object.keys(CONDITION_FIELDS)[0], op: "is", value: "", type: "id" },
    ]);
  }

  function addAction() {
    setActions((prev) => [
      ...prev,
      { field: Object.keys(ACTION_FIELDS)[0], op: "set", value: "", type: "id" },
    ]);
  }

  function handleConfirm() {
    pushUndo();

    const newId = generateId();
    stageNew("rules", { id: newId, stage, conditionsOp, conditions, actions });

    if (deleteOriginals) {
      // Register the dependency: originals are only deleted after the new rule
      // is successfully created on the server (enforced in useRulesSave).
      setMergeDependency(newId, ruleIds);
      for (const id of ruleIds) stageDelete("rules", id);
    }

    onOpenChange(false);
    const suffix = deleteOriginals
      ? ` Original ${ruleIds.length} rules are staged for deletion and will be removed only after the merged rule is saved successfully.`
      : "";
    toast.success(
      `Merged ${ruleIds.length} rules into a new draft rule.${suffix}`
    );
  }

  const ruleCount = ruleIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex flex-col gap-0 p-0 overflow-hidden w-full sm:max-w-3xl max-h-[90vh]"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3.5">
          <DialogTitle>
            Merge {ruleCount} Rule{ruleCount !== 1 ? "s" : ""}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-0.5">
            Review and adjust the merged rule below, then confirm to stage it.
          </p>
        </DialogHeader>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* Stage + ConditionsOp ─────────────────────────────────────────── */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Stage</label>
              <select
                className={selectCls}
                value={stage}
                onChange={(e) => setStage(e.target.value as RuleStage)}
              >
                {STAGE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <label className="text-xs font-medium text-muted-foreground">Match</label>
              <select
                className={selectCls}
                value={conditionsOp}
                onChange={(e) => setConditionsOp(e.target.value as ConditionsOp)}
              >
                {CONDITIONS_OP_OPTIONS.map((op) => (
                  <option key={op} value={op}>
                    {op === "and" ? "ALL conditions (and)" : "ANY condition (or)"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Conditions ───────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Conditions
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addCondition}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {conditions.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No conditions — rule will match all transactions.
              </p>
            ) : (
              <div className="space-y-2">
                {conditions.map((c, i) => (
                  <ConditionRow
                    key={i}
                    condition={c}
                    onChange={(updated) =>
                      setConditions((prev) =>
                        prev.map((x, idx) => (idx === i ? updated : x))
                      )
                    }
                    onDelete={() =>
                      setConditions((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions ──────────────────────────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Actions
              </p>
              <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={addAction}>
                <Plus className="h-3 w-3 mr-1" />
                Add
              </Button>
            </div>
            {actions.length === 0 ? (
              <p className="text-xs italic text-muted-foreground">
                No actions — rule will have no effect.
              </p>
            ) : (
              <div className="space-y-2">
                {actions.map((a, i) => (
                  <ActionRow
                    key={i}
                    action={a}
                    onChange={(updated) =>
                      setActions((prev) =>
                        prev.map((x, idx) => (idx === i ? updated : x))
                      )
                    }
                    onDelete={() =>
                      setActions((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Delete originals ─────────────────────────────────────────────── */}
          <div className="rounded-md border border-border p-4 space-y-3">
            <div className="flex items-center gap-2.5">
              <input
                id="merge-delete-originals"
                type="checkbox"
                checked={deleteOriginals}
                onChange={(e) => setDeleteOriginals(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded accent-primary"
              />
              <label
                htmlFor="merge-delete-originals"
                className="text-sm font-medium cursor-pointer select-none"
              >
                Delete original {ruleCount} rule{ruleCount !== 1 ? "s" : ""} after merging
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Default is to keep the originals. You can delete them manually at any time.
            </p>
            {deleteOriginals && (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <p>
                  When you save, the new merged rule will be created on the server{" "}
                  <strong>first</strong>. The original {ruleCount} rule
                  {ruleCount !== 1 ? "s" : ""} will only be deleted if the new rule is
                  created successfully. If the creation fails, the originals are automatically
                  restored so no data is lost.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <Merge className="h-3.5 w-3.5 mr-1.5" />
            Create Merged Rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
