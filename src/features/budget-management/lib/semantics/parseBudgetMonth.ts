/**
 * PR-033 / F-088 — runtime budget-month contract parser (transport boundary).
 *
 * Turns a raw Direct (`@actual-app/api getBudgetMonth`) or HTTP
 * (`/v1/budgets/{id}/months/{m}`) payload into a trustworthy normalized snapshot,
 * BEFORE any feature/financial normalization. It does NOT derive semantics
 * (that is the mode-aware selectors' job). Its only jobs:
 *
 * - unwrap the HTTP `{ data: … }` (and `{ body: { data } }`) envelope;
 * - validate required month fields and the groups array;
 * - **preserve source signs** (never negate — Tracking `totalBudgeted` is +,
 *   Envelope is −; see `agents/planning/PR-033-phase0-contract-findings.md`);
 * - **distinguish absent/null from 0** — a not-applicable field is `null`, a real
 *   zero is `0`. HTTP coerces some Tracking funding fields `null → 0`; that is a
 *   transport quirk the semantic layer ignores, but the parser reports faithfully;
 * - carry `hidden` and `is_income` flags and per-side conditional fields;
 * - collect non-fatal warnings (e.g. income parent/child side mismatch) without
 *   throwing, and return actionable errors for genuinely unusable payloads.
 */

/** Minor-unit amount; `null` means the field is absent / not-applicable (≠ 0). */
export type ParsedAmount = number | null;

export type ParsedCategory = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: ParsedAmount;
  spent: ParsedAmount;
  received: ParsedAmount;
  balance: ParsedAmount;
  /** `null` when the contract does not expose carryover for this side/mode. */
  carryover: boolean | null;
};

export type ParsedGroup = {
  id: string;
  name: string;
  isIncome: boolean;
  hidden: boolean;
  budgeted: ParsedAmount;
  spent: ParsedAmount;
  received: ParsedAmount;
  balance: ParsedAmount;
  categories: ParsedCategory[];
};

export type ParsedBudgetMonth = {
  month: string;
  // Summary — signs preserved, `null` where absent (e.g. Envelope funding fields
  // are null in a Tracking payload).
  incomeAvailable: ParsedAmount;
  lastMonthOverspent: ParsedAmount;
  forNextMonth: ParsedAmount;
  totalBudgeted: ParsedAmount;
  toBudget: ParsedAmount;
  fromLastMonth: ParsedAmount;
  totalIncome: ParsedAmount;
  totalSpent: ParsedAmount;
  totalBalance: ParsedAmount;
  groups: ParsedGroup[];
};

export type ParseResult =
  | { ok: true; month: ParsedBudgetMonth; warnings: string[] }
  | { ok: false; errors: string[] };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** number → number (incl. 0); anything else (null/undefined/string) → null. */
function amount(o: Record<string, unknown>, key: string): ParsedAmount {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function bool(o: Record<string, unknown>, key: string): boolean {
  return o[key] === true;
}

/** carryover: boolean when present, else `null` (side/mode does not expose it). */
function carryover(o: Record<string, unknown>): boolean | null {
  return typeof o["carryover"] === "boolean" ? (o["carryover"] as boolean) : null;
}

function isIncomeSide(o: Record<string, unknown>): boolean {
  return o["is_income"] === true || o["isIncome"] === true;
}

/** Unwrap HTTP `{ data }` / `{ body: { data } }`; Direct payloads pass through. */
function unwrap(input: unknown): unknown {
  if (isRecord(input) && isRecord(input.body) && "data" in input.body) return input.body.data;
  if (isRecord(input) && "data" in input && isRecord(input.data) && "month" in input.data) {
    return input.data;
  }
  return input;
}

function parseCategory(
  raw: unknown,
  groupIsIncome: boolean,
  warnings: string[],
  where: string
): ParsedCategory | null {
  if (!isRecord(raw)) {
    warnings.push(`${where}: category is not an object, skipped`);
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) {
    warnings.push(`${where}: category missing id, skipped`);
    return null;
  }
  const isIncome = isIncomeSide(raw);
  if (isIncome !== groupIsIncome) {
    // Real payloads occasionally carry a category whose side flag disagrees with
    // its group. Trust the group side for aggregation, but record it.
    warnings.push(`${where}/${id}: category is_income (${isIncome}) ≠ group (${groupIsIncome})`);
  }
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    isIncome: groupIsIncome,
    hidden: bool(raw, "hidden"),
    budgeted: amount(raw, "budgeted"),
    spent: amount(raw, "spent"),
    received: amount(raw, "received"),
    balance: amount(raw, "balance"),
    carryover: carryover(raw),
  };
}

function parseGroup(raw: unknown, warnings: string[]): ParsedGroup | null {
  if (!isRecord(raw)) {
    warnings.push("group is not an object, skipped");
    return null;
  }
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) {
    warnings.push("group missing id, skipped");
    return null;
  }
  const isIncome = isIncomeSide(raw);
  const rawCategories = Array.isArray(raw.categories) ? raw.categories : [];
  if (!Array.isArray(raw.categories)) {
    warnings.push(`group ${id}: categories is not an array, treated as empty`);
  }
  const categories = rawCategories
    .map((c) => parseCategory(c, isIncome, warnings, `group ${id}`))
    .filter((c): c is ParsedCategory => c !== null);
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : id,
    isIncome,
    hidden: bool(raw, "hidden"),
    budgeted: amount(raw, "budgeted"),
    spent: amount(raw, "spent"),
    received: amount(raw, "received"),
    balance: amount(raw, "balance"),
    categories,
  };
}

const MONTH_RE = /^\d{4}-\d{2}$/;

export function parseBudgetMonth(input: unknown): ParseResult {
  const root = unwrap(input);
  if (!isRecord(root)) {
    return { ok: false, errors: ["budget month payload is not an object"] };
  }

  const errors: string[] = [];
  const month = typeof root.month === "string" ? root.month : null;
  if (!month || !MONTH_RE.test(month)) {
    errors.push(`missing or malformed "month" (expected YYYY-MM, got ${JSON.stringify(root.month)})`);
  }
  if (!Array.isArray(root.categoryGroups)) {
    errors.push(`"categoryGroups" is missing or not an array`);
  }
  if (errors.length > 0) return { ok: false, errors };

  const warnings: string[] = [];
  const groups = (root.categoryGroups as unknown[])
    .map((g) => parseGroup(g, warnings))
    .filter((g): g is ParsedGroup => g !== null);

  const parsed: ParsedBudgetMonth = {
    month: month as string,
    incomeAvailable: amount(root, "incomeAvailable"),
    lastMonthOverspent: amount(root, "lastMonthOverspent"),
    forNextMonth: amount(root, "forNextMonth"),
    totalBudgeted: amount(root, "totalBudgeted"),
    toBudget: amount(root, "toBudget"),
    fromLastMonth: amount(root, "fromLastMonth"),
    totalIncome: amount(root, "totalIncome"),
    totalSpent: amount(root, "totalSpent"),
    totalBalance: amount(root, "totalBalance"),
    groups,
  };

  return { ok: true, month: parsed, warnings };
}
