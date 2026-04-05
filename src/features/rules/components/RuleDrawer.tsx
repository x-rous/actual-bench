"use client";

import { useState, useEffect } from "react";
import { Plus, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import { useStagedStore } from "@/store/staged";
import { generateId } from "@/lib/uuid";
import { selectCls, ConditionRow } from "./ConditionRow";
import { ActionRow } from "./ActionRow";
import { STAGE_OPTIONS, CONDITIONS_OP_OPTIONS } from "../utils/ruleFields";
import type { ConditionOrAction, RuleStage, ConditionsOp } from "@/types/entities";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ID of the rule to edit. Null = creating a new rule. */
  ruleId: string | null;
};

export function RuleDrawer({ open, onOpenChange, ruleId }: Props) {
  const stagedRules = useStagedStore((s) => s.rules);
  const stageNew = useStagedStore((s) => s.stageNew);
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const pushUndo = useStagedStore((s) => s.pushUndo);

  const existingRule = ruleId ? stagedRules[ruleId]?.entity : null;

  const [stage, setStage] = useState<RuleStage>("default");
  const [conditionsOp, setConditionsOp] = useState<ConditionsOp>("and");
  const [conditions, setConditions] = useState<ConditionOrAction[]>([]);
  const [actions, setActions] = useState<ConditionOrAction[]>([]);
  const [showJson, setShowJson] = useState(false);

  // Populate local state whenever the drawer opens
  useEffect(() => {
    setShowJson(false);
    if (!open) return;
    if (existingRule) {
      setStage(existingRule.stage);
      setConditionsOp(existingRule.conditionsOp);
      setConditions(structuredClone(existingRule.conditions));
      setActions(structuredClone(existingRule.actions));
    } else {
      setStage("default");
      setConditionsOp("and");
      setConditions([{ field: "payee", op: "is", value: "", type: "id" }]);
      setActions([{ field: "category", op: "set", value: "", type: "id" }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleId]);

  function addCondition() {
    setConditions((prev) => [...prev, { field: "payee", op: "is", value: "", type: "id" }]);
  }

  function addAction() {
    setActions((prev) => [...prev, { field: "category", op: "set", value: "", type: "id" }]);
  }

  function updateCondition(i: number, c: ConditionOrAction) {
    setConditions((prev) => prev.map((x, idx) => (idx === i ? c : x)));
  }

  function updateAction(i: number, a: ConditionOrAction) {
    setActions((prev) => prev.map((x, idx) => (idx === i ? a : x)));
  }

  function handleSave() {
    pushUndo();
    if (ruleId && existingRule) {
      stageUpdate("rules", ruleId, { stage, conditionsOp, conditions, actions });
    } else {
      stageNew("rules", {
        id: generateId(),
        stage,
        conditionsOp,
        conditions,
        actions,
      });
    }
    onOpenChange(false);
  }

  const isNew = !ruleId;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-4xl flex flex-col overflow-hidden p-0 gap-0"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle>{isNew ? "New Rule" : "Edit Rule"}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
          {/* Stage + Conditions Op */}
          <div className="flex items-end gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">Stage</label>
              <select
                className={selectCls}
                value={stage ?? "default"}
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
                value={conditionsOp ?? "and"}
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

          {/* Conditions */}
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
                    onChange={(updated) => updateCondition(i, updated)}
                    onDelete={() => setConditions((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
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
                    onChange={(updated) => updateAction(i, updated)}
                    onDelete={() => setActions((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {showJson && (
          <div className="shrink-0 border-t bg-muted/30 px-4 py-3">
            <pre className="max-h-56 overflow-auto text-xs text-muted-foreground">
              {JSON.stringify({ stage, conditionsOp, conditions, actions }, null, 2)}
            </pre>
          </div>
        )}

        <SheetFooter className="shrink-0 flex-row items-center gap-2 border-t px-4 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-xs text-muted-foreground"
            onClick={() => setShowJson((v) => !v)}
          >
            <Code className="h-3 w-3 mr-1" />
            {showJson ? "Hide JSON" : "JSON"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            {isNew ? "Add Rule" : "Apply Changes"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
