"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { generateId } from "@/lib/uuid";
import { previewTransform } from "@/lib/reconciliation/transform/preview";
import type {
  Condition,
  ConditionField,
  ConditionOperator,
  TransformAction,
  TransformContext,
  TransformRule,
} from "@/lib/reconciliation/transform/rules";
import type { ReconciliationItem } from "@/lib/reconciliation/types";
import { statementText } from "@/lib/reconciliation/statement/text";
import type { Option } from "./StagedFields";

/**
 * Bulk transformation (feature spec §47).
 *
 * IF/THEN, a live count, and the exact before and after — the point being that
 * the user sees precisely what will change to precisely which rows *before*
 * agreeing to it. Applying stages the changes; it does not write to the budget.
 *
 * The rule language is deliberately small (feature spec §29). This is not
 * Actual's rule engine and must not grow into it: it runs once, over this
 * reconciliation, and never again.
 */

const FIELDS: { id: ConditionField; label: string }[] = [
  { id: "notes", label: "Notes" },
  { id: "statementImportedPayee", label: "Statement merchant text" },
  { id: "statementBankNotes", label: "Statement memo" },
  { id: "payee", label: "Payee" },
  { id: "category", label: "Category" },
  { id: "amount", label: "Amount" },
  { id: "date", label: "Date" },
  { id: "matchStatus", label: "Decision" },
];

const OPERATORS: { id: ConditionOperator; label: string }[] = [
  { id: "hasTag", label: "has tag" },
  { id: "doesNotHaveTag", label: "does not have tag" },
  { id: "contains", label: "contains" },
  { id: "notContains", label: "does not contain" },
  { id: "equals", label: "is" },
  { id: "notEquals", label: "is not" },
  { id: "startsWith", label: "starts with" },
  { id: "endsWith", label: "ends with" },
  { id: "greaterThan", label: "is more than" },
  { id: "lessThan", label: "is less than" },
  { id: "between", label: "is between" },
];

/** Column headings for the fields a rule can change. */
const FIELD_LABELS: Record<string, string> = {
  notes: "Notes",
  payeeId: "Payee",
  amount: "Amount",
  date: "Date",
};

/**
 * Which comparisons make sense for which field.
 *
 * The operator list was the same eleven entries whatever the field, so the form
 * happily offered "Amount has tag" and "Notes is more than" - combinations that
 * can only ever match nothing, and which the user has to discover are useless
 * by trying them.
 */
