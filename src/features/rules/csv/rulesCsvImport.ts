import { parseCsvLine, CSV_MAX_BYTES } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import { ACTION_FIELDS, ACTION_OPS, CONDITION_FIELDS, isAllocationMethod } from "../utils/ruleFields";
import { hasDenseSplitIndices, isSplitRule } from "../lib/splitActions";
import type { Rule, Payee, RuleStage, ConditionsOp, ConditionOrAction, RuleOptions } from "@/types/entities";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A minimal structural type satisfied by any StagedMap whose entity has a name. */
type NamedEntityMap = Record<string, {
  entity: { id: string; name: string };
  isDeleted: boolean;
}>;

export type LookupMaps = {
  payees: NamedEntityMap;
  categories: NamedEntityMap;
  accounts: NamedEntityMap;
  categoryGroups: NamedEntityMap;
};

export type SkipReason = {
  ruleGroupId: string;
  reason: string;
};

export type RulesImportResult = {
  rules: Rule[];
  newPayees: Payee[];
  skipped: number;
  skipReasons: SkipReason[];
};

export type RulesImportError = {
  error: string;
};

// ─── Name resolution ──────────────────────────────────────────────────────────

function findIdByName(map: NamedEntityMap, name: string): string | undefined {
  const lower = name.trim().toLowerCase();
  for (const s of Object.values(map)) {
    if (!s.isDeleted && s.entity.name.trim().toLowerCase() === lower) return s.entity.id;
  }
  return undefined;
}

