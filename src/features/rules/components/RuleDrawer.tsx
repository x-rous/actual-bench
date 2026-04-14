"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Code, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableDrawer } from "@/components/ui/editable-drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { useDrawerCloseGuard } from "@/hooks/useDrawerCloseGuard";
import { buildRuleDeleteWarning } from "@/lib/usageWarnings";
import { RuleEditorFields } from "./RuleEditorFields";
import { useEntityOptionsMap } from "../hooks/useEntityOptions";
import {
  createEditorPart,
  createEditorParts,
  serializeRule,
  serializeRuleDraft,
  stripEditorParts,
  validateRuleDraft,
  type EditorPart,
} from "../lib/ruleEditor";
import type { ConditionOrAction, RuleStage, ConditionsOp } from "@/types/entities";

export type RuleSeed = {
  conditions: ConditionOrAction[];
  actions: ConditionOrAction[];
};

const DEFAULT_CONDITION: ConditionOrAction = {
  field: "payee",
  op: "is",
  value: "",
  type: "id",
};

const DEFAULT_ACTION: ConditionOrAction = {
  field: "category",
  op: "set",
  value: "",
  type: "id",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID of the rule to edit. Null = creating a new rule. */
  ruleId: string | null;
  /** Pre-populated conditions/actions when creating a new rule from another entity. */
  seed?: RuleSeed;
};

export function RuleDrawer({ open, onOpenChange, ruleId, seed }: Props) {
  const stagedRules = useStagedStore((s) => s.rules);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const stageDelete = useStagedStore((s) => s.stageDelete);
  const pushUndo = useStagedStore((s) => s.pushUndo);
  const entityOptions = useEntityOptionsMap();

  const existingRule = ruleId ? stagedRules[ruleId]?.entity : null;

  const [stage, setStage] = useState<RuleStage>("default");
  const [conditionsOp, setConditionsOp] = useState<ConditionsOp>("and");
  const [conditions, setConditions] = useState<EditorPart[]>([]);
  const [actions, setActions] = useState<EditorPart[]>([]);
  const [showJson, setShowJson] = useState(false);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const [touchedConditionIds, setTouchedConditionIds] = useState<Set<string>>(new Set());
  const [touchedActionIds, setTouchedActionIds] = useState<Set<string>>(new Set());
  const initialSignatureRef = useRef("");

  const currentSignature = useMemo(
    () => serializeRuleDraft({ stage, conditionsOp, conditions, actions }),
    [stage, conditionsOp, conditions, actions]
  );
  const isDirty = open && currentSignature !== initialSignatureRef.current;
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

  const {
    confirmDialog,
    setConfirmDialog,
    closeNow,
    requestClose,
    handleOpenChange,
  } = useDrawerCloseGuard({
    isDirty,
    onClose: () => onOpenChange(false),
    title: "Discard rule changes?",
    message: "Your unsaved edits in this rule drawer will be lost.",
  });

  useEffect(() => {
    setShowJson(false);
    setConfirmDialog(null);
    setSaveAttempted(false);
    setTouchedConditionIds(new Set());
    setTouchedActionIds(new Set());
    if (!open) return;

    if (existingRule) {
      setStage(existingRule.stage);
      setConditionsOp(existingRule.conditionsOp);
      setConditions(createEditorParts(existingRule.conditions));
      setActions(createEditorParts(existingRule.actions));
      initialSignatureRef.current = serializeRule(existingRule);
      return;
    }

    const seededConditions = structuredClone(seed?.conditions ?? [DEFAULT_CONDITION]);
    const seededActions = structuredClone(seed?.actions ?? [DEFAULT_ACTION]);
    setStage("default");
    setConditionsOp("and");
    setConditions(createEditorParts(seededConditions));
    setActions(createEditorParts(seededActions));
    initialSignatureRef.current = serializeRule({
      stage: "default",
      conditionsOp: "and",
      conditions: seededConditions,
      actions: seededActions,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleId]);

  function addCondition() {
    setConditions((prev) => [...prev, createEditorPart(DEFAULT_CONDITION)]);
  }

  function addAction() {
    setActions((prev) => [...prev, createEditorPart(DEFAULT_ACTION)]);
  }

  function updateCondition(clientId: string, condition: ConditionOrAction) {
    setConditions((prev) =>
      prev.map((entry) => (entry.clientId === clientId ? { ...entry, part: condition } : entry))
    );
  }

  function updateAction(clientId: string, action: ConditionOrAction) {
    setActions((prev) =>
      prev.map((entry) => (entry.clientId === clientId ? { ...entry, part: action } : entry))
    );
  }

  function removeCondition(clientId: string) {
    setConditions((prev) => prev.filter((entry) => entry.clientId !== clientId));
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

  function handleDelete() {
    if (!ruleId) return;

    setConfirmDialog({
      title: "Delete rule?",
      message: buildRuleDeleteWarning(),
      onConfirm: () => {
        pushUndo();
        stageDelete("rules", ruleId);
        closeNow();
      },
    });
  }

  function handleSave() {
    setSaveAttempted(true);
    if (hasBlockingErrors) return;

    const nextConditions = stripEditorParts(conditions);
    const nextActions = stripEditorParts(actions);
    const nextRule = {
      stage,
      conditionsOp,
      conditions: nextConditions,
      actions: nextActions,
    };

    if (ruleId && existingRule) {
      if (serializeRule(existingRule) === serializeRule(nextRule)) {
        closeNow();
        return;
      }

      pushUndo();
      stageUpdate("rules", ruleId, nextRule);
    } else {
      pushUndo();
      stageNew("rules", {
        id: generateId(),
        ...nextRule,
      });
    }

    closeNow();
  }

  const isNew = !ruleId;
  const isScheduleLinked = actions.some((entry) => entry.part.op === "link-schedule");

  return (
    <>
      <EditableDrawer
        open={open}
        onOpenChange={(nextOpen) => handleOpenChange(nextOpen, () => onOpenChange(true))}
        title={isNew ? "New Rule" : "Edit Rule"}
        contentClassName="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl"
        footerClassName="shrink-0 flex-row items-center gap-2"
        footer={
          <>
            <div className="mr-auto flex items-center gap-2">
              {!isNew && !isScheduleLinked && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-destructive hover:text-destructive"
                  onClick={handleDelete}
                >
                  <Trash2 className="mr-1 h-3 w-3" />
                  Delete
                </Button>
              )}
              {!isNew && isScheduleLinked && (
                <span className="text-[11px] italic text-muted-foreground">
                  Managed by schedule — delete via Schedules page
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => setShowJson((value) => !value)}
              >
                <Code className="mr-1 h-3 w-3" />
                {showJson ? "Hide JSON" : "JSON"}
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => requestClose()}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave}>
              {isNew ? "Add Rule" : "Apply Changes"}
            </Button>
          </>
        }
      >
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
        />

        {showJson && (
          <div className="shrink-0 border-t bg-muted/30 px-4 py-3">
            <pre className="max-h-56 overflow-auto text-xs text-muted-foreground">
              {JSON.stringify({
                stage,
                conditionsOp,
                conditions: stripEditorParts(conditions),
                actions: stripEditorParts(actions),
              }, null, 2)}
            </pre>
          </div>
        )}
      </EditableDrawer>

      <ConfirmDialog
        open={!!confirmDialog}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setConfirmDialog(null);
        }}
        state={confirmDialog}
      />
    </>
  );
}
