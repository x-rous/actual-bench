"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Merge } from "lucide-react";
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
import { RuleEditorFields } from "./RuleEditorFields";
import { CONDITION_FIELDS, ACTION_FIELDS } from "../utils/ruleFields";
import { useEntityOptionsMap } from "../hooks/useEntityOptions";
import {
  createEditorPart,
  createEditorParts,
  stripEditorParts,
  validateRuleDraft,
  type EditorPart,
} from "../lib/ruleEditor";
import type { ConditionOrAction, RuleStage, ConditionsOp } from "@/types/entities";

function partsKey(part: ConditionOrAction): string {
  return JSON.stringify({ field: part.field, op: part.op, value: part.value });
}

function deduplicateParts(parts: ConditionOrAction[]): ConditionOrAction[] {
  const seen = new Set<string>();
  return parts.filter((part) => {
    const key = partsKey(part);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruleIds: string[];
};

const DEFAULT_CONDITION_FIELD = Object.keys(CONDITION_FIELDS)[0] ?? "payee";
const DEFAULT_ACTION_FIELD = Object.keys(ACTION_FIELDS)[0] ?? "category";

export function MergeRulesDialog({ open, onOpenChange, ruleIds }: Props) {
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const setMergeDependency = useStagedStore((s) => s.setMergeDependency);
  const pushUndo = useStagedStore((s) => s.pushUndo);
  const entityOptions = useEntityOptionsMap();

  const [stage, setStage] = useState<RuleStage>("default");
  const [conditionsOp, setConditionsOp] = useState<ConditionsOp>("and");
  const [conditions, setConditions] = useState<EditorPart[]>([]);
  const [actions, setActions] = useState<EditorPart[]>([]);
  const [deleteOriginals, setDeleteOriginals] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [touchedConditionIds, setTouchedConditionIds] = useState<Set<string>>(new Set());
  const [touchedActionIds, setTouchedActionIds] = useState<Set<string>>(new Set());

  const validation = useMemo(
    () => validateRuleDraft({ stage, conditionsOp, conditions, actions }),
    [stage, conditionsOp, conditions, actions]
  );
  const hasBlockingErrors = useMemo(
    () =>
      validation.formErrors.length > 0 ||
      validation.conditionErrors.some((errors) => errors.length > 0) ||
      validation.actionErrors.some((errors) => errors.length > 0),
    [validation]
  );

  useEffect(() => {
    if (!open || ruleIds.length === 0) return;
    const stagedRules = useStagedStore.getState().rules;

    const hasScheduleGeneratedRule = ruleIds.some((id) =>
      stagedRules[id]?.entity.actions.some((action) => action.op === "link-schedule")
    );
    if (hasScheduleGeneratedRule) {
      toast.error("Schedule-generated rules cannot be merged. Manage them from the Schedules page.");
      onOpenChange(false);
      return;
    }

    // Sync local editor state to the newly opened selection.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveAttempted(false);
    setTouchedConditionIds(new Set());
    setTouchedActionIds(new Set());

    const rules = ruleIds
      .map((id) => stagedRules[id]?.entity)
      .filter((rule) => rule !== undefined);

    const stages = [...new Set(rules.map((rule) => rule.stage || "default"))];
    const mergedStage: RuleStage =
      stages.length === 1 ? (stages[0] as RuleStage) : "default";

    const mergedOp: ConditionsOp = rules.every((rule) => rule.conditionsOp === "or")
      ? "or"
      : "and";

    const allConditions = deduplicateParts(
      rules.flatMap((rule) => structuredClone(rule.conditions))
    );
    const allActions = deduplicateParts(
      rules.flatMap((rule) => structuredClone(rule.actions))
    );

    setStage(mergedStage);
    setConditionsOp(mergedOp);
    setConditions(createEditorParts(allConditions));
    setActions(createEditorParts(allActions));
    setDeleteOriginals(false);
  }, [open, onOpenChange, ruleIds]);

  function addCondition() {
    setConditions((prev) => [
      ...prev,
      createEditorPart({
        field: DEFAULT_CONDITION_FIELD,
        op: "is",
        value: "",
        type: "id",
      }),
    ]);
  }

  function addAction() {
    setActions((prev) => [
      ...prev,
      createEditorPart({
        field: DEFAULT_ACTION_FIELD,
        op: "set",
        value: "",
        type: "id",
      }),
    ]);
  }

  function updateCondition(clientId: string, condition: ConditionOrAction) {
    setConditions((prev) =>
      prev.map((entry) => (entry.clientId === clientId ? { ...entry, part: condition } : entry))
    );
  }

  function removeCondition(clientId: string) {
    setConditions((prev) => prev.filter((entry) => entry.clientId !== clientId));
  }

  function updateAction(clientId: string, action: ConditionOrAction) {
    setActions((prev) =>
      prev.map((entry) => (entry.clientId === clientId ? { ...entry, part: action } : entry))
    );
  }

  function removeAction(clientId: string) {
    setActions((prev) => prev.filter((entry) => entry.clientId !== clientId));
  }

  function markConditionTouched(clientId: string) {
    setTouchedConditionIds((prev) => {
      if (prev.has(clientId)) return prev;
      const next = new Set(prev);
      next.add(clientId);
      return next;
    });
  }

  function markActionTouched(clientId: string) {
    setTouchedActionIds((prev) => {
      if (prev.has(clientId)) return prev;
      const next = new Set(prev);
      next.add(clientId);
      return next;
    });
  }

  function handleConfirm() {
    setSaveAttempted(true);
    if (hasBlockingErrors) return;

    pushUndo();

    const newId = generateId();
    stageNew("rules", {
      id: newId,
      stage,
      conditionsOp,
      conditions: stripEditorParts(conditions),
      actions: stripEditorParts(actions),
    });

    if (deleteOriginals) {
      setMergeDependency(newId, ruleIds);
      for (const id of ruleIds) {
        stageDelete("rules", id);
      }
    }

    onOpenChange(false);
    const suffix = deleteOriginals
      ? ` Original ${ruleIds.length} rules are staged for deletion and will be removed only after the merged rule is saved successfully.`
      : "";
    toast.success(`Merged ${ruleIds.length} rules into a new draft rule.${suffix}`);
  }

  const ruleCount = ruleIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3.5">
          <DialogTitle>
            Merge {ruleCount} Rule{ruleCount !== 1 ? "s" : ""}
          </DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Review and adjust the merged rule below, then confirm to stage it.
          </p>
        </DialogHeader>

        <RuleEditorFields
          stage={stage}
          conditionsOp={conditionsOp}
          conditions={conditions}
          actions={actions}
          entityOptions={entityOptions}
          validation={validation}
          showValidation={saveAttempted}
          touchedConditionIds={touchedConditionIds}
          touchedActionIds={touchedActionIds}
          onStageChange={setStage}
          onConditionsOpChange={setConditionsOp}
          onAddCondition={addCondition}
          onAddAction={addAction}
          onConditionChange={updateCondition}
          onConditionDelete={removeCondition}
          onConditionTouched={markConditionTouched}
          onActionChange={updateAction}
          onActionDelete={removeAction}
          onActionTouched={markActionTouched}
        >
          <div className="space-y-3 rounded-md border border-border p-4">
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
                className="cursor-pointer select-none text-sm font-medium"
              >
                Delete original {ruleCount} rule{ruleCount !== 1 ? "s" : ""} after merging
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              Default is to keep the originals. You can delete them manually at any time.
            </p>
            {deleteOriginals && (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
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
        </RuleEditorFields>

        <div className="shrink-0 flex items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleConfirm}>
            <Merge className="mr-1.5 h-3.5 w-3.5" />
            Create Merged Rule
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
