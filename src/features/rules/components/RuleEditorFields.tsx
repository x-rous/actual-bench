"use client";

import { Fragment, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConditionRow } from "./ConditionRow";
import { ActionRow } from "./ActionRow";
import { STAGE_OPTIONS } from "../utils/ruleFields";
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
      {/* Stage — inline label + compact segmented toggle */}
      <div className="flex items-center gap-3">
        <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">Stage</span>
        <div className="flex w-fit overflow-hidden rounded-md border border-input">
          {STAGE_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onStageChange(s)}
              className={cn(
                "border-r border-input px-4 py-1.5 text-xs font-medium transition-colors last:border-r-0",
                stage === s
                  ? "bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
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

      {/* Conditions section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Conditions
            </p>
            {!scheduleLinked && (
              <>
                <span className="text-xs text-muted-foreground">· match</span>
                <div className="flex overflow-hidden rounded border border-input text-[11px]">
                  {(["and", "or"] as ConditionsOp[]).map((op, i) => (
                    <button
                      key={op}
                      type="button"
                      onClick={() => onConditionsOpChange(op)}
                      className={cn(
                        "px-2 py-0.5 font-semibold transition-colors",
                        i > 0 && "border-l border-input",
                        conditionsOp === op
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      {op === "and" ? "ALL" : "ANY"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {!scheduleLinked && (
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddCondition}>
              <Plus className="mr-1 h-3 w-3" />
              Add condition
            </Button>
          )}
        </div>

        {conditions.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No conditions yet. This rule will apply to every transaction.
          </p>
        ) : (
          <div>
            {conditions.map((entry, index) => {
              const rowErrors =
                showValidation || touchedConditionIds.has(entry.clientId)
                  ? validation.conditionErrors[index] ?? []
                  : [];
              return (
                <Fragment key={entry.clientId}>
                  {index > 0 && (
                    <div className="flex items-center gap-2 py-1.5">
                      <div className="flex-1 border-t border-dashed border-border" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                        {conditionsOp}
                      </span>
                      <div className="flex-1 border-t border-dashed border-border" />
                    </div>
                  )}
                  <ConditionRow
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
                </Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Actions section */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Actions
          </p>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onAddAction}>
            <Plus className="mr-1 h-3 w-3" />
            Add action
          </Button>
        </div>

        {actions.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No actions yet. Add at least one before saving.
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
