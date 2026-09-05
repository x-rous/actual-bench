/**
 * The rule field/operator model, mirrored from Actual Budget's own derivation.
 *
 * This file is **not** an independent list of things Bench chooses to support. It is a mirror of
 * `loot-core/src/shared/rules.ts`, where the valid operators for a field are derived as:
 *
 *     validOps(field) = TYPE_INFO[FIELD_INFO[field].type].ops - FIELD_INFO[field].disallowedOps
 *
 * The engine asserts this in `new Condition(...)` (`isValidOp`), so an operator invented here is
 * not a Bench-only extension — it is a rule Actual will refuse to save on both transports.
 *
 * To extend: re-derive from the bundled engine at
 * `node_modules/@actual-app/api/dist/index.js` (search `var TYPE_INFO`, `var FIELD_INFO`,
 * `var ACTION_OPS`), and update `ruleFields.test.ts`, which encodes the tables below as a
 * parity contract. Never add an operator by hand.
 *
 * Reference: agents/actual_api_docs/actual_rules.md
 */

export type FieldType = "string" | "id" | "number" | "date" | "boolean";

export type FieldDef = {
  label: string;
  type: FieldType;
  /** For id fields, which entity type to look up */
  entity?: "payee" | "category" | "account" | "categoryGroup";
  /** Whether this field supports Handlebars template mode */
  supportsTemplate?: boolean;
  /** Whether this field supports Excel formula mode */
  supportsFormula?: boolean;
  /**
   * Condition-field only: this is a UI pseudo-field that serializes to another field plus
   * options (Actual's `deserializeField`). `amount-inflow` → `amount` + `{ inflow: true }`.
   */
  pseudoFor?: { field: string; options: { inflow?: boolean; outflow?: boolean } };
  /**
   * Action-field only: cannot be set on a split child, only on the parent transaction
   * (Actual's `parentOnlyFields`).
   */
  parentOnly?: boolean;
};

export type OpDef = {
  label: string;
  /** Whether the op takes a value (false for e.g. onBudget/offBudget) */
  hasValue: boolean;
};

/**
 * Every lookup table below is keyed by a field or operator name that can arrive from stored data
 * or an imported CSV, so `FIELD_INFO["constructor"]` and `"toString" in ALLOCATION_METHODS` are
 * both reachable. Giving the tables a null prototype makes every such lookup miss, which is what
 * the surrounding code already expects an unknown key to do.
 */
function table<T extends object>(entries: T): T {
  return Object.assign(Object.create(null) as T, entries);
}

// ─── Actual's TYPE_INFO ───────────────────────────────────────────────────────

const TYPE_OPS: Record<FieldType, readonly string[]> = table({
  date:    ["is", "isapprox", "gt", "gte", "lt", "lte"],
  id:      ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf", "onBudget", "offBudget"],
  string:  ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf", "hasTags", "hasAnyTag"],
  number:  ["is", "isapprox", "isbetween", "gt", "gte", "lt", "lte"],
  boolean: ["is"],
});

// ─── Actual's FIELD_INFO ──────────────────────────────────────────────────────
//
// Every field the engine knows about, including the ones Actual does not offer as rule
// conditions (`payee_name`, `reconciled`, `transfer`, `parent`). They are modelled so that
// validation and diagnostics recognise them, and listed separately for the dropdowns.

const FIELD_INFO: Record<string, { type: FieldType; disallowedOps?: readonly string[] }> = table({
  imported_payee: { type: "string", disallowedOps: ["hasTags", "hasAnyTag"] },
  payee:          { type: "id",     disallowedOps: ["onBudget", "offBudget"] },
  payee_name:     { type: "string" },
  date:           { type: "date" },
  notes:          { type: "string", disallowedOps: ["oneOf", "notOneOf"] },
  amount:         { type: "number" },
  category:       { type: "id",     disallowedOps: ["onBudget", "offBudget"] },
  category_group: { type: "id",     disallowedOps: ["onBudget", "offBudget"] },
  account:        { type: "id" },
  cleared:        { type: "boolean" },
  reconciled:     { type: "boolean" },
  transfer:       { type: "boolean" },
  parent:         { type: "boolean" },
});

/** Ops the engine accepts but never offers in a picker (Actual's `internalOps`). */
const INTERNAL_OPS: Record<string, readonly string[]> = table({
  category: ["and"],
  category_group: ["and"],
});

/**
 * Valid operators for a field, in Actual's own order.
 * Mirrors `getValidOps` — internal ops are deliberately excluded, since they are never offered.
 */
export function getValidOps(field: string): string[] {
  const info = FIELD_INFO[field];
  const ops = info && TYPE_OPS[info.type];
  if (!ops) return [];
  const disallowed = new Set(info.disallowedOps ?? []);
  return ops.filter((op) => !disallowed.has(op));
}

