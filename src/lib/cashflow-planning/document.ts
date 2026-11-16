import { generateId } from "@/lib/uuid";
import {
  AVERAGE_WINDOWS, MAX_MONTHS, MIN_MONTHS, SCHEMA_VERSION, SECTIONS,
  type AccountLink, type GroupColor, isGroupColor, type Basis, type Goal, type Month, type PlanAccountRole, type PlanDocument, type PlanGroup, type PlanRow, type RepeatRule, type RowLinks, type SectionId,
} from "./types";
import { addMonths, isMonth, monthsBetween } from "./months";

/**
 * Creating, checking and editing plan documents. Pure and safe to import from server code: the app-database repository
 * and the JSON import both read a document through `parsePlanDocument`, so a stored plan and an imported file are held to
 * the same rules. Every edit returns a new document and leaves the one it was given untouched.
 */

export const NAME_MAX = 80;
export const NOTES_MAX = 2000;
export const MAX_ROWS = 500;
export const MAX_GROUPS = 100;
export const MAX_RULES = 24;
export const MAX_GOALS = 20;
export const MAX_LINKS = 400;
export const MAX_MOVES = 2000;
/** 10^13 minor units: far above any real balance, far below where integers stop being exact. */
export const MAX_AMOUNT = 10_000_000_000_000;

export class PlanDocumentError extends Error {}

/** A new plan, of `months` months, or of `years` years (5 when neither is given). */
export function createPlanDocument(input: { name: string; startMonth: Month; years?: number; months?: number; useActuals?: boolean }): PlanDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    name: input.name.trim().slice(0, NAME_MAX) || "Cash plan",
    startMonth: input.startMonth,
    months: input.months ?? (input.years ?? 5) * 12,
    useActuals: input.useActuals ?? true,
    openingBalance: 0,
    accountRoles: {},
    minimumCash: null,
    savingsGrowthPct: 0,
    groups: [],
    rows: [],
    goals: [],
    moves: {},
  };
}

export function createRow(input: { name: string; section: SectionId; groupId?: string | null; basis?: Basis; links?: Partial<RowLinks>; notes?: string }): PlanRow {
  return {
    id: generateId(),
    name: input.name.trim().slice(0, NAME_MAX) || "New row",
    section: input.section,
    groupId: input.groupId ?? null,
    ...(input.notes ? { notes: input.notes.slice(0, NOTES_MAX) } : {}),
    links: { categories: input.links?.categories ?? [], categoryGroups: input.links?.categoryGroups ?? [], accounts: input.links?.accounts ?? [] },
    basis: input.basis ?? { kind: "manual" },
    rules: [],
    cells: {},
  };
}

/** The last month of the plan. */
export const planEndMonth = (doc: Pick<PlanDocument, "startMonth" | "months">): Month => addMonths(doc.startMonth, doc.months - 1);

// ─── Reading ─────────────────────────────────────────────────────────────────

const fail = (message: string): never => { throw new PlanDocumentError(message); };
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const amount = (value: unknown, what: string): number => (typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT ? value : fail(`${what} is not a valid amount`));
const text = (value: unknown, what: string, max: number): string => (typeof value === "string" && value.length <= max ? value : fail(`${what} is missing or too long`));
const id = (value: unknown, what: string): string => (typeof value === "string" && value.length > 0 && value.length <= 100 ? value : fail(`${what} is not a valid id`));
const month = (value: unknown, what: string): Month => (isMonth(value) ? value : fail(`${what} is not a month (YYYY-MM)`));
const percent = (value: unknown, what: string): number => (typeof value === "number" && Number.isFinite(value) && value >= -50 && value <= 100 ? value : fail(`${what} must be a percentage between -50 and 100`));
const list = (value: unknown, what: string, max: number): unknown[] => (Array.isArray(value) && value.length <= max ? value : fail(`${what} is missing or too long`));
const ids = (value: unknown, what: string): string[] => [...new Set(list(value, what, MAX_LINKS).map((v) => id(v, what)))];