function resolveScalarValue(
  field: string,
  rawValue: string,
  maps: LookupMaps,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS,
  createdPayees: Map<string, string>,
  newPayees: Payee[],
  badRefs: string[]
): { value: ConditionOrAction["value"]; type: string } {
  const def = fieldDefs[field];

  // Boolean fields (e.g. cleared)
  if (def?.type === "boolean") {
    const boolVal = rawValue.trim().toLowerCase() === "true";
    return { value: boolVal, type: "boolean" };
  }

  if (!def || def.type !== "id") return { value: rawValue, type: def?.type ?? "string" };

  if (def.entity === "payee") {
    const lower = rawValue.trim().toLowerCase();
    if (createdPayees.has(lower)) return { value: createdPayees.get(lower)!, type: "id" };
    const existing = findIdByName(maps.payees, rawValue);
    if (existing) return { value: existing, type: "id" };
    // Auto-create: collected here, staged by the caller after pushUndo
    const id = generateId();
    newPayees.push({ id, name: rawValue.trim() });
    createdPayees.set(lower, id);
    return { value: id, type: "id" };
  }

  if (def.entity === "category") {
    const existing = findIdByName(maps.categories, rawValue);
    if (!existing && rawValue.trim()) badRefs.push(`category "${rawValue.trim()}"`);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  if (def.entity === "account") {
    const existing = findIdByName(maps.accounts, rawValue);
    if (!existing && rawValue.trim()) badRefs.push(`account "${rawValue.trim()}"`);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  if (def.entity === "categoryGroup") {
    const existing = findIdByName(maps.categoryGroups, rawValue);
    if (!existing && rawValue.trim()) badRefs.push(`category group "${rawValue.trim()}"`);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  return { value: rawValue, type: "id" };
}

function resolveValue(
  field: string,
  op: string,
  rawValue: string,
  fieldDefs: typeof CONDITION_FIELDS | typeof ACTION_FIELDS,
  maps: LookupMaps,
  createdPayees: Map<string, string>,
  newPayees: Payee[],
  badRefs: string[]
): { value: ConditionOrAction["value"]; type: string } {
  const isMulti = op === "oneOf" || op === "notOneOf";
  if (isMulti && rawValue.includes("|")) {
    const parts = rawValue.split("|").map((p) => p.trim()).filter(Boolean);
    const resolved = parts.map(
      (p) => resolveScalarValue(field, p, maps, fieldDefs, createdPayees, newPayees, badRefs).value as string
    );
    return { value: resolved, type: "id" };
  }
  return resolveScalarValue(field, rawValue, maps, fieldDefs, createdPayees, newPayees, badRefs);
}

// ─── Formula guard ────────────────────────────────────────────────────────────

/**
 * Inverse of the exporter's `guardCsvText`. Strips exactly one leading `'`, and only when what
 * follows is itself guarded — a formula lead, or another apostrophe. So `'=1+1` round-trips as
 * `''=1+1` and comes back whole, while a plain `tis` is never touched.
 */
function unguardCsvText(value: string): string {
  return /^'['=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

// ─── Options ──────────────────────────────────────────────────────────────────

/**
 * Inverse of the exporter's `encodeOptions`: a `k=v;k=v` cell plus the dedicated `split_index`
 * column. Unrecognised keys are ignored rather than carried through — the CSV is a user-editable
 * surface, and a typo should not become an option the engine will reject.
 */
function decodeOptions(
  raw: string,
  splitIndexRaw: string
): { options?: RuleOptions; error?: string } {
  const options: RuleOptions = {};

  for (const pair of raw.split(";")) {
    const [key, value] = pair.split("=").map((p) => p.trim());
    if (!key) continue;
    if (key === "method" && isAllocationMethod(value)) options.method = value;
    else if (key === "inflow" && value === "true") options.inflow = true;
    else if (key === "outflow" && value === "true") options.outflow = true;
  }

  // The cell is hand-editable, so both flags can arrive together. They contradict each other —
  // the engine would match nothing — so this is a malformed rule, not one to guess at.
  if (options.inflow && options.outflow) {
    return { error: "options cannot set both inflow and outflow" };
  }

  const splitIndex = Number(splitIndexRaw);
  if (splitIndexRaw !== "" && Number.isInteger(splitIndex) && splitIndex > 0) {
    options.splitIndex = splitIndex;
  }

  return { options: Object.keys(options).length > 0 ? options : undefined };
}

/** Ops the importer understands in the `op` column of an action row. */
const IMPORTABLE_ACTION_OPS = new Set([
  ...Object.keys(ACTION_OPS).filter((op) => op !== "link-schedule"),
  "set-template",
  "set-formula",
  "",
]);

// ─── Main import function ─────────────────────────────────────────────────────

/**
 * Parse long-format rules CSV and return the rules and new payees to stage.
 *
 * Does NOT mutate the store — the caller is responsible for calling pushUndo
 * and staging the returned rules and newPayees.
 *
 * Algorithm (two-pass):
 *   Pass 1 — group rows by rule_id.
 *   Pass 2 — resolve names → IDs, build conditions + actions, assign fresh UUIDs.
 */
export function importRulesFromCsv(
  text: string,
  maps: LookupMaps
): RulesImportResult | RulesImportError {
  if (text.length > CSV_MAX_BYTES) return { error: "File is too large (max 5 MB)." };

  const rawLines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (rawLines.length < 2) return { error: "CSV has no data rows." };

  const headers = parseCsvLine(rawLines[0]).map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const ruleIdIdx  = col("rule_id");
  const stageIdx   = col("stage");
  const condOpIdx  = col("conditions_op");
  const rowTypeIdx = col("row_type");
  const fieldIdx   = col("field");
  const opIdx      = col("op");
  const valueIdx   = col("value");
  const splitIdx   = col("split_index");
  const optionsIdx = col("options");

  if (ruleIdIdx === -1 || rowTypeIdx === -1 || fieldIdx === -1) {
    return {
      error:
        'CSV must have "rule_id", "row_type", and "field" columns. ' +
        "Please use the Export function to get a correctly-formatted template.",
    };
  }

  const cellAt = (row: string[], idx: number): string =>
    idx !== -1 ? (row[idx]?.trim() ?? "") : "";

  // ── Pass 1: group rows by rule_id ──────────────────────────────────────────
  type RuleGroup = {
    stage: string;
    conditionsOp: string;
    isScheduleRule: boolean;
    rows: {
      rowType: string;
      field: string;
      op: string;
      rawValue: string;
      options?: RuleOptions;
      optionsError?: string;
    }[];
  };

  const groups = new Map<string, RuleGroup>();
  let parseSkipped = 0;

  for (let i = 1; i < rawLines.length; i++) {
    const row    = parseCsvLine(rawLines[i]);
    const ruleId = cellAt(row, ruleIdIdx);
    if (!ruleId) { parseSkipped++; continue; }

    if (!groups.has(ruleId)) groups.set(ruleId, { stage: "", conditionsOp: "", isScheduleRule: false, rows: [] });

    const group        = groups.get(ruleId)!;
    const stage        = cellAt(row, stageIdx);
    const conditionsOp = cellAt(row, condOpIdx);
    const rowType      = cellAt(row, rowTypeIdx);
    const field        = cellAt(row, fieldIdx);
    const op           = cellAt(row, opIdx);
    const rawValue     = cellAt(row, valueIdx);

    if (stage && !group.stage)               group.stage        = stage;
    if (conditionsOp && !group.conditionsOp) group.conditionsOp = conditionsOp;
    if (rowType === "action" && op === "link-schedule") group.isScheduleRule = true;

    // Accept: conditions with a field, or actions with a field. `delete-transaction` and
    // `set-split-amount` legitimately have no field — before this, a `set-split-amount` row was
    // dropped here without a word, which is how a CSV round-trip lost a rule's splits.
    const isFieldlessAction = op === "delete-transaction" || op === "set-split-amount";
    const isValidRow =
      (rowType === "condition" && !!field) ||
      (rowType === "action" && (!!field || isFieldlessAction));

    if (isValidRow) {
      const decoded = decodeOptions(cellAt(row, optionsIdx), cellAt(row, splitIdx));
      group.rows.push({
        rowType,
        field,
        op,
        rawValue: unguardCsvText(rawValue),
        options: decoded.options,
        optionsError: decoded.error,
      });
    }
  }

  // ── Pass 2: build rules ────────────────────────────────────────────────────
  const validStages: RuleStage[]     = ["pre", "default", "post"];
  const validCondOps: ConditionsOp[] = ["and", "or"];

  const rules: Rule[] = [];
  const newPayees: Payee[] = [];
  const createdPayees = new Map<string, string>();
  let skipped = parseSkipped;
  const skipReasons: SkipReason[] = [];

  for (const [ruleGroupId, group] of groups) {
    if (group.isScheduleRule) { skipped++; continue; }

    const newPayeesStart = newPayees.length;
    const createdPayeesSnapshot = new Map(createdPayees);
    const badRefs: string[] = [];
    const conditions: ConditionOrAction[] = [];
    const actions:    ConditionOrAction[] = [];

    /** Attach the row's decoded options, if it had any, without inventing an empty bag. */
    const withRowOptions = (
      part: ConditionOrAction,
      options: RuleOptions | undefined
    ): ConditionOrAction => {
      const merged = { ...(part.options ?? {}), ...(options ?? {}) };
      return Object.keys(merged).length > 0 ? { ...part, options: merged } : part;
    };

    for (const { rowType, field, op, rawValue, options, optionsError } of group.rows) {
      if (optionsError) {
        badRefs.push(`unsupported ${optionsError}`);
        continue;
      }

      if (rowType === "condition") {
        const r = resolveValue(field, op, rawValue, CONDITION_FIELDS, maps, createdPayees, newPayees, badRefs);
        conditions.push(
          withRowOptions({ field, op: op || "is", value: r.value, type: r.type }, options)
        );
        continue;
      }

      // An op the importer does not know would previously have been silently rewritten as a
      // `set`, quietly turning it into a different rule. Skip the group and say why instead.
      if (!IMPORTABLE_ACTION_OPS.has(op)) {
        badRefs.push(`unsupported action "${op}"`);
        continue;
      }

      if (op === "set-template") {
        actions.push(
          withRowOptions({ field, op: "set", value: "", type: "string", options: { template: rawValue } }, options)
        );
      } else if (op === "set-formula") {
        // The exporter's formula guard was already removed by `unguardCsvText`.
        actions.push(
          withRowOptions({ field, op: "set", value: "", type: "string", options: { formula: rawValue } }, options)
        );
      } else if (op === "delete-transaction") {
        actions.push(withRowOptions({ op: "delete-transaction", value: "" }, options));
      } else if (op === "set-split-amount") {
        // `fixed-percent` carries a percentage and `fixed-amount` a money value; both are plain
        // numbers in the cell. `remainder` and `formula` carry no numeric value.
        const isFormulaMethod = options?.method === "formula";
        const numeric = Number(rawValue);
        actions.push(
          withRowOptions(
            {
              op: "set-split-amount",
              value: isFormulaMethod || rawValue === "" || Number.isNaN(numeric) ? null : numeric,
              type: "number",
              ...(isFormulaMethod && rawValue ? { options: { formula: rawValue } } : {}),
            },
            options
          )
        );
      } else if (op === "prepend-notes" || op === "append-notes") {
        actions.push(withRowOptions({ field: field || "notes", op, value: rawValue, type: "string" }, options));
      } else {
        const r = resolveValue(field, "set", rawValue, ACTION_FIELDS, maps, createdPayees, newPayees, badRefs);
        actions.push(withRowOptions({ field, op: "set", value: r.value, type: r.type }, options));
      }
    }

    if (badRefs.length > 0) {
      // Roll back any payees auto-created while processing this skipped group.
      newPayees.length = newPayeesStart;
      createdPayees.clear();
      for (const [k, v] of createdPayeesSnapshot) createdPayees.set(k, v);
      skipped++;
      const unsupported = badRefs.filter((ref) => ref.startsWith("unsupported "));
      const unmatched = badRefs.filter((ref) => !ref.startsWith("unsupported "));
      const parts = [
        unmatched.length > 0 ? `unmatched ${[...new Set(unmatched)].join(", ")}` : "",
        ...new Set(unsupported),
      ].filter(Boolean);
      skipReasons.push({ ruleGroupId, reason: parts.join("; ") });
      continue;
    }

    if (conditions.length === 0 && actions.length === 0) { skipped++; continue; }

    // The importer stages rules directly, without the editor ever opening them, so a malformed
    // split has to be caught here — the drawer's own dense-index check would never run.
    if (isSplitRule(actions) && !hasDenseSplitIndices(actions)) {
      newPayees.length = newPayeesStart;
      createdPayees.clear();
      for (const [k, v] of createdPayeesSnapshot) createdPayees.set(k, v);
      skipped++;
      skipReasons.push({
        ruleGroupId,
        reason: "split_index values must run 1, 2, 3… with no gaps",
      });
      continue;
    }

    rules.push({
      id: generateId(),
      stage: validStages.includes(group.stage as RuleStage)
        ? (group.stage as RuleStage)
        : "default",
      conditionsOp: validCondOps.includes(group.conditionsOp as ConditionsOp)
        ? (group.conditionsOp as ConditionsOp)
        : "and",
      conditions,
      actions,
    });
  }

  return { rules, newPayees, skipped, skipReasons };
}
