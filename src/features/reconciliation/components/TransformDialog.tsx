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
import { findNoteTags } from "@/lib/reconciliation/noteTags";
import type { Option } from "./StagedFields";
import { Select } from "@/components/ui/select";
import { SearchableCombobox, type ComboboxOption } from "@/components/ui/combobox";
import { buildCategoryOptions, buildPayeeOptions } from "@/components/ui/entity-options";
import { PayeePicker } from "@/components/ui/entity-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { datesSpanYears, formatShortDate } from "../lib/format";

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
  { id: "statementImportedPayee", label: "Statement payee" },
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
  { id: "replaceNoteText", label: "Replace text in notes" },
  { id: "appendNote", label: "Append to notes" },
  { id: "prependNote", label: "Put at the start of notes" },
  { id: "useStatementImportedPayee", label: "Use the statement's full payee" },
  { id: "setPayee", label: "Set payee" },
];

/**
 * The list a condition's value should be chosen from, or null for free text.
 *
 * Two things decide it: whether the value names something that exists, and
 * whether the comparison is exact. `payee equals` has to be a real payee spelled
 * exactly, so it is picked; `payee contains` is a fragment the user invents, so
 * it is typed. Tags are always exact - `hasTag` has no other mode - so they are
 * always picked.
 */
function pickerFor(
  condition: Condition,
  lists: { payees: Option[]; categories: Option[]; tags: Option[] }
): ComboboxOption[] | null {
  const exact = condition.operator === "equals" || condition.operator === "notEquals";
  if (condition.field === "payee" && exact) return byName(buildPayeeOptions(lists.payees));
  if (condition.field === "category" && exact) return byName(buildCategoryOptions(lists.categories));
  if (condition.operator === "hasTag" || condition.operator === "doesNotHaveTag") {
    // Only when the session actually has tags; an empty list would strand the
    // user with a picker that cannot be answered.
    return lists.tags.length > 0 ? byName(lists.tags) : null;
  }
  return null;
}

/** These conditions compare names, so the value a row stands for is its name. */
function byName(options: ComboboxOption[]): ComboboxOption[] {
  return options.map((option) => (option.isGroupHeader ? option : { ...option, id: option.name }));
}

/**
 * A tag that has to be one the rows already carry.
 *
 * Falls back to a plain field when the session has no tags at all, rather than
 * showing a picker with nothing in it — the rule would then be unanswerable and
 * the user would have no way to see why.
 */