function parseBasis(value: unknown, row: string): Basis {
  if (!isRecord(value)) return fail(`${row}: the forecast setting is missing`);
  switch (value.kind) {
    case "manual": return { kind: "manual" };
    case "budget": return value.lag === 1 || value.lag === 2 ? { kind: "budget", lag: value.lag } : { kind: "budget" };
    case "loan": return value.count === "principal" ? { kind: "loan", count: "principal" } : { kind: "loan" };
    case "schedule": return { kind: "schedule", scheduleIds: ids(value.scheduleIds, `${row}: schedules`) };
    case "average": {
      const months = (AVERAGE_WINDOWS as readonly unknown[]).includes(value.months) ? (value.months as (typeof AVERAGE_WINDOWS)[number]) : fail(`${row}: the average must be over 3, 6, 12 or 24 months`);
      return { kind: "average", months, ...(value.growthPct ? { growthPct: percent(value.growthPct, `${row}: yearly growth`) } : {}) };
    }
    default: return fail(`${row}: unknown forecast setting`);
  }
}

function parseRule(value: unknown, row: string): RepeatRule {
  if (!isRecord(value)) return fail(`${row}: a repeating amount is not valid`);
  const every = typeof value.every === "number" && Number.isInteger(value.every) && value.every >= 1 && value.every <= 120 ? value.every : fail(`${row}: a repeating amount must repeat every 1 to 120 months`);
  const start = month(value.start, `${row}: repeat start`);
  const end = value.end == null ? undefined : month(value.end, `${row}: repeat end`);
  if (end && end < start) fail(`${row}: a repeating amount ends before it starts`);
  return { id: id(value.id, `${row}: repeat`), amount: amount(value.amount, `${row}: repeat amount`), start, ...(end ? { end } : {}), every, ...(value.growthPct ? { growthPct: percent(value.growthPct, `${row}: yearly growth`) } : {}) };
}

function parseLinks(value: unknown, row: string): RowLinks {
  if (!isRecord(value)) return fail(`${row}: links are missing`);
  const seen = new Set<string>();
  const accounts = list(value.accounts, `${row}: linked accounts`, MAX_LINKS).flatMap((entry): AccountLink[] => {
    if (!isRecord(entry)) return fail(`${row}: a linked account is not valid`);
    const accountId = id(entry.id, `${row}: linked account`);
    if (seen.has(accountId)) return [];
    seen.add(accountId);
    const flow = entry.flow == null ? undefined : entry.flow === "in" || entry.flow === "out" ? entry.flow : fail(`${row}: a linked account's direction is not valid`);
    return [{ id: accountId, ...(flow ? { flow } : {}) }];
  });
  return { categories: ids(value.categories, `${row}: linked categories`), categoryGroups: ids(value.categoryGroups, `${row}: linked category groups`), accounts };
}

/**
 * A plan document from untrusted JSON (the database, or an imported file), or a `PlanDocumentError` that says what is
 * wrong. Unknown fields are dropped. A document written by a newer version is refused, never guessed at.
 */
