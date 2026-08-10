"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  { id: "statementDescription", label: "Statement description" },
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

type ActionKind = TransformAction["kind"];

const ACTIONS: { id: ActionKind; label: string }[] = [
  { id: "replaceTag", label: "Replace tag" },
  { id: "addTag", label: "Add tag" },
  { id: "removeTag", label: "Remove tag" },
  { id: "appendNote", label: "Append to notes" },
  { id: "prependNote", label: "Put at the start of notes" },
  { id: "setCategory", label: "Set category" },
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
    case "setCategory":
      return { kind, categoryId: null };
    case "setPayee":
      return { kind, payeeId: null };
    case "prependNote":
      return { kind, text: "" };
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
  categories: Option[];
  onClose: () => void;
  onApply: (changes: { itemId: string; patch: ReconciliationItem["stagedChanges"] }[]) => void;
};

export function TransformDialog({
  items,
  selectedIds,
  contextFor,
  payees,
  categories,
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
    <div className="flex flex-col gap-4 border-b border-border/50 bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4" aria-hidden="true" />
        <h3 className="text-sm font-semibold">Change many rows at once</h3>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>

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
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              value={condition.field}
              aria-label="Field"
              onChange={(event) =>
                setConditions((previous) =>
                  previous.map((entry, i) =>
                    i === index ? { ...entry, field: event.target.value as ConditionField } : entry
                  )
                )
              }
            >
              {FIELDS.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.label}
                </option>
              ))}
            </select>

            <select
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
              {OPERATORS.map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.label}
                </option>
              ))}
            </select>

            <input
              className="h-8 w-40 rounded-md border border-input bg-background px-2 text-xs"
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

            {condition.operator === "between" && (
              <input
                className="h-8 w-28 rounded-md border border-input bg-background px-2 text-xs"
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
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
                  className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
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
                  className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
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
                className="h-8 rounded-md border border-input bg-background px-2 text-xs"
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
                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-xs"
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
                className="h-8 w-64 rounded-md border border-input bg-background px-2 text-xs"
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

            {(action.kind === "setCategory" || action.kind === "setPayee") && (
              <select
                className="h-8 w-52 rounded-md border border-input bg-background px-2 text-xs"
                aria-label={action.kind === "setCategory" ? "Category" : "Payee"}
                value={
                  action.kind === "setCategory"
                    ? action.categoryId ?? ""
                    : action.payeeId ?? ""
                }
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) => {
                      if (i !== index) return entry;
                      const value = event.target.value || null;
                      return entry.kind === "setCategory"
                        ? { ...entry, categoryId: value }
                        : entry.kind === "setPayee"
                          ? { ...entry, payeeId: value }
                          : entry;
                    })
                  )
                }
              >
                <option value="">None</option>
                {(action.kind === "setCategory" ? categories : payees).map((option) => (
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

      <section className="rounded-md border border-border/60 bg-background p-3">
        <p className="text-xs font-medium">
          {preview.changed.length} row{preview.changed.length === 1 ? "" : "s"} will change
          {preview.matched !== preview.changed.length && (
            <span className="font-normal text-muted-foreground">
              {" "}
              · {preview.matched} matched the condition
            </span>
          )}
        </p>

        {preview.changed.length > 0 && (
          <ul className="mt-2 space-y-1.5 text-[11px]">
            {preview.changed.slice(0, 5).map((row) =>
              row.changes.map((change, index) => (
                <li key={`${row.itemId}-${index}`} className="flex flex-col">
                  <span className="text-muted-foreground line-through">{change.before ?? "—"}</span>
                  <span>{change.after ?? "—"}</span>
                </li>
              ))
            )}
            {preview.changed.length > 5 && (
              <li className="text-muted-foreground">
                and {preview.changed.length - 5} more
              </li>
            )}
          </ul>
        )}

        {preview.skipped.length > 0 && (
          <details className="mt-2 text-[11px]">
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
      </section>

      <div className="flex items-center justify-end gap-2">
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
    </div>
  );
}

/** A fresh rule id, for when transformations are saved with the session. */
export function newRuleId(): string {
  return generateId();
}