/** True when the engine would accept this operator on this field, including internal ops. */
export function isValidOp(field: string, op: string): boolean {
  const info = FIELD_INFO[field];
  const ops = info && TYPE_OPS[info.type];
  if (!ops) return false;
  if (info.disallowedOps?.includes(op)) return false;
  return ops.includes(op) || (INTERNAL_OPS[field]?.includes(op) ?? false);
}

export function fieldType(field: string): FieldType | undefined {
  return FIELD_INFO[field]?.type;
}

// ─── Operator labels (Actual's `friendlyOp`) ──────────────────────────────────
//
// `gt`/`gte`/`lt`/`lte` read differently on dates than on numbers — "is after" is a *label*
// for `gt`, not an operator. Storing "isAfter" is what F-111 was.

const OP_LABELS: Record<string, string> = table({
  is:             "is",
  isNot:          "is not",
  isapprox:       "is approx.",
  isbetween:      "is between",
  contains:       "contains",
  doesNotContain: "does not contain",
  oneOf:          "is one of",
  notOneOf:       "is not one of",
  matches:        "matches",
  hasTags:        "has all tags",
  hasAnyTag:      "has any tag",
  gt:             "is greater than",
  gte:            "is greater than or equals",
  lt:             "is less than",
  lte:            "is less than or equals",
  onBudget:       "is on budget",
  offBudget:      "is off budget",
});

const DATE_OP_LABELS: Record<string, string> = table({
  gt:  "is after",
  gte: "is after or equals",
  lt:  "is before",
  lte: "is before or equals",
});

const VALUELESS_OPS = new Set(["onBudget", "offBudget"]);

/** Human label for an operator, type-aware exactly as Actual's `friendlyOp(op, type)` is. */
export function friendlyOp(op: string, type?: FieldType): string {
  if (type === "date" && DATE_OP_LABELS[op]) return DATE_OP_LABELS[op];
  return OP_LABELS[op] ?? op;
}

// ─── Condition fields ─────────────────────────────────────────────────────────
//
// The order matches Actual's `conditionFields` so the two dropdowns read the same.
// `amount-inflow` / `amount-outflow` are pseudo-fields: they never reach the wire, where they
// are `amount` carrying `options.inflow` / `options.outflow`.

export const CONDITION_FIELDS: Record<string, FieldDef> = table({
  imported_payee:  { label: "Imported Payee", type: "string" },
  account:         { label: "Account",        type: "id",     entity: "account" },
  category:        { label: "Category",       type: "id",     entity: "category" },
  category_group:  { label: "Category Group", type: "id",     entity: "categoryGroup" },
  date:            { label: "Date",           type: "date" },
  payee:           { label: "Payee",          type: "id",     entity: "payee" },
  notes:           { label: "Notes",          type: "string" },
  amount:          { label: "Amount",         type: "number" },
  "amount-inflow":  {
    label: "Amount (inflow)",
    type: "number",
    pseudoFor: { field: "amount", options: { inflow: true } },
  },
  "amount-outflow": {
    label: "Amount (outflow)",
    type: "number",
    pseudoFor: { field: "amount", options: { outflow: true } },
  },
  cleared:         { label: "Cleared",        type: "boolean" },
});

/** Default field for a newly added condition. Not derived from key order. */
export const DEFAULT_CONDITION_FIELD = "payee";

/**
 * The pseudo-field key a stored condition should display as.
 * Mirrors Actual's inverse of `deserializeField`.
 */
export function conditionDisplayField(
  field: string | undefined,
  options?: { inflow?: boolean; outflow?: boolean }
): string {
  if (field !== "amount" || !options) return field ?? "";
  if (options.inflow) return "amount-inflow";
  if (options.outflow) return "amount-outflow";
  return field;
}

// ─── Action fields ────────────────────────────────────────────────────────────
//
// Order matches Actual's `getActionFields`. Template and formula modes are a *deny*-list:
// available on every `set` field except the three whose values are entity IDs.

const TEMPLATE_DENIED_FIELDS = new Set(["payee", "category", "account"]);

/** Fields Actual refuses to set on a split child (`parentOnlyFields`). */
export const PARENT_ONLY_ACTION_FIELDS = new Set(["amount", "cleared", "account", "date"]);

function actionField(
  key: string,
  label: string,
  type: FieldType,
  entity?: FieldDef["entity"]
): FieldDef {
  const templatable = !TEMPLATE_DENIED_FIELDS.has(key);
  return {
    label,
    type,
    ...(entity ? { entity } : {}),
    ...(templatable ? { supportsTemplate: true, supportsFormula: true } : {}),
    ...(PARENT_ONLY_ACTION_FIELDS.has(key) ? { parentOnly: true } : {}),
  };
}

export const ACTION_FIELDS: Record<string, FieldDef> = table({
  category:   actionField("category",   "Category",   "id", "category"),
  payee:      actionField("payee",      "Payee",      "id", "payee"),
  payee_name: actionField("payee_name", "Payee Name", "string"),
  notes:      actionField("notes",      "Notes",      "string"),
  cleared:    actionField("cleared",    "Cleared",    "boolean"),
  account:    actionField("account",    "Account",    "id", "account"),
  date:       actionField("date",       "Date",       "date"),
  amount:     actionField("amount",     "Amount",     "number"),
});

