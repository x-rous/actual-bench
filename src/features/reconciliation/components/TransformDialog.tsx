"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { generateId } from "@/lib/uuid";
import { previewTransform, previewTransformSequence } from "@/lib/reconciliation/transform/preview";
import { useSavedTransformMutations, useSavedTransforms } from "../hooks/useReconciliation";
import {
  defaultMonth,
  hasFixedDate,
  isMonthValue,
  missingPayees,
  resolvePlaceholders,
  usesMonth,
  withoutMissingPayees,
  type SavedRule,
  type SavedTransform,
} from "@/lib/reconciliation/transform/saved";
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
        options={withValue(tags.map((tag) => ({ id: tag.name, name: tag.name })), value)}
      />
    </div>
  );
}

/**
 * The options, plus the current value when it is not among them.
 *
 * A saved transform can name a tag these rows do not carry yet, or `#{month}`;
 * without this the picker would show it as unanswered.
 */
function withValue(options: ComboboxOption[], value: string): ComboboxOption[] {
  if (!value || options.some((option) => option.id === value)) return options;
  return [...options, { id: value, name: value }];
}

const DECISION_LABELS = new Map(DECISION_VALUES.map((entry) => [entry.id, entry.label]));

/** One line saying what a saved rule does, for the saved list. */
function describeRule(rule: SavedRule, payeeName: (id: string) => string | undefined): string {
  const field = (id: ConditionField) => FIELDS.find((entry) => entry.id === id)?.label ?? id;
  const conditions = rule.conditions.map((entry) => {
    const value = entry.field === "matchStatus" ? DECISION_LABELS.get(entry.value) ?? entry.value : entry.value;
    const upper = entry.operator === "between" ? ` and ${entry.value2 ?? ""}` : "";
    return `${field(entry.field)} ${operatorLabel(entry.field, entry.operator)} ${value}${upper}`;
  });
  const actions = rule.actions.map((entry) => {
    switch (entry.kind) {
      case "replaceTag":
        return `replace ${entry.from} with ${entry.to}`;
      case "addTag":
        return `add ${entry.tag} at the ${entry.position ?? "end"}`;
      case "removeTag":
        return `remove ${entry.tag}`;
      case "replaceNoteText":
        return `replace "${entry.from}" with "${entry.to}"`;
      case "appendNote":
        return `append "${entry.text}"`;
      case "prependNote":
        return `put "${entry.text}" first`;
      case "setPayee":
        return `set payee ${entry.payeeId ? payeeName(entry.payeeId) ?? "(deleted payee)" : "none"}`;
      case "useStatementImportedPayee":
        return "use the statement's full payee";
    }
  });
  const when = conditions.length > 0 ? `If ${conditions.join(" and ")}` : "All rows";
  return `${when}: ${actions.join(", ")}`;
}

const CHECKED_KEY = "actual-bench.reconciliation.saved-transforms.checked";