const OPERATORS_BY_FIELD: Record<ConditionField, ConditionOperator[]> = {
  // Tags live in the notes, so only notes can be asked about them.
  notes: ["hasTag", "doesNotHaveTag", "contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
  statementImportedPayee: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
  statementBankNotes: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
  payee: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
  category: ["contains", "notContains", "equals", "notEquals", "startsWith", "endsWith"],
  amount: ["equals", "notEquals", "greaterThan", "lessThan", "between"],
  date: ["equals", "notEquals", "greaterThan", "lessThan", "between"],
  // A decision is one of a fixed set, so it is only ever "is" or "is not".
  matchStatus: ["equals", "notEquals"],
};

/** "Is more than" reads wrong for a date; everything else keeps its wording. */
const DATE_OPERATOR_LABELS: Partial<Record<ConditionOperator, string>> = {
  greaterThan: "is after",
  lessThan: "is before",
};

function operatorLabel(field: ConditionField, operator: ConditionOperator): string {
  if (field === "date" && DATE_OPERATOR_LABELS[operator]) {
    return DATE_OPERATOR_LABELS[operator]!;
  }
  return OPERATORS.find((entry) => entry.id === operator)?.label ?? operator;
}

/** The decisions a row can be in, for the value dropdown when asking about one. */
const DECISION_VALUES: { id: string; label: string }[] = [
  { id: "unresolved", label: "Undecided" },
  { id: "matched", label: "Matched" },
  { id: "create", label: "Create in Actual" },
  { id: "keep", label: "Keep" },
  { id: "delete", label: "Delete from Actual" },
  { id: "correct-amount", label: "Correct the amount" },
  { id: "ignored", label: "Ignored" },
];

type ActionKind = TransformAction["kind"];

const ACTIONS: { id: ActionKind; label: string }[] = [
  { id: "replaceTag", label: "Replace tag" },
  { id: "addTag", label: "Add tag" },
  { id: "removeTag", label: "Remove tag" },
  { id: "appendNote", label: "Append to notes" },
  { id: "prependNote", label: "Put at the start of notes" },
  { id: "useStatementImportedPayee", label: "Use the statement's full merchant text" },
  { id: "setPayee", label: "Set payee" },
];

function emptyAction(kind: ActionKind): TransformAction {
  switch (kind) {
    case "addTag":
      return { kind, tag: "" };
    case "removeTag":
      return { kind, tag: "" };
    case "replaceTag":
      return { kind, from: "", to: "" };
    case "appendNote":
      return { kind, text: "" };
    case "setPayee":
      return { kind, payeeId: null };
    case "prependNote":
      return { kind, text: "" };
    case "useStatementImportedPayee":
      return { kind };
    default:
      return { kind: "addTag", tag: "" };
  }
}

export type TransformDialogProps = {
  items: ReconciliationItem[];
  /** Restricts the rule to a selection, when the user made one. */
  selectedIds: Set<string>;
  contextFor: (item: ReconciliationItem) => TransformContext;
  payees: Option[];
  onClose: () => void;
  onApply: (changes: { itemId: string; patch: ReconciliationItem["stagedChanges"] }[]) => void;
};

export function TransformDialog({
  items,
  selectedIds,
  contextFor,
  payees,
  onClose,
  onApply,
}: TransformDialogProps) {
  const [conditions, setConditions] = useState<Condition[]>([
    { field: "notes", operator: "hasTag", value: "" },
  ]);
  const [actions, setActions] = useState<TransformAction[]>([
    { kind: "replaceTag", from: "", to: "" },
  ]);
  const [overrideManual, setOverrideManual] = useState(false);
  const [scope, setScope] = useState<"selection" | "all">(
    selectedIds.size > 0 ? "selection" : "all"
  );

  const scopedItems = useMemo(
    () => (scope === "selection" ? items.filter((item) => selectedIds.has(item.id)) : items),
    [items, selectedIds, scope]
  );

  const rule: TransformRule = useMemo(
    () => ({ id: "draft", conditions, actions }),
    [conditions, actions]
  );

  /**
   * How a row is named in the impact table.
   *
   * The bank's own description first: it is what the user recognises, and for a
   * row about to be created it is the only name that exists yet.
   */
  const labelFor = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]));
    return (itemId: string): string => {
      const item = byId.get(itemId);
      if (!item) return "-";
      const context = contextFor(item);
      return (
        statementText(context.statementRow) ||
        context.transaction?.payeeName ||
        context.transaction?.notes ||
        "-"
      );
    };
  }, [items, contextFor]);

  // Recomputed as the rule is edited, with the same code that will apply it, so
  // the preview cannot disagree with the outcome.
  const preview = useMemo(
    () => previewTransform({ rule, items: scopedItems, contextFor, overrideManual }),
    [rule, scopedItems, contextFor, overrideManual]
  );

  const ready =
    actions.length > 0 &&
    actions.every((action) => {
      if (action.kind === "replaceTag") return action.from.trim() && action.to.trim();
      if (action.kind === "addTag" || action.kind === "removeTag") return action.tag.trim();
      if (action.kind === "appendNote" || action.kind === "prependNote") {
        return action.text.trim();
      }
      return true;
    });

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      {/*
        Wide and tall on purpose. The rule is only half of this screen — the
        other half is every row it touches, and a preview capped at five
        examples asks the user to approve two hundred changes on the strength of
        five. The table below is the whole list.
      */}
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-3 sm:max-w-[min(1200px,95vw)]">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            Change many rows at once
          </DialogTitle>
          <DialogDescription>
            Nothing is written to your budget - this stages the changes, and you still review them
            before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        {/* Bounded, so a rule with several conditions scrolls rather than
            squeezing the impact table it exists to explain. */}
        <div className="max-h-[45%] shrink-0 space-y-3 overflow-y-auto pr-1">

      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Apply to</span>
          {(
            [
              ["selection", `the ${selectedIds.size} selected`],
              ["all", `all ${items.length} rows`],
            ] as const
          ).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1">
              <input
                type="radio"
                name="transform-scope"
                checked={scope === value}
                onChange={() => setScope(value)}
              />
              {label}
            </label>
          ))}
        </div>
      )}

      <section className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide">If</Label>
        {conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <select
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
              value={condition.field}
              aria-label="Field"
              onChange={(event) => {
                const field = event.target.value as ConditionField;
                setConditions((previous) =>
                  previous.map((entry, i) => {
                    if (i !== index) return entry;
                    const allowed = OPERATORS_BY_FIELD[field];
                    return {
                      ...entry,
                      field,
                      // Carry the operator over only if the new field can use
                      // it; otherwise fall to that field's first sensible one.
                      operator: allowed.includes(entry.operator) ? entry.operator : allowed[0],
                      value: field === "matchStatus" ? DECISION_VALUES[0].id : entry.value,
                    };
                  })
                );
              }}
            >
              {FIELDS.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>

            <select
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
              value={condition.operator}
              aria-label="Comparison"
              onChange={(event) =>
                setConditions((previous) =>
                  previous.map((entry, i) =>
                    i === index
                      ? { ...entry, operator: event.target.value as ConditionOperator }
                      : entry
                  )
                )
              }
            >
              {OPERATORS_BY_FIELD[condition.field].map((operator) => (
                <option key={operator} value={operator}>
                  {operatorLabel(condition.field, operator)}
                </option>
              ))}
            </select>

            {/* A decision is one of a fixed set, so it is chosen rather than
                typed - spelling "correct-amount" by hand is not a thing to ask
                of anyone. */}
            {condition.field === "matchStatus" ? (
              <select
                className="h-7 w-40 rounded-md border border-input bg-background px-2 text-xs"
                value={condition.value}
                aria-label="Decision"
                onChange={(event) =>
                  setConditions((previous) =>
                    previous.map((entry, i) =>
                      i === index ? { ...entry, value: event.target.value } : entry
                    )
                  )
                }
              >
                {DECISION_VALUES.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="h-7 w-40 rounded-md border border-input bg-background px-2 text-xs"
                value={condition.value}
                aria-label="Value"
                placeholder={condition.operator.includes("Tag") ? "#API" : ""}
                onChange={(event) =>
                  setConditions((previous) =>
                    previous.map((entry, i) =>
                      i === index ? { ...entry, value: event.target.value } : entry
                    )
                  )
                }
              />
            )}

            {condition.operator === "between" && (
              <input
                className="h-7 w-28 rounded-md border border-input bg-background px-2 text-xs"
                value={condition.value2 ?? ""}
                aria-label="Upper bound"
                onChange={(event) =>
                  setConditions((previous) =>
                    previous.map((entry, i) =>
                      i === index ? { ...entry, value2: event.target.value } : entry
                    )
                  )
                }
              />
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Remove this condition"
              onClick={() => setConditions((previous) => previous.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-xs"
          onClick={() =>
            setConditions((previous) => [
              ...previous,
              { field: "notes", operator: "hasTag", value: "" },
            ])
          }
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add a condition
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wide">Then</Label>
        {actions.map((action, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <select
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
              value={action.kind}
              aria-label="Action"
              onChange={(event) =>
                setActions((previous) =>
                  previous.map((entry, i) =>
                    i === index ? emptyAction(event.target.value as ActionKind) : entry
                  )
                )
              }
            >
              {ACTIONS.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>

            {action.kind === "replaceTag" && (
              <>
                <input
                  className="h-7 w-32 rounded-md border border-input bg-background px-2 text-xs"
                  value={action.from}
                  placeholder="#API"
                  aria-label="Tag to replace"
                  onChange={(event) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "replaceTag"
                          ? { ...entry, from: event.target.value }
                          : entry
                      )
                    )
                  }
                />
                <span className="text-xs text-muted-foreground">with</span>
                <input
                  className="h-7 w-32 rounded-md border border-input bg-background px-2 text-xs"
                  value={action.to}
                  placeholder="#2026-07"
                  aria-label="Replacement tag"
                  onChange={(event) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "replaceTag"
                          ? { ...entry, to: event.target.value }
                          : entry
                      )
                    )
                  }
                />
              </>
            )}

            {action.kind === "addTag" && (
              <select
                className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Where the tag goes"
                value={action.position ?? "end"}
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && entry.kind === "addTag"
                        ? { ...entry, position: event.target.value as "start" | "end" }
                        : entry
                    )
                  )
                }
              >
                <option value="end">at the end</option>
                <option value="start">at the start</option>
              </select>
            )}

            {(action.kind === "addTag" || action.kind === "removeTag") && (
              <input
                className="h-7 w-32 rounded-md border border-input bg-background px-2 text-xs"
                value={action.tag}
                placeholder="#2026-07"
                aria-label="Tag"
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && (entry.kind === "addTag" || entry.kind === "removeTag")
                        ? { ...entry, tag: event.target.value }
                        : entry
                    )
                  )
                }
              />
            )}

            {(action.kind === "appendNote" || action.kind === "prependNote") && (
              <input
                className="h-7 w-64 rounded-md border border-input bg-background px-2 text-xs"
                value={action.text}
                placeholder="Checked against statement"
                aria-label="Text to append"
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && (entry.kind === "appendNote" || entry.kind === "prependNote")
                        ? { ...entry, text: event.target.value }
                        : entry
                    )
                  )
                }
              />
            )}

            {action.kind === "useStatementImportedPayee" && (
              <span className="text-[11px] text-muted-foreground">
                Extends the merchant text already in the note; tags and your own words stay.
              </span>
            )}

            {action.kind === "setPayee" && (
              <select
                className="h-7 w-52 rounded-md border border-input bg-background px-2 text-xs"
                aria-label="Payee"
                value={action.payeeId ?? ""}
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && entry.kind === "setPayee"
                        ? { ...entry, payeeId: event.target.value || null }
                        : entry
                    )
                  )
                }
              >
                <option value="">None</option>
                {payees.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Remove this action"
              onClick={() => setActions((previous) => previous.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-xs"
          onClick={() => setActions((previous) => [...previous, emptyAction("addTag")])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add an action
        </Button>
      </section>

      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={overrideManual}
          onChange={(event) => setOverrideManual(event.target.checked)}
        />
        <span>
          Also change rows I edited by hand
          <span className="block text-[11px] text-muted-foreground">
            Off by default, so a bulk change cannot quietly undo something you set deliberately.
          </span>
        </span>
      </label>

        </div>

        <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border/60 bg-background">
          <div className="flex shrink-0 flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-border/50 px-3 py-2">
            <p className="text-xs font-medium">
              {preview.changed.length} row{preview.changed.length === 1 ? "" : "s"} will change
              {preview.matched !== preview.changed.length && (
                <span className="font-normal text-muted-foreground">
                  {" "}
                  · {preview.matched} matched the condition
                </span>
              )}
            </p>

            {preview.skipped.length > 0 && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">
                  {preview.skipped.length} left alone
                </summary>
                <ul className="mt-1 space-y-0.5 text-muted-foreground">
                  {[...new Set(preview.skipped.map((entry) => entry.detail))].map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {preview.changed.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                {ready
                  ? "Nothing matches this rule yet."
                  : "Fill in the rule above to see what it would change."}
              </p>
            ) : (
              <table className="w-full border-collapse text-xs">
                <caption className="sr-only">
                  Every row this rule would change, with its current and resulting value
                </caption>
                <thead className="sticky top-0 z-10 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="w-[22%] border-b border-border bg-background px-3 py-1.5 text-left font-medium">
                      Row
                    </th>
                    <th scope="col" className="w-16 border-b border-border bg-background px-3 py-1.5 text-left font-medium">
                      Field
                    </th>
                    <th scope="col" className="border-b border-border bg-background px-3 py-1.5 text-left font-medium">
                      Now
                    </th>
                    <th scope="col" className="border-b border-border bg-background px-3 py-1.5 text-left font-medium">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.changed.map((row) =>
                    row.changes.map((change, index) => (
                      <tr key={`${row.itemId}-${change.field}`} className="border-b border-border/20">
                        {/* The row is named once, on its first changed field,
                            so a rule touching two fields reads as one row
                            rather than two. */}
                        <td className="max-w-0 truncate px-3 py-1 align-top text-muted-foreground">
                          {index === 0 ? labelFor(row.itemId) : ""}
                        </td>
                        <td className="px-3 py-1 align-top text-muted-foreground">
                          {FIELD_LABELS[change.field] ?? change.field}
                        </td>
                        <td className="px-3 py-1 align-top text-muted-foreground">
                          {change.before ?? "-"}
                        </td>
                        <td className="px-3 py-1 align-top text-amber-600 dark:text-amber-400">
                          {change.after ?? "-"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            )}
          </div>
        </section>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 pt-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || preview.changed.length === 0}
            onClick={() => {
              onApply(
                preview.changed.map((row) => ({ itemId: row.itemId, patch: row.patch }))
              );
              onClose();
            }}
          >
            Change {preview.changed.length} row{preview.changed.length === 1 ? "" : "s"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A fresh rule id, for when transformations are saved with the session. */
export function newRuleId(): string {
  return generateId();
}
