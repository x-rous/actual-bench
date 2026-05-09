import { parseCsvLine, CSV_MAX_BYTES } from "@/lib/csv";
import { generateId } from "@/lib/uuid";
import { CONDITION_FIELDS, ACTION_FIELDS } from "../utils/ruleFields";
import type { Rule, Payee, RuleStage, ConditionsOp, ConditionOrAction } from "@/types/entities";

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

export type RulesImportResult = {
  rules: Rule[];
  newPayees: Payee[];
  skipped: number;
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
  newPayees: Payee[]
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
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  if (def.entity === "account") {
    const existing = findIdByName(maps.accounts, rawValue);
    return { value: existing ?? rawValue, type: existing ? "id" : "string" };
  }

  if (def.entity === "categoryGroup") {
    const existing = findIdByName(maps.categoryGroups, rawValue);
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
  newPayees: Payee[]
): { value: ConditionOrAction["value"]; type: string } {
  const isMulti = op === "oneOf" || op === "notOneOf";
  if (isMulti && rawValue.includes("|")) {
    const parts = rawValue.split("|").map((p) => p.trim()).filter(Boolean);
    const resolved = parts.map(
      (p) => resolveScalarValue(field, p, maps, fieldDefs, createdPayees, newPayees).value as string
    );
    return { value: resolved, type: "id" };
  }
  return resolveScalarValue(field, rawValue, maps, fieldDefs, createdPayees, newPayees);
}

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
    rows: { rowType: string; field: string; op: string; rawValue: string }[];
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
    if (op === "link-schedule")              group.isScheduleRule = true;

    // Accept: conditions with a field, or actions with a field or delete-transaction op
    const isValidRow =
      (rowType === "condition" && !!field) ||
      (rowType === "action" && (!!field || op === "delete-transaction"));

    if (isValidRow) {
      group.rows.push({ rowType, field, op, rawValue });
    }
  }

  // ── Pass 2: build rules ────────────────────────────────────────────────────
  const validStages: RuleStage[]     = ["pre", "default", "post"];
  const validCondOps: ConditionsOp[] = ["and", "or"];

  const rules: Rule[] = [];
  const newPayees: Payee[] = [];
  const createdPayees = new Map<string, string>();
  let skipped = parseSkipped;

  for (const [, group] of groups) {
    if (group.isScheduleRule) { skipped++; continue; }

    const conditions: ConditionOrAction[] = [];
    const actions:    ConditionOrAction[] = [];

    for (const { rowType, field, op, rawValue } of group.rows) {
      if (rowType === "condition") {
        const r = resolveValue(field, op, rawValue, CONDITION_FIELDS, maps, createdPayees, newPayees);
        conditions.push({ field, op: op || "is", value: r.value, type: r.type });
      } else {
        if (op === "set-template") {
          actions.push({ field, op: "set", value: "", type: "string", options: { template: rawValue } });
        } else if (op === "delete-transaction") {
          actions.push({ op: "delete-transaction", value: "" });
        } else if (op === "prepend-notes" || op === "append-notes") {
          actions.push({ field: field || "notes", op, value: rawValue, type: "string" });
        } else {
          const r = resolveValue(field, "set", rawValue, ACTION_FIELDS, maps, createdPayees, newPayees);
          actions.push({ field, op: "set", value: r.value, type: r.type });
        }
      }
    }

    if (conditions.length === 0 && actions.length === 0) { skipped++; continue; }

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

  return { rules, newPayees, skipped };
}