/** Default field for a newly added action. Not derived from key order. */
export const DEFAULT_ACTION_FIELD = "category";

/** Action fields available inside a split child. */
export function getSplitActionFields(): Record<string, FieldDef> {
  return table(
    Object.fromEntries(
      Object.entries(ACTION_FIELDS).filter(([key]) => !PARENT_ONLY_ACTION_FIELDS.has(key))
    )
  );
}

// ─── Action operators ─────────────────────────────────────────────────────────

/**
 * Every action op the engine accepts (Actual's `ACTION_OPS`). Validation and diagnostics read
 * this; the editor's op dropdown reads `ACTION_OP_OPTIONS` instead, because `set-split-amount`
 * is created by the split UI and `link-schedule` is owned by the Schedules page.
 */
export const ACTION_OPS: Record<string, OpDef> = table({
  set:                  { label: "Set",                hasValue: true },
  "set-split-amount":   { label: "Allocate",           hasValue: true },
  "link-schedule":      { label: "Link Schedule",      hasValue: true },
  "prepend-notes":      { label: "Prepend to Notes",   hasValue: true },
  "append-notes":       { label: "Append to Notes",    hasValue: true },
  "delete-transaction": { label: "Delete transaction", hasValue: false },
});

/** The ops the action row's dropdown offers, matching Actual's `OpSelect`. */
export const ACTION_OP_OPTIONS = [
  "set",
  "prepend-notes",
  "append-notes",
  "delete-transaction",
] as const;

// ─── Split allocation methods ─────────────────────────────────────────────────

export type AllocationMethod = "fixed-amount" | "fixed-percent" | "formula" | "remainder";

/** Labels match Actual's `getAllocationMethods`. */
export const ALLOCATION_METHODS: Record<AllocationMethod, string> = table({
  "fixed-amount":  "a fixed amount",
  "fixed-percent": "a fixed percent of the remainder",
  formula:         "based on a formula",
  remainder:       "an equal portion of the remainder",
});

export const ALLOCATION_METHOD_OPTIONS = Object.keys(ALLOCATION_METHODS) as AllocationMethod[];

export function isAllocationMethod(value: unknown): value is AllocationMethod {
  return typeof value === "string" && value in ALLOCATION_METHODS;
}

// ─── Condition operator lookup ────────────────────────────────────────────────

/**
 * Valid operators for a condition field, keyed by op with a display label.
 * Pseudo-fields resolve to the field they stand for.
 */
export function getConditionOps(field: string): Record<string, OpDef> {
  const def = CONDITION_FIELDS[field];
  const realField = def?.pseudoFor?.field ?? field;
  const type = fieldType(realField);
  const ops = getValidOps(realField);
  // Null prototype for the same reason the static tables have one: callers look an operator up
  // by name (`getConditionOps(field)[part.op]`), and on a plain object `["toString"]` is truthy,
  // which would let a condition with `op: "toString"` pass validation.
  const out: Record<string, OpDef> = table({});
  for (const op of ops) {
    out[op] = { label: friendlyOp(op, type), hasValue: !VALUELESS_OPS.has(op) };
  }
  return out;
}

// ─── Value editors ────────────────────────────────────────────────────────────

/**
 * Which value editor a condition needs. Centralised here because the answer depends on the
 * field *and* the operator: `payee contains` matches the raw ID string, so it needs free text
 * rather than the entity combobox, even though `payee is` needs the combobox.
 */
export type ValueKind =
  | "none"
  | "text"
  | "multi-text"
  | "entity"
  | "multi-entity"
  | "number"
  | "range"
  | "date"
  | "boolean"
  | "tags";

export function conditionValueKind(field: string, op: string): ValueKind {
  if (VALUELESS_OPS.has(op)) return "none";
  if (op === "isbetween") return "range";
  if (op === "hasTags" || op === "hasAnyTag") return "tags";

  const def = CONDITION_FIELDS[field];
  const realField = def?.pseudoFor?.field ?? field;
  const type = fieldType(realField) ?? "string";
  const entity = def?.entity;

  if (op === "oneOf" || op === "notOneOf") {
    return entity ? "multi-entity" : "multi-text";
  }
  // Substring and regex operators compare against the raw stored value — for an id field that
  // is the UUID, so the entity picker would be misleading. Actual behaves the same way.
  if (op === "contains" || op === "doesNotContain" || op === "matches") return "text";

  switch (type) {
    case "id":      return entity ? "entity" : "text";
    case "number":  return "number";
    case "date":    return "date";
    case "boolean": return "boolean";
    default:        return "text";
  }
}

// ─── Stage ────────────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<string, string> = table({
  pre:     "Pre",
  default: "Default",
  post:    "Post",
});

export const STAGE_OPTIONS = ["pre", "default", "post"] as const;
export const CONDITIONS_OP_OPTIONS = ["and", "or"] as const;
