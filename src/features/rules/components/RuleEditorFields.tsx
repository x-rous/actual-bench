"use client";

import type { ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConditionRow, selectCls } from "./ConditionRow";
import { ActionRow } from "./ActionRow";
import { STAGE_OPTIONS, CONDITIONS_OP_OPTIONS } from "../utils/ruleFields";
import type { EditorPart, RuleDraftValidation, RuleEntityOptionsMap } from "../lib/ruleEditor";
import type { ConditionOrAction, ConditionsOp, RuleStage } from "@/types/entities";

type Props = {
  stage: RuleStage;
  conditionsOp: ConditionsOp;
  conditions: EditorPart[];
  actions: EditorPart[];
  scheduleLinked?: boolean;
  entityOptions: RuleEntityOptionsMap;
  validation: RuleDraftValidation;
  showValidation: boolean;
  touchedConditionIds: Set<string>;
  touchedActionIds: Set<string>;
  onStageChange: (stage: RuleStage) => void;
  onConditionsOpChange: (conditionsOp: ConditionsOp) => void;
  onAddCondition: () => void;
  onAddAction: () => void;
  onConditionChange: (clientId: string, condition: ConditionOrAction) => void;
  onConditionDelete: (clientId: string) => void;
  onConditionTouched: (clientId: string) => void;
  onActionChange: (clientId: string, action: ConditionOrAction) => void;
  onActionDelete: (clientId: string) => void;
  onActionTouched: (clientId: string) => void;
  children?: ReactNode;
};

export function RuleEditorFields({
  stage,
  conditionsOp,
  conditions,
  actions,
  scheduleLinked = false,
  entityOptions,
  validation,
  showValidation,
  touchedConditionIds,
  touchedActionIds,
  onStageChange,
  onConditionsOpChange,
  onAddCondition,
  onAddAction,
  onConditionChange,
  onConditionDelete,
  onConditionTouched,
  onActionChange,
  onActionDelete,
  onActionTouched,
  children,
}: Props) {
  const visibleFormErrors = showValidation ? validation.formErrors : [];

  return (
    <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
      <div className="flex items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="stage-select" className="text-xs font-medium text-muted-foreground">Stage</label>
          <select
            id="stage-select"
            className={selectCls}
            value={stage}
            onChange={(e) => onStageChange(e.target.value as RuleStage)}
          >
            {STAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="conditionsop-select" className="text-xs font-medium text-muted-foreground">Match</label>
          <select
            id="conditionsop-select"
            className={selectCls}
            value={conditionsOp}
            onChange={(e) => onConditionsOpChange(e.target.value as ConditionsOp)}
          >
            {CONDITIONS_OP_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option === "and" ? "ALL conditions (and)" : "ANY condition (or)"}
              </option>
            ))}
          </select>
        </div>
      </div>

      {(visibleFormErrors.length > 0 || validation.warnings.length > 0) && (
        <div className="space-y-2">
          {visibleFormErrors.length > 0 && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <p className="font-medium">Fix these issues before saving:</p>
              <ul className="mt-1 space-y-1">
                {visibleFormErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}
          {validation.warnings.length > 0 && (
            <div className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/20 dark:text-amber-300">
              <p className="font-medium">Review before saving:</p>
              <ul className="mt-1 space-y-1">
                {validation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Conditions
          </p>
          {!scheduleLinked && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddCondition}>
              <Plus className="mr-1 h-3 w-3" />
              Add
            </Button>
          )}
        </div>

        {conditions.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No conditions yet. This rule will match all transactions unless you add one.
          </p>
        ) : (
          <div className="space-y-2">
            {conditions.map((entry, index) => {
              const rowErrors =
                showValidation || touchedConditionIds.has(entry.clientId)
                  ? validation.conditionErrors[index] ?? []
                  : [];
              return (
                <ConditionRow
                  key={entry.clientId}
                  condition={entry.part}
                  scheduleLinked={scheduleLinked}
                  entityOptions={entityOptions}
                  error={rowErrors[0]}
                  onChange={(updated) => {
                    onConditionTouched(entry.clientId);
                    onConditionChange(entry.clientId, updated);
                  }}
                  onDelete={() => onConditionDelete(entry.clientId)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddAction}>
            <Plus className="mr-1 h-3 w-3" />
            Add
          </Button>
        </div>

        {actions.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No actions yet. Add at least one action before saving.
          </p>
        ) : (
          <div className="space-y-2">
            {actions.map((entry, index) => {
              const rowErrors =
                showValidation || touchedActionIds.has(entry.clientId)
                  ? validation.actionErrors[index] ?? []
                  : [];
              return (
                <ActionRow
                  key={entry.clientId}
                  action={entry.part}
                  entityOptions={entityOptions}
                  error={rowErrors[0]}
                  onChange={(updated) => {
                    onActionTouched(entry.clientId);
                    onActionChange(entry.clientId, updated);
                  }}
                  onDelete={() => onActionDelete(entry.clientId)}
                />
              );
            })}
          </div>
        )}
      </div>

      {children}
    </div>
  );
}