function TagField({
  tags,
  value,
  placeholder,
  ariaLabel,
  onChange,
}: {
  tags: Option[];
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {

  if (tags.length === 0) {
    return (
      <Input
        size="sm"
        className="w-32"
        value={value}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className="w-32">
      <SearchableCombobox
        ariaLabel={ariaLabel}
        triggerClassName="h-7"
        placeholder="- choose -"
        value={value}
        onChange={onChange}
        options={tags.map((tag) => ({ id: tag.name, name: tag.name }))}
      />
    </div>
  );
}

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
    case "replaceNoteText":
      return { kind, from: "", to: "" };
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
  /**
   * Read for the category condition only. Reconciliation never writes a
   * category; it may still ask about one.
   */
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
  /**
   * The tags actually present on the rows this rule can reach.
   *
   * Where a value must already exist to be worth choosing, it is chosen: a tag
   * you are asking about, or removing, has to be one that is there, and typing
   * `#API` as `#api` silently matches nothing. Where the value is something new
   * — a tag being added, a replacement, words the bank wrote — it stays free
   * text, because no list holds it yet.
   */

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
  /*
   * Read from the rows the rule will touch, not from the session.
   *
   * Every consumer of this list wants a tag that already exists *there*: a
   * condition matching on one, and the `replaceTag` and `removeTag` fields,
   * which have nothing to act on otherwise. (`addTag` takes free text, since
   * the whole point is a tag the rows do not have yet.) Scoped to "the N
   * selected", listing tags found only on unselected rows offers choices that
   * silently match nothing.
   */
  const tagOptions = useMemo(() => {
    /*
     * Shown as the rows actually spell them - `#API`, not `api`. Comparison
     * normalizes case and the leading hash either way, so the stored value is
     * unaffected; what changes is whether the user recognises their own tag in
     * the list. Deduplicated case-insensitively, first spelling winning, so a
     * note carrying both `#API` and `#api` offers one entry rather than two
     * that mean the same thing.
     */
    const byKey = new Map<string, string>();
    for (const item of scopedItems) {
      for (const tag of findNoteTags(contextFor(item).pending.notes)) {
        const key = tag.name.toLowerCase();
        if (!byKey.has(key)) byKey.set(key, tag.name);
      }
    }
    return [...byKey.values()]
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ id: tag, name: `#${tag}` }));
  }, [scopedItems, contextFor]);

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

  const payeeNames = useMemo(() => new Map(payees.map((payee) => [payee.id, payee.name])), [payees]);
  // Only format rows actually displayed. Payee IDs remain unchanged in the staged patch.
  const rowDetails = useMemo(() => {
    const byId = new Map(scopedItems.map((item) => [item.id, item]));
    const rows = preview.changed.flatMap((row) => {
      const item = byId.get(row.itemId);
      if (!item) return [];
      const context = contextFor(item);
      return [{ id: item.id,
        label: statementText(context.statementRow) || context.transaction?.payeeName || context.transaction?.notes || "-",
        date: context.statementRow?.postedDate ?? context.transaction?.date,
        payeeId: context.transaction?.payeeId, payeeName: context.transaction?.payeeName,
        proposedPayeeName: context.pending.payeeName,
      }];
    });
    const showYear = datesSpanYears(rows.map((row) => row.date));
    const dates = new Map([...new Set(rows.map((row) => row.date).filter((date): date is string => Boolean(date)))]
      .map((date) => [date, formatShortDate(date, showYear)]));
    return new Map(rows.map((row) => [row.id, { ...row, shortDate: dates.get(row.date ?? "") ?? "" }]));
  }, [preview, scopedItems, contextFor]);

  function displayValue(itemId: string, field: string, value: string | null, before = false) {
    if (field !== "payeeId") return value ?? "-";
    const row = rowDetails.get(itemId);
    if (!value) return (before && row?.proposedPayeeName) || "No payee";
    return payeeNames.get(value) || (row?.payeeId === value ? row.payeeName : null) || "Unavailable payee";
  }

  const ready =
    actions.length > 0 &&
    actions.every((action) => {
      if (action.kind === "replaceTag") return action.from.trim() && action.to.trim();
      if (action.kind === "addTag" || action.kind === "removeTag") return action.tag.trim();
      if (action.kind === "appendNote" || action.kind === "prependNote") {
        return action.text.trim();
      }
      /*
       * Not trimmed, unlike the rules above it.
       *
       * `changesFor` treats an empty needle as an incomplete rule and skips it,
       * but whitespace is a legitimate thing to replace - collapsing a double
       * space, or stripping a trailing one - so `"  "` is a complete rule while
       * `""` is not. Trimming here would reject the first along with the second.
       *
       * `to` is deliberately unchecked: replacing text with nothing is how you
       * delete it, and that is the point of the action as often as not.
       */
      if (action.kind === "replaceNoteText") return action.from !== "";
      return true;
    });

  const emptyMessage = !ready
    ? "Fill in the rule above to see what it would change."
    : preview.matched === 0
      ? "Nothing matches this rule yet."
      : preview.skipped.every((row) => row.reason === "no-change")
        ? "Matching rows already have these values."
        : preview.skipped.every((row) => row.reason === "manual-edit")
          ? "Matching rows have manual edits and were left unchanged."
          : preview.skipped.every((row) => row.reason === "guarded")
            ? "Matching rows are protected and cannot take these changes."
            : "Matching rows were left unchanged. See the reasons above.";

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      {/*
        Wide and tall on purpose. The rule is only half of this screen — the
        other half is every row it touches, and a preview capped at five
        examples asks the user to approve two hundred changes on the strength of
        five. The table below is the whole list.
      */}
      <DialogContent className="flex h-[85vh] max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,95vw)]">
        <DialogHeader className="shrink-0 gap-1 border-b border-border/60 px-4 py-3 pr-12">
          <DialogTitle className="flex items-center gap-2 font-sans text-sm font-semibold leading-5">
            <Wand2 className="h-4 w-4" aria-hidden="true" />
            Change many rows at once
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Changes are added to this reconciliation for review. Your Actual budget is updated only when you select Apply.
          </DialogDescription>
        </DialogHeader>

        {/* The rule takes its natural height and the table the rest, down to a
            floor; past that the body scrolls as one. The rule is never its own
            scroll box, or an open picker would scroll inside it instead of
            opening over the table. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <section aria-label="Transformation rule" className="shrink-0 overflow-hidden rounded-md border border-border/60 bg-background">

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border/50 bg-muted/20 px-3 py-2 text-xs">
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

      <section aria-labelledby="transform-if-heading" className="flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="transform-if-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">If</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
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
        </div>
        {conditions.map((condition, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <Select
              size="sm"
              className="w-44 shrink-0 border-indigo-200 bg-indigo-50 font-medium text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-300"
              value={condition.field}
              aria-label="Field"
              options={FIELDS.map((field) => ({ value: field.id, label: field.label }))}
              onValueChange={(value) => {
                const field = value as ConditionField;
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
            />

            <Select
              size="sm"
              className="w-40 shrink-0"
              value={condition.operator}
              aria-label="Comparison"
              onValueChange={(value) =>
                setConditions((previous) =>
                  previous.map((entry, i) =>
                    i === index ? { ...entry, operator: value as ConditionOperator } : entry
                  )
                )
              }
              options={OPERATORS_BY_FIELD[condition.field].map((operator) => ({
                value: operator,
                label: operatorLabel(condition.field, operator),
              }))}
            />

            {/*
              Chosen rather than typed wherever the value has to match something
              that already exists.

              Spelling "correct-amount" by hand is not a thing to ask of anyone,
              and the same is true of a payee, a category or a tag: a condition
              compares them literally, so one wrong character matches nothing and
              says nothing about why. Free text stays where the value is genuinely
              open - a substring of a note, words the bank wrote, a new tag.
            */}
            {condition.field === "matchStatus" ? (
              <Select
                size="sm"
                className="w-56 max-w-full"
                value={condition.value}
                aria-label="Decision"
                onValueChange={(value) =>
                  setConditions((previous) =>
                    previous.map((entry, i) => (i === index ? { ...entry, value } : entry))
                  )
                }
                options={DECISION_VALUES.map((entry) => ({ value: entry.id, label: entry.label }))}
              />
            ) : pickerFor(condition, { payees, categories, tags: tagOptions }) ? (
              <div className="w-56 max-w-full">
                <SearchableCombobox
                  ariaLabel="Value"
                  triggerClassName="h-7"
                  placeholder="- choose -"
                  value={condition.value}
                  onChange={(value) =>
                    setConditions((previous) =>
                      previous.map((entry, i) => (i === index ? { ...entry, value } : entry))
                    )
                  }
                  options={pickerFor(condition, { payees, categories, tags: tagOptions })!}
                />
              </div>
            ) : condition.field === "date" ? (
              <DateInput
                size="sm"
                className="w-56 max-w-full"
                value={condition.value}
                aria-label="Value"
                onValueChange={(value) =>
                  setConditions((previous) =>
                    previous.map((entry, i) => (i === index ? { ...entry, value } : entry))
                  )
                }
              />
            ) : (
              <Input
                size="sm"
                className="w-56 max-w-full"
                value={condition.value}
                type={condition.field === "amount" ? "number" : "text"}
                step={condition.field === "amount" ? "0.01" : undefined}
                aria-label="Value"
                onChange={(event) =>
                  setConditions((previous) =>
                    previous.map((entry, i) =>
                      i === index ? { ...entry, value: event.target.value } : entry
                    )
                  )
                }
              />
            )}

            {condition.operator === "between" &&
              (condition.field === "date" ? (
                // Stored as ISO like the lower bound, so the two compare as dates.
                <DateInput
                  size="sm"
                  className="w-56 max-w-full"
                  value={condition.value2 ?? ""}
                  aria-label="Upper bound"
                  onValueChange={(value2) =>
                    setConditions((previous) =>
                      previous.map((entry, i) => (i === index ? { ...entry, value2 } : entry))
                    )
                  }
                />
              ) : (
                <Input
                  size="sm"
                  className="w-28"
                  value={condition.value2 ?? ""}
                  type={condition.field === "amount" ? "number" : "text"}
                  step={condition.field === "amount" ? "0.01" : undefined}
                  aria-label="Upper bound"
                  onChange={(event) =>
                    setConditions((previous) =>
                      previous.map((entry, i) =>
                        i === index ? { ...entry, value2: event.target.value } : entry
                      )
                    )
                  }
                />
              ))}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove this condition"
              onClick={() => setConditions((previous) => previous.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

      </section>

      <section aria-labelledby="transform-then-heading" className="flex flex-col gap-2 border-t border-border/50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h3 id="transform-then-heading" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Then</h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={() => setActions((previous) => [...previous, emptyAction("addTag")])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add an action
        </Button>
        </div>
        {actions.map((action, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <Select
              size="sm"
              className="w-56 shrink-0 border-violet-200 bg-violet-50 font-medium text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
              value={action.kind}
              aria-label="Action"
              onValueChange={(value) =>
                setActions((previous) =>
                  previous.map((entry, i) => (i === index ? emptyAction(value as ActionKind) : entry))
                )
              }
              options={ACTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
            />

            {action.kind === "replaceTag" && (
              <>
                {/* The tag being replaced has to be one that is there; the tag
                    it becomes is new, so that half stays typed. */}
                <TagField
                  tags={tagOptions}
                  value={action.from}
                  placeholder="#API"
                  ariaLabel="Tag to replace"
                  onChange={(next) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "replaceTag"
                          ? { ...entry, from: next }
                          : entry
                      )
                    )
                  }
                />
                <span className="text-xs text-muted-foreground">with</span>
                <Input
                  size="sm"
                  className="w-32"
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
              <Select
                size="sm"
                className="w-auto"
                aria-label="Where the tag goes"
                value={action.position ?? "end"}
                onValueChange={(value) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && entry.kind === "addTag"
                        ? { ...entry, position: value as "start" | "end" }
                        : entry
                    )
                  )
                }
                options={[
                  { value: "end", label: "at the end" },
                  { value: "start", label: "at the start" },
                ]}
              />
            )}

            {/* Removing names a tag that is there; adding names one that is
                not yet. Same field, opposite requirements. */}
            {action.kind === "removeTag" && (
              <TagField
                tags={tagOptions}
                value={action.tag}
                placeholder="#API"
                ariaLabel="Tag to remove"
                onChange={(next) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && entry.kind === "removeTag" ? { ...entry, tag: next } : entry
                    )
                  )
                }
              />
            )}

            {action.kind === "addTag" && (
              <Input
                size="sm"
                className="w-32"
                value={action.tag}
                placeholder="#2026-07"
                aria-label="Tag"
                onChange={(event) =>
                  setActions((previous) =>
                    previous.map((entry, i) =>
                      i === index && entry.kind === "addTag"
                        ? { ...entry, tag: event.target.value }
                        : entry
                    )
                  )
                }
              />
            )}

            {action.kind === "replaceNoteText" && (
              <>
                <Input
                  size="sm"
                  className="w-56 max-w-full"
                  value={action.from}
                  placeholder="AMZN Mktp"
                  aria-label="Text to replace"
                  onChange={(event) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "replaceNoteText"
                          ? { ...entry, from: event.target.value }
                          : entry
                      )
                    )
                  }
                />
                <span className="text-xs text-muted-foreground">with</span>
                <Input
                  size="sm"
                  className="w-56 max-w-full"
                  value={action.to}
                  placeholder="Amazon"
                  aria-label="Replacement text"
                  onChange={(event) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "replaceNoteText"
                          ? { ...entry, to: event.target.value }
                          : entry
                      )
                    )
                  }
                />
                {/* Both kept free text on purpose: this is the one action about
                    words the bank wrote, which are not a list anyone holds. */}
                <span className="text-[11px] text-muted-foreground">
                  Every occurrence, matched exactly.
                </span>
              </>
            )}

            {(action.kind === "appendNote" || action.kind === "prependNote") && (
              <Input
                size="sm"
                className="w-64"
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
              <div className="w-64 max-w-full">
                <PayeePicker
                  ariaLabel="Payee"
                  size="sm"
                  placeholder="None"
                  allowNone
                  payees={payees}
                  value={action.payeeId ?? ""}
                  onChange={(value) =>
                    setActions((previous) =>
                      previous.map((entry, i) =>
                        i === index && entry.kind === "setPayee" ? { ...entry, payeeId: value || null } : entry
                      )
                    )
                  }
                />
              </div>
            )}

            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
              aria-label="Remove this action"
              onClick={() => setActions((previous) => previous.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}

      </section>

      <label className="flex items-start gap-2 border-t border-border/50 bg-muted/20 px-3 py-2 text-xs">
        <Checkbox className="mt-0.5"
          checked={overrideManual}
          onCheckedChange={(checked) => setOverrideManual(checked)}
        />
        <span>
          Also change rows I edited by hand{" "}
          <span className="ml-2 text-[11px] text-muted-foreground">
            Off by default, so a bulk change cannot quietly undo something you set deliberately.
          </span>
        </span>
      </label>

        </section>

        <section className="flex min-h-64 flex-1 flex-col overflow-hidden rounded-md border border-border/60 bg-background">
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
                {emptyMessage}
              </p>
            ) : (
              <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
                <caption className="sr-only">
                  Every row this rule would change, with its current and resulting value
                </caption>
                <thead className="sticky top-0 z-10 bg-background text-[11px] uppercase tracking-wide text-muted-foreground">
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
                      <tr key={`${row.itemId}-${change.field}`} className="[&>td]:border-b [&>td]:border-border/20">
                        {/* The row is named once, on its first changed field,
                            so a rule touching two fields reads as one row
                            rather than two. */}
                        <td className="px-3 py-1 align-top">
                          {index === 0 && <div className="flex min-w-0 items-baseline gap-2" title={[rowDetails.get(row.itemId)?.date, rowDetails.get(row.itemId)?.label].filter(Boolean).join(" · ")}>
                            {rowDetails.get(row.itemId)?.shortDate && <span className="shrink-0 text-muted-foreground">{rowDetails.get(row.itemId)?.shortDate}</span>}
                            <span className="min-w-0 truncate">{rowDetails.get(row.itemId)?.label ?? "-"}</span>
                          </div>}
                        </td>
                        <td className="px-3 py-1 align-top text-muted-foreground">
                          {FIELD_LABELS[change.field] ?? change.field}
                        </td>
                        <td className="whitespace-pre-wrap px-3 py-1 align-top text-muted-foreground [overflow-wrap:anywhere]">
                          {displayValue(row.itemId, change.field, change.before, true)}
                        </td>
                        <td className="whitespace-pre-wrap px-3 py-1 align-top text-amber-600 [overflow-wrap:anywhere] dark:text-amber-400">
                          {displayValue(row.itemId, change.field, change.after)}
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

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/50 px-4 py-3">
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
