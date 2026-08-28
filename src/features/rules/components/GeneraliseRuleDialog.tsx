"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useStagedStore } from "@/store/staged";
import { measureTokenSpread } from "@/features/payee-cleanup/lib/core";
import { useImportedTextIndex } from "@/features/payee-cleanup/hooks/useImportedTextIndex";
import {
  collectGeneralisations,
  collectLiteralImportConditions,
} from "@/features/rule-diagnostics/lib/overSpecificImportMatch";
import {
  assessGeneralisations,
  type GeneralisationImpact,
} from "@/features/rule-diagnostics/lib/generalisationBacktest";
import type { ConditionOrAction } from "@/types/entities";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruleId: string | null;
  /** Called after the rewrite is staged, for post-confirm navigation. */
  onConfirmed?: (ruleId: string) => void;
};

/** How many of the current strings are listed before the rest are counted. */
const SHOWN_VALUES = 5;

function fieldLabel(field: string): string {
  return field === "imported_payee" ? "imported payee" : field;
}

function conditionText(impact: GeneralisationImpact, field: string): string {
  return `${fieldLabel(field)} ${impact.candidate.description}`;
}

export function GeneraliseRuleDialog({ open, onOpenChange, ruleId, onConfirmed }: Props) {
  const stageUpdate = useStagedStore((s) => s.stageUpdate);
  const pushUndo = useStagedStore((s) => s.pushUndo);
  const rules = useStagedStore((s) => s.rules);
  const payees = useStagedStore((s) => s.payees);

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const rule = ruleId ? rules[ruleId]?.entity : undefined;
  const literal = useMemo(() => (rule ? collectLiteralImportConditions(rule) : null), [rule]);

  // The history is a whole-budget read, so it is fetched only while the dialog
  // is open — and shares Payee Cleanup's cache when both have been used.
  const { rows, truncated, isLoading } = useImportedTextIndex({
    enabled: open && literal !== null,
  });

  const targets = useMemo(() => {
    const ids = new Set<string>();
    const names = new Set<string>();
    for (const action of rule?.actions ?? []) {
      if (action.field !== "payee") continue;
      const values = Array.isArray(action.value) ? action.value : [action.value];
      for (const value of values) {
        if (typeof value !== "string") continue;
        ids.add(value);
        const name = payees[value]?.entity.name;
        if (name) names.add(name.trim().toUpperCase());
      }
    }
    return { ids, names };
  }, [rule, payees]);

  const impacts = useMemo(() => {
    if (!literal) return [];
    // With the history loaded, the budget's own word rarity is available, so the
    // stems are re-derived against it rather than against the rule alone.
    const spread = rows.length > 0 ? measureTokenSpread(rows) : undefined;
    const entries = collectGeneralisations(literal.values, literal.field, spread);
    return assessGeneralisations(entries, {
      field: literal.field,
      currentValues: literal.values,
      targetPayeeIds: targets.ids,
      targetPayeeNames: targets.names,
      rows,
    });
  }, [literal, rows, targets]);

  useEffect(() => {
    // A fresh choice per rule. Selection is otherwise derived rather than
    // stored, so that the arrival of the history — which reorders the options —
    // cannot silently move the choice out from under someone mid-read, and
    // cannot clear an acknowledgement they have already given.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedKey(null);
    setAcknowledged(false);
  }, [open, ruleId]);

  const keyOf = (impact: GeneralisationImpact) =>
    `${impact.candidate.op} ${impact.candidate.value}`;
  const selected =
    impacts.find((impact) => keyOf(impact) === selectedKey) ?? impacts[0];
  const selectedKeyOrBest = selected ? keyOf(selected) : null;

  function handleConfirm() {
    if (!ruleId || !rule || !literal || !selected) return;

    const replaced = new Set(literal.conditions);
    const rewritten: ConditionOrAction = {
      field: literal.field,
      op: selected.candidate.op,
      value: selected.candidate.value,
      type: "string",
    };

    // The new condition takes the place of the first one it replaces, so a rule
    // with other conditions keeps the order its author gave it.
    let inserted = false;
    const conditions: ConditionOrAction[] = [];
    for (const condition of rule.conditions) {
      if (!replaced.has(condition)) {
        conditions.push(condition);
        continue;
      }
      if (inserted) continue;
      conditions.push(rewritten);
      inserted = true;
    }

    pushUndo();
    stageUpdate("rules", ruleId, { conditions });
    onConfirmed?.(ruleId);
    onOpenChange(false);
    toast.success(
      `Rule now matches ${fieldLabel(literal.field)} ${selected.candidate.description}. Save to apply it.`
    );
  }

  const blocked = selected !== undefined && !selected.clean && !acknowledged;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl"
        showCloseButton={false}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-3.5">
          <DialogTitle>Generalise this rule</DialogTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Match the merchant rather than the exact strings it has arrived as, so the next import
            is caught too.
          </p>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {!literal ? (
            <p className="text-sm text-muted-foreground">
              This rule no longer matches on a list of exact strings, so there is nothing to
              generalise.
            </p>
          ) : (
            <>
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Matches now
                </h3>
                <p className="mt-1 text-sm">
                  <span className="font-medium">{fieldLabel(literal.field)}</span> is one of{" "}
                  {literal.values.length} exact strings:
                </p>
                <ul className="mt-1.5 space-y-1">
                  {literal.values.slice(0, SHOWN_VALUES).map((value) => (
                    <li
                      key={value}
                      className="truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px]"
                      title={value}
                    >
                      {value}
                    </li>
                  ))}
                </ul>
                {literal.values.length > SHOWN_VALUES ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    and {literal.values.length - SHOWN_VALUES} more
                  </p>
                ) : null}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Match instead
                </h3>

                {isLoading ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Checking each option against your import history…
                  </p>
                ) : impacts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    These strings share nothing that would still catch all of them, so there is no
                    rewrite to offer.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {impacts.map((impact) => {
                      const key = keyOf(impact);
                      const isSelected = key === selectedKeyOrBest;
                      return (
                        <li key={key}>
                          <label
                            className={`flex cursor-pointer gap-2.5 rounded-md border p-2.5 text-sm ${
                              isSelected ? "border-primary bg-muted/40" : "border-border"
                            }`}
                          >
                            <input
                              type="radio"
                              name="generalise-candidate"
                              className="mt-1"
                              checked={isSelected}
                              onChange={() => {
                                setSelectedKey(key);
                                setAcknowledged(false);
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block break-words font-mono text-[12px]">
                                {conditionText(impact, literal.field)}
                              </span>
                              <span className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                                {impact.clean ? (
                                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                                ) : (
                                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-600" />
                                )}
                                <span>
                                  Catches all {literal.values.length} strings above
                                  {impact.newAgreeing > 0
                                    ? `, plus ${impact.newAgreeing} more already going to this payee`
                                    : ""}
                                  {impact.newUnassigned > 0
                                    ? `, plus ${impact.newUnassigned} with no payee yet`
                                    : ""}
                                  .{" "}
                                  {impact.clean ? (
                                    "Nothing belonging to another payee."
                                  ) : (
                                    <span className="text-amber-700 dark:text-amber-500">
                                      Would also catch {impact.conflictingTransactions}{" "}
                                      transaction
                                      {impact.conflictingTransactions === 1 ? "" : "s"} belonging
                                      to another payee.
                                    </span>
                                  )}
                                </span>
                              </span>
                              {!impact.clean && isSelected ? (
                                <ul className="mt-1.5 space-y-0.5">
                                  {impact.conflictingExamples.map((example) => (
                                    <li
                                      key={example.text}
                                      className="truncate rounded bg-amber-500/10 px-2 py-1 font-mono text-[11px]"
                                      title={example.text}
                                    >
                                      {example.text}
                                      {example.payeeName ? ` → ${example.payeeName}` : ""}
                                    </li>
                                  ))}
                                </ul>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {truncated && !isLoading ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Your import history was read up to its limit, so a rewrite could catch text
                    that was not checked.
                  </p>
                ) : null}
              </section>

              {selected && !selected.clean ? (
                <label className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    aria-label="Accept a rewrite that also matches another payee's transactions"
                  />
                  <span>
                    I understand this condition also matches transactions that currently belong to
                    another payee, and this rule will start applying to them.
                  </span>
                </label>
              ) : null}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!selected || blocked}>
            Stage this change
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