/** The saved transforms ticked last time. Browser storage only; losing it just unticks them. */
function readChecked(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(CHECKED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeChecked(ids: string[]) {
  try {
    window.localStorage.setItem(CHECKED_KEY, JSON.stringify(ids));
  } catch {
    // Remembering the selection is a convenience; nothing depends on it.
  }
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
  /** Saved transforms for this budget. Absent, the dialog offers only a one-off rule. */
  saved?: SavedTransformsSupport;
};

export type SavedTransformsSupport = {
  transforms: SavedTransform[];
  /** What `{month}` becomes unless the user changes it: the statement's closing month. */
  defaultMonth: string;
  onCreate: (name: string, rule: SavedRule) => Promise<unknown>;
  onUpdate: (id: string, changes: { name?: string; rule?: SavedRule }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
  onReorder: (ids: string[]) => Promise<unknown>;
};

export function TransformDialog({
  items,
  selectedIds,
  contextFor,
  payees,
  categories,
  onClose,
  onApply,
  saved,
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

  const savedList = useMemo(() => saved?.transforms ?? [], [saved?.transforms]);
  const [mode, setMode] = useState<"saved" | "new">(savedList.length > 0 ? "saved" : "new");
  const [checked, setChecked] = useState<Set<string>>(() => {
    const known = new Set(savedList.map((entry) => entry.id));
    return new Set(readChecked().filter((id) => known.has(id)));
  });
  const [month, setMonth] = useState(saved?.defaultMonth ?? "");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [saveState, setSaveState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const knownPayeeIds = useMemo(() => new Set(payees.map((payee) => payee.id)), [payees]);
  const checkedTransforms = useMemo(
    () => savedList.filter((entry) => checked.has(entry.id)),
    [savedList, checked]
  );
  const needsMonth =
    mode === "saved" ? checkedTransforms.some((entry) => usesMonth(entry.rule)) : usesMonth(rule);
  const monthReady = !needsMonth || isMonthValue(month);

  // Recomputed as the rule is edited, with the same code that will apply it, so
  // the preview cannot disagree with the outcome. `{month}` is filled in on a
  // copy here; what is saved keeps the placeholder.
  const sequence = useMemo(() => {
    if (mode !== "saved") return null;
    return previewTransformSequence({
      rules: checkedTransforms.map((entry) => ({
        id: entry.id,
        ...resolvePlaceholders(withoutMissingPayees(entry.rule, knownPayeeIds), month.trim()),
      })),
      items: scopedItems,
      contextFor,
      overrideManual,
    });
  }, [mode, checkedTransforms, knownPayeeIds, month, scopedItems, contextFor, overrideManual]);
  const single = useMemo(
    () =>
      mode === "saved"
        ? null
        : previewTransform({ rule: resolvePlaceholders(rule, month.trim()), items: scopedItems, contextFor, overrideManual }),
    [mode, rule, month, scopedItems, contextFor, overrideManual]
  );
  const preview = sequence ?? single!;

  function toggleChecked(id: string, on: boolean) {
    setChecked((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      writeChecked([...next]);
      return next;
    });
  }

  function editSaved(entry: SavedTransform) {
    setConditions(entry.rule.conditions);
    setActions(entry.rule.actions);
    setEditingId(entry.id);
    setSaveName(entry.name);
    setSaveState({ busy: false, message: null, error: false });
    setMode("new");
  }

  function stopEditing() {
    setEditingId(null);
    setSaveName("");
    setSaveState({ busy: false, message: null, error: false });
  }

  async function runSave(asNew: boolean) {
    if (!saved) return;
    const name = saveName.trim();
    const stored: SavedRule = { conditions, actions };
    setSaveState({ busy: true, message: null, error: false });
    try {
      if (editingId && !asNew) {
        await saved.onUpdate(editingId, { name, rule: stored });
        setSaveState({ busy: false, message: `Saved changes to "${name}".`, error: false });
      } else {
        await saved.onCreate(name, stored);
        setEditingId(null);
        setSaveState({ busy: false, message: `Saved as "${name}".`, error: false });
      }
    } catch (error) {
      setSaveState({
        busy: false,
        message: error instanceof Error ? error.message : "Could not save this transform.",
        error: true,
      });
    }
  }

  function move(id: string, by: -1 | 1) {
    if (!saved) return;
    const ids = savedList.map((entry) => entry.id);
    const from = ids.indexOf(id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    void saved.onReorder(ids);
  }

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
    if (before && row?.payeeId === value && row.payeeName) return row.payeeName;
    return payeeNames.get(value) || (row?.payeeId === value ? row.payeeName : null) || "Unavailable payee";
  }

  const ruleComplete =
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

  // A saved rule runs unseen next month, so an unanswered condition is refused
  // there rather than saved to match nothing (or everything).
  const conditionsComplete = conditions.every(
    (entry) => entry.value.trim() !== "" && (entry.operator !== "between" || (entry.value2 ?? "").trim() !== "")
  );
  const canSave = Boolean(ruleComplete) && conditionsComplete && saveName.trim() !== "" && !saveState.busy;

  const ready =
    monthReady && (mode === "saved" ? checkedTransforms.length > 0 : Boolean(ruleComplete));

  const emptyMessage = mode === "saved" && checkedTransforms.length === 0
    ? "Tick the saved transforms to run."
    : !monthReady
    ? "Enter the month as YYYY-MM to see what it would change."
    : !ready
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

      {saved && (
        <div role="tablist" aria-label="Rule source" className="flex items-center gap-1 border-b border-border/50 px-3 pt-2">
          {(
            [
              ["saved", `Saved (${savedList.length})`],
              ["new", editingId ? "Edit saved rule" : "New rule"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={mode === value}
              className={`-mb-px border-b-2 px-2 pb-1.5 text-xs font-medium ${
                mode === value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {saved && mode === "saved" && (
        <section aria-label="Saved transforms" className="flex flex-col px-3 py-2">
          {savedList.length === 0 ? (
            <p className="py-3 text-xs text-muted-foreground">
              No saved transforms yet. Build one under New rule and save it to run it again on later imports.
            </p>
          ) : (
            <ul className="flex flex-col">
              {savedList.map((entry, index) => {
                const checkedIndex = checkedTransforms.findIndex((candidate) => candidate.id === entry.id);
                const changedCount = checkedIndex >= 0 ? sequence?.changedByRule[checkedIndex] : undefined;
                const missing = missingPayees(entry.rule, knownPayeeIds);
                return (
                  <li key={entry.id} className="flex items-center gap-2 border-b border-border/30 py-1 text-xs last:border-b-0">
                    <Checkbox
                      aria-label={`Run ${entry.name}`}
                      checked={checked.has(entry.id)}
                      onCheckedChange={(on) => toggleChecked(entry.id, on)}
                    />
                    <span className="shrink-0 font-medium">{entry.name}</span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground" title={describeRule(entry.rule, (id) => payeeNames.get(id))}>
                      {describeRule(entry.rule, (id) => payeeNames.get(id))}
                    </span>
                    {missing.length > 0 && (
                      <span className="shrink-0 text-amber-600 dark:text-amber-400">
                        Payee deleted; that action is skipped
                      </span>
                    )}
                    {changedCount !== undefined && (
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {changedCount} row{changedCount === 1 ? "" : "s"}
                      </span>
                    )}
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Move ${entry.name} up`}
                      disabled={index === 0} onClick={() => move(entry.id, -1)}>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Move ${entry.name} down`}
                      disabled={index === savedList.length - 1} onClick={() => move(entry.id, 1)}>
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" aria-label={`Edit ${entry.name}`}
                      onClick={() => editSaved(entry)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {confirmDeleteId === entry.id ? (
                      <Button variant="destructive" size="sm" className="h-6 shrink-0 text-xs"
                        onClick={() => {
                          setConfirmDeleteId(null);
                          toggleChecked(entry.id, false);
                          void saved.onDelete(entry.id);
                        }}>
                        Delete
                      </Button>
                    ) : (
                      <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label={`Delete ${entry.name}`} onClick={() => setConfirmDeleteId(entry.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {savedList.length > 1 && (
            <p className="pt-1 text-[11px] text-muted-foreground">
              Ticked transforms run top to bottom, each on what the one before it left.
            </p>
          )}
        </section>
      )}

      {(!saved || mode === "new") && (<>
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
                  options={withValue(pickerFor(condition, { payees, categories, tags: tagOptions })!, condition.value)}
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

        {saved && (
          <p className="text-[11px] text-muted-foreground">
            Type <code className="rounded bg-muted px-1">{"{month}"}</code> in a tag or text, for example{" "}
            <code className="rounded bg-muted px-1">{"#{month}"}</code>, and it becomes the month you choose each time the rule runs.
          </p>
        )}
      </section>

      {saved && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2 text-xs">
          <Input
            size="sm"
            className="w-56"
            value={saveName}
            placeholder="Name, e.g. API to month"
            aria-label="Saved transform name"
            onChange={(event) => setSaveName(event.target.value)}
          />
          {editingId ? (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={!canSave} onClick={() => void runSave(false)}>
                Save changes
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs"
                disabled={!canSave} onClick={() => void runSave(true)}>
                Save as new
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={stopEditing}>
                Stop editing
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              disabled={!canSave} onClick={() => void runSave(true)}>
              Save for later imports
            </Button>
          )}
          {saveState.message && (
            <span role="status" className={saveState.error ? "text-destructive" : "text-muted-foreground"}>
              {saveState.message}
            </span>
          )}
          {hasFixedDate({ conditions, actions }) && (
            <span className="text-amber-600 dark:text-amber-400">
              This rule checks a fixed date, so on a later statement it may match nothing.
            </span>
          )}
        </div>
      )}
      </>)}

      {needsMonth && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/50 px-3 py-2 text-xs">
          <label htmlFor="transform-month" className="font-medium">Month</label>
          <Input
            id="transform-month"
            size="sm"
            className="w-28 tabular-nums"
            value={month}
            placeholder="YYYY-MM"
            aria-invalid={!monthReady}
            onChange={(event) => setMonth(event.target.value)}
          />
          <span className="text-muted-foreground">
            {monthReady
              ? <>Replaces <code className="rounded bg-muted px-1">{"{month}"}</code>, so <code className="rounded bg-muted px-1">{"#{month}"}</code> becomes <code className="rounded bg-muted px-1">#{month.trim()}</code>. Defaults to the statement&apos;s closing month.</>
              : "Enter the month as YYYY-MM."}
          </span>
        </div>
      )}

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

/**
 * The dialog with this budget's saved transforms.
 *
 * Waits for the list on first open, so the dialog starts on the Saved tab when
 * there is something saved; after that the list is cached.
 */
export function ConnectedTransformDialog({
  statementEnd,
  rowDates,
  ...props
}: Omit<TransformDialogProps, "saved"> & {
  statementEnd?: string | null;
  rowDates: (string | null | undefined)[];
}) {
  const query = useSavedTransforms();
  const mutations = useSavedTransformMutations();
  const month = useMemo(() => defaultMonth({ statementEnd, rowDates }), [statementEnd, rowDates]);

  if (query.isPending && query.fetchStatus !== "idle") return null;

  return (
    <TransformDialog
      {...props}
      saved={{
        transforms: query.data ?? [],
        defaultMonth: month,
        onCreate: (name, rule) => mutations.create.mutateAsync({ name, rule }),
        onUpdate: (id, changes) => mutations.update.mutateAsync({ id, ...changes }),
        onDelete: (id) => mutations.remove.mutateAsync(id),
        onReorder: (ids) => mutations.reorder.mutateAsync(ids),
      }}
    />
  );
}