export function parsePlanDocument(value: unknown): PlanDocument {
  if (!isRecord(value)) return fail("This is not a cashflow plan");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    return fail(typeof value.schemaVersion === "number" && value.schemaVersion > SCHEMA_VERSION
      ? "This plan was saved by a newer version of Actual Bench"
      : "This is not a cashflow plan this version can read");
  }
  const name = text(value.name, "The plan name", NAME_MAX).trim() || fail("The plan needs a name");
  const startMonth = month(value.startMonth, "The first month");
  // A plan saved before the length was in months says how many years it covers.
  const length = value.months !== undefined ? value.months : typeof value.years === "number" ? value.years * 12 : undefined;
  const months = typeof length === "number" && Number.isInteger(length) && length >= MIN_MONTHS && length <= MAX_MONTHS ? length : fail(`A plan covers ${MIN_MONTHS} to ${MAX_MONTHS} months (${MAX_MONTHS / 12} years at most)`);
  const endMonth = planEndMonth({ startMonth, months });
  if (!isMonth(endMonth) || endMonth > "9999-12") fail("The plan ends too far in the future");

  const groups = list(value.groups, "Groups", MAX_GROUPS).map((entry): PlanGroup => {
    if (!isRecord(entry)) return fail("A group is not valid");
    const section = (SECTIONS as readonly unknown[]).includes(entry.section) ? (entry.section as SectionId) : fail("A group has no section");
    return { id: id(entry.id, "A group"), name: text(entry.name, "A group name", NAME_MAX).trim() || "Group", section, ...(isGroupColor(entry.color) ? { color: entry.color } : {}) };
  });
  const groupSection = new Map(groups.map((g) => [g.id, g.section]));
  if (groupSection.size !== groups.length) fail("Two groups share an id");

  const rows = list(value.rows, "Rows", MAX_ROWS).map((entry): PlanRow => {
    if (!isRecord(entry)) return fail("A row is not valid");
    const rowName = text(entry.name, "A row name", NAME_MAX).trim() || "Row";
    const section = (SECTIONS as readonly unknown[]).includes(entry.section) ? (entry.section as SectionId) : fail(`${rowName}: no section`);
    // A row whose group is gone, or sits in another section, falls back to its section rather than failing the whole plan.
    const groupId = typeof entry.groupId === "string" && groupSection.get(entry.groupId) === section ? entry.groupId : null;
    const cells: Record<Month, number> = {};
    if (!isRecord(entry.cells)) fail(`${rowName}: amounts are missing`);
    for (const [key, cell] of Object.entries(entry.cells as Record<string, unknown>)) {
      // Amounts outside the plan's months are kept out: they could never be seen or edited.
      if (isMonth(key) && key >= startMonth && key <= endMonth) cells[key] = amount(cell, `${rowName}: ${key}`);
    }
    const notes = entry.notes == null || entry.notes === "" ? undefined : text(entry.notes, `${rowName}: notes`, NOTES_MAX);
    return {
      id: id(entry.id, rowName), name: rowName, section, groupId, ...(notes ? { notes } : {}),
      links: parseLinks(entry.links, rowName), basis: parseBasis(entry.basis, rowName),
      rules: list(entry.rules, `${rowName}: repeating amounts`, MAX_RULES).map((rule) => parseRule(rule, rowName)), cells,
    };
  });
  if (new Set(rows.map((r) => r.id)).size !== rows.length) fail("Two rows share an id");

  const accountRoles: Record<string, PlanAccountRole> = {};
  if (!isRecord(value.accountRoles)) fail("Account settings are missing");
  for (const [accountId, role] of Object.entries(value.accountRoles as Record<string, unknown>).slice(0, 1000)) {
    if (role === "cash" || role === "savings" || role === "outside") accountRoles[id(accountId, "An account")] = role;
  }

  const goals = list(value.goals, "Goals", MAX_GOALS).map((entry): Goal => {
    if (!isRecord(entry)) return fail("A goal is not valid");
    return { id: id(entry.id, "A goal"), name: text(entry.name, "A goal name", NAME_MAX).trim() || "Goal", month: month(entry.month, "A goal's month"), amount: amount(entry.amount, "A goal's amount"), basis: entry.basis === "total" ? "total" : "cash" };
  });

  const moves: Record<string, Month> = {};
  if (value.moves != null) {
    if (!isRecord(value.moves)) fail("Moved transactions are not valid");
    const entries = Object.entries(value.moves as Record<string, unknown>);
    if (entries.length > MAX_MOVES) fail(`A plan can hold ${MAX_MOVES} moved transactions at most`);
    for (const [transactionId, to] of entries) moves[id(transactionId, "A moved transaction")] = month(to, "A moved transaction's month");
  }

  return {
    schemaVersion: SCHEMA_VERSION, name: name.slice(0, NAME_MAX), startMonth, months,
    useActuals: value.useActuals !== false,
    openingBalance: value.openingBalance == null ? 0 : amount(value.openingBalance, "The opening balance"),
    accountRoles,
    minimumCash: value.minimumCash == null ? null : amount(value.minimumCash, "The minimum cash"),
    savingsGrowthPct: value.savingsGrowthPct == null ? 0 : percent(value.savingsGrowthPct, "Savings growth"),
    groups, rows, goals, moves,
  };
}

// ─── Export / import ─────────────────────────────────────────────────────────

const FILE_KIND = "actual-bench-cashflow-plan";

/** The plan as a file the user can keep: the document with a marker of what it is. */
export function exportPlanJson(doc: PlanDocument): string {
  return JSON.stringify({ kind: FILE_KIND, exportedAt: new Date().toISOString(), plan: doc }, null, 2);
}

export function importPlanJson(source: string): PlanDocument {
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { return fail("The file is not valid JSON"); }
  if (!isRecord(parsed) || parsed.kind !== FILE_KIND) return fail("This file is not a cashflow plan exported from Actual Bench");
  return parsePlanDocument(parsed.plan);
}

// ─── Editing ─────────────────────────────────────────────────────────────────

export function updateRow(doc: PlanDocument, rowId: string, change: (row: PlanRow) => PlanRow): PlanDocument {
  let changed = false;
  const rows = doc.rows.map((row) => {
    if (row.id !== rowId) return row;
    const next = change(row);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? { ...doc, rows } : doc;
}

/** Sets typed amounts; `null` clears a cell so the month follows the row's forecast again. */
export function setCells(doc: PlanDocument, edits: readonly { rowId: string; month: Month; amount: number | null }[]): PlanDocument {
  const end = planEndMonth(doc);
  const byRow = new Map<string, { month: Month; amount: number | null }[]>();
  for (const edit of edits) {
    if (edit.month < doc.startMonth || edit.month > end) continue;
    const list = byRow.get(edit.rowId);
    if (list) list.push(edit); else byRow.set(edit.rowId, [edit]);
  }
  if (byRow.size === 0) return doc;
  let changed = false;
  const rows = doc.rows.map((row) => {
    const mine = byRow.get(row.id);
    if (!mine) return row;
    const cells = { ...row.cells };
    for (const edit of mine) {
      if (edit.amount === null) { if (edit.month in cells) { delete cells[edit.month]; changed = true; } }
      else if (cells[edit.month] !== edit.amount) { cells[edit.month] = edit.amount; changed = true; }
    }
    return { ...row, cells };
  });
  return changed ? { ...doc, rows } : doc;
}

export function addRow(doc: PlanDocument, row: PlanRow, afterRowId?: string): PlanDocument {
  if (doc.rows.length >= MAX_ROWS) throw new PlanDocumentError(`A plan can hold ${MAX_ROWS} rows`);
  const at = afterRowId ? doc.rows.findIndex((r) => r.id === afterRowId) : -1;
  const rows = at < 0 ? [...doc.rows, row] : [...doc.rows.slice(0, at + 1), row, ...doc.rows.slice(at + 1)];
  return { ...doc, rows };
}

export function removeRow(doc: PlanDocument, rowId: string): PlanDocument {
  return { ...doc, rows: doc.rows.filter((r) => r.id !== rowId) };
}

/** Moves a row one place up or down among the rows it is shown with (same section and group). */
export function moveRow(doc: PlanDocument, rowId: string, direction: -1 | 1): PlanDocument {
  const row = doc.rows.find((r) => r.id === rowId);
  if (!row) return doc;
  const siblings = doc.rows.filter((r) => r.section === row.section && r.groupId === row.groupId);
  const other = siblings[siblings.indexOf(row) + direction];
  if (!other) return doc;
  const rows = [...doc.rows];
  const a = rows.indexOf(row), b = rows.indexOf(other);
  [rows[a], rows[b]] = [rows[b], rows[a]];
  return { ...doc, rows };
}

/** Puts a row in another section or group. Its links, amounts and forecast are kept: amounts are natural, so they read the same. */
export function placeRow(doc: PlanDocument, rowId: string, section: SectionId, groupId: string | null, at: "start" | "end" = "end"): PlanDocument {
  const row = doc.rows.find((r) => r.id === rowId);
  if (!row) return doc;
  const group = groupId ? doc.groups.find((g) => g.id === groupId) : null;
  const moved: PlanRow = { ...row, section: group?.section ?? section, groupId: group ? group.id : null };
  const rest = doc.rows.filter((r) => r !== row);
  // "start" goes before the first row already there; with none there, or at the end, it goes last.
  const first = at === "start" ? rest.findIndex((r) => r.section === moved.section && r.groupId === moved.groupId) : -1;
  return { ...doc, rows: first < 0 ? [...rest, moved] : [...rest.slice(0, first), moved, ...rest.slice(first)] };
}

export function addGroup(doc: PlanDocument, section: SectionId, name: string, afterGroupId?: string): { doc: PlanDocument; groupId: string } {
  if (doc.groups.length >= MAX_GROUPS) throw new PlanDocumentError(`A plan can hold ${MAX_GROUPS} groups`);
  const group: PlanGroup = { id: generateId(), name: name.trim().slice(0, NAME_MAX) || "New group", section };
  const at = afterGroupId ? doc.groups.findIndex((g) => g.id === afterGroupId) : -1;
  const groups = at < 0 ? [...doc.groups, group] : [...doc.groups.slice(0, at + 1), group, ...doc.groups.slice(at + 1)];
  return { doc: { ...doc, groups }, groupId: group.id };
}

/** Gives a group a colour (its rows follow it), or none. */
export function setGroupColor(doc: PlanDocument, groupId: string, color: GroupColor | null): PlanDocument {
  return { ...doc, groups: doc.groups.map((g) => { if (g.id !== groupId) return g; const next = { ...g }; delete next.color; return color ? { ...next, color } : next; }) };
}

export function renameGroup(doc: PlanDocument, groupId: string, name: string): PlanDocument {
  return { ...doc, groups: doc.groups.map((g) => (g.id === groupId ? { ...g, name: name.trim().slice(0, NAME_MAX) || g.name } : g)) };
}

/** Removes a group; its rows stay, directly under the section. */
export function removeGroup(doc: PlanDocument, groupId: string): PlanDocument {
  return { ...doc, groups: doc.groups.filter((g) => g.id !== groupId), rows: doc.rows.map((r) => (r.groupId === groupId ? { ...r, groupId: null } : r)) };
}

export function moveGroup(doc: PlanDocument, groupId: string, direction: -1 | 1): PlanDocument {
  const group = doc.groups.find((g) => g.id === groupId);
  if (!group) return doc;
  const siblings = doc.groups.filter((g) => g.section === group.section);
  const other = siblings[siblings.indexOf(group) + direction];
  if (!other) return doc;
  const groups = [...doc.groups];
  const a = groups.indexOf(group), b = groups.indexOf(other);
  [groups[a], groups[b]] = [groups[b], groups[a]];
  return { ...doc, groups };
}

/**
 * Changes the plan's first month or length. Typed amounts and goals that fall outside the new months are dropped; the
 * caller says how many beforehand (`countOutside`).
 */
export function setHorizon(doc: PlanDocument, startMonth: Month, months: number): PlanDocument {
  const end = planEndMonth({ startMonth, months });
  const rows = doc.rows.map((row) => {
    const kept = Object.entries(row.cells).filter(([m]) => m >= startMonth && m <= end);
    return kept.length === Object.keys(row.cells).length ? row : { ...row, cells: Object.fromEntries(kept) };
  });
  const goals = doc.goals.filter((g) => g.month >= startMonth && g.month <= end);
  return { ...doc, startMonth, months, rows, goals: goals.length === doc.goals.length ? doc.goals : goals };
}

/** How many typed amounts a new first month or length would drop. */
export function countOutside(doc: PlanDocument, startMonth: Month, months: number): number {
  const end = planEndMonth({ startMonth, months });
  return doc.rows.reduce((sum, row) => sum + Object.keys(row.cells).filter((m) => m < startMonth || m > end).length, 0);
}

/** A copy with new ids, so it can be saved next to the original. */
export function duplicateDocument(doc: PlanDocument, name: string): PlanDocument {
  const groupIds = new Map(doc.groups.map((g) => [g.id, generateId()]));
  return {
    ...doc, name: name.trim().slice(0, NAME_MAX) || `${doc.name} copy`.slice(0, NAME_MAX),
    groups: doc.groups.map((g) => ({ ...g, id: groupIds.get(g.id)! })),
    rows: doc.rows.map((r) => ({ ...r, id: generateId(), groupId: r.groupId ? groupIds.get(r.groupId) ?? null : null, rules: r.rules.map((rule) => ({ ...rule, id: generateId() })), cells: { ...r.cells }, links: { categories: [...r.links.categories], categoryGroups: [...r.links.categoryGroups], accounts: r.links.accounts.map((a) => ({ ...a })) } })),
    goals: doc.goals.map((g) => ({ ...g, id: generateId() })),
    accountRoles: { ...doc.accountRoles },
    moves: { ...doc.moves },
  };
}

/** The amount a repeating rule gives in a month, or null when it does not fall in it. */
export function ruleAmount(rule: RepeatRule, month: Month): number | null {
  if (month < rule.start || (rule.end && month > rule.end)) return null;
  const elapsed = monthsBetween(rule.start, month);
  if (elapsed % rule.every !== 0) return null;
  if (!rule.growthPct) return rule.amount;
  return Math.round(rule.amount * Math.pow(1 + rule.growthPct / 100, Math.floor(elapsed / 12)));
}

/** "1,250.50", "-300", "(300)" → minor units; null when it is not an amount. Empty text is not an amount. */
/** An amount as it is shown in an input: thousands separated, two decimals (12,000.00). `parseAmount` reads it back. */
export const formatAmountInput = (minor: number): string => (minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function parseAmount(source: string): number | null {
  let clean = source.trim().replace(/[\s,_']/g, "");
  if (clean === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(clean)) { negative = true; clean = clean.slice(1, -1); }
  if (clean.startsWith("-") || clean.startsWith("−")) { negative = !negative; clean = clean.slice(1); }
  else if (clean.startsWith("+")) clean = clean.slice(1);
  const match = /^(\d*)(?:\.(\d*))?$/.exec(clean);
  if (!match || (match[1] === "" && !match[2])) return null;
  const whole = match[1] || "0";
  const frac = (match[2] ?? "").padEnd(3, "0");
  if (whole.length > 13) return null;
  // Round half up on the third decimal: pasted spreadsheet values often carry more than two.
  const minor = Number(whole) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0);
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT) return null;
  return negative && minor !== 0 ? -minor : minor;
}

/** Counts an Actual transaction in another month (`null` puts it back where its date, or its tag, says). */
export function setMove(doc: PlanDocument, transactionId: string, month: Month | null): PlanDocument {
  const moves = { ...doc.moves };
  if (month === null) { if (!(transactionId in moves)) return doc; delete moves[transactionId]; }
  else {
    if (moves[transactionId] === month) return doc;
    if (!(transactionId in moves) && Object.keys(moves).length >= MAX_MOVES) throw new PlanDocumentError(`A plan can move ${MAX_MOVES} transactions`);
    moves[transactionId] = month;
  }
  return { ...doc, moves };
}

/** Puts a row just before another one, in that row's section and group. */
export function moveRowBefore(doc: PlanDocument, rowId: string, beforeRowId: string, placement: "before" | "after" = "before"): PlanDocument {
  const row = doc.rows.find((r) => r.id === rowId), ref = doc.rows.find((r) => r.id === beforeRowId);
  if (!row || !ref || row === ref) return doc;
  const rest = doc.rows.filter((r) => r !== row);
  const at = rest.indexOf(ref) + (placement === "after" ? 1 : 0);
  return { ...doc, rows: [...rest.slice(0, at), { ...row, section: ref.section, groupId: ref.groupId }, ...rest.slice(at)] };
}
