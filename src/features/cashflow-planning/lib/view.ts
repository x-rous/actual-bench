import { formatAmount } from "@/features/assets-debt/lib/money";
import type { Computed, RowResult } from "@/lib/cashflow-planning/engine";
import { yearOf } from "@/lib/cashflow-planning/months";
import { SECTIONS, SECTION_LABEL, type Month, type PlanDocument, type PlanGroup, type PlanRow, type SectionId } from "@/lib/cashflow-planning/types";

/** The twelve months before the current one: the window of the overview's "Not in plan" figures. None when today is outside the plan. */
export function lastTwelveMonths(computed: Pick<Computed, "months" | "currentIndex">): Month[] {
  return computed.currentIndex < 0 ? [] : computed.months.slice(Math.max(0, computed.currentIndex - 12), computed.currentIndex);
}

/** What the grid draws: its columns (months and year totals) and its lines, from a plan and its calculation. Pure. */

export type Column =
  | { kind: "month"; key: string; index: number; month: Month }
  /** A calendar year of the plan: the months it covers, summed (or the balance at its end). */
  | { kind: "year"; key: string; year: number; indexes: number[]; partial: boolean };

/** Month columns of the plan years in the window, each calendar year followed by its total; or one column per year. */
export function buildColumns(months: readonly Month[], view: { mode: "months" | "years"; fromYear: number; span: number; /** Whether each calendar year in the months view is followed by its total (the years view is all totals). Default true. */ totals?: boolean }): Column[] {
  const byYear = new Map<number, number[]>();
  months.forEach((month, index) => byYear.set(yearOf(month), [...(byYear.get(yearOf(month)) ?? []), index]));
  const columns: Column[] = [];
  for (const [year, indexes] of byYear) {
    const total: Column = { kind: "year", key: `y${year}`, year, indexes, partial: indexes.length < 12 };
    if (view.mode === "years") { columns.push(total); continue; }
    if (year < view.fromYear || year >= view.fromYear + view.span) continue;
    for (const index of indexes) columns.push({ kind: "month", key: months[index], index, month: months[index] });
    if (view.totals !== false) columns.push(total);
  }
  return columns;
}

export const planYears = (months: readonly Month[]): number[] => [...new Set(months.map(yearOf))];

/** How a line adds up over a year: flows are summed, balances are read at the year's first or last month. */
export type Aggregate = "sum" | "first" | "last";

export type Line =
  | { kind: "balance"; key: "opening" | "closing"; label: string; values: number[]; aggregate: Aggregate }
  | { kind: "section"; key: string; section: SectionId; label: string; values: number[]; aggregate: "sum"; collapsed: boolean }
  | { kind: "group"; key: string; group: PlanGroup; values: number[]; aggregate: "sum"; collapsed: boolean; count: number }
  | { kind: "row"; key: string; row: PlanRow; result: RowResult; aggregate: "sum"; depth: 1 | 2 }
  | { kind: "unplanned"; key: string; section: SectionId; label: string; values: number[]; aggregate: "sum" }
  | { kind: "memo"; key: "inTransit" | "moved" | "starting" | "net" | "savings" | "locked" | "total"; label: string; values: number[]; aggregate: Aggregate; hint?: string };

export const lineKey = {
  section: (section: SectionId) => `section:${section}`,
  group: (id: string) => `group:${id}`,
  row: (id: string) => `row:${id}`,
  unplanned: (section: SectionId) => `unplanned:${section}`,
};

/** The lines pinned at the bottom of the grid, in order: net cashflow, the closing balance and, when there are savings accounts, the savings balance and cash plus savings. They are what the rest adds up to. */
/** The width of the name column in the grid, and of the first key figure above it. */
export const LABEL_WIDTH = 259;

export const isPinned = (line: Line): boolean => (line.kind === "memo" && (line.key === "net" || line.key === "savings" || line.key === "locked" || line.key === "total")) || (line.kind === "balance" && line.key === "closing");

/** `find` keeps only the rows whose name contains it (with their groups and sections), whatever is collapsed. */
export function buildLines(doc: PlanDocument, computed: Computed, collapsed: ReadonlySet<string>, find = ""): Line[] {
  const lines: Line[] = [{ kind: "balance", key: "opening", label: "Opening balance", values: computed.opening, aggregate: "first" }];
  const nonZero = (values: readonly number[]) => values.some((v) => v !== 0);
  const needle = find.trim().toLowerCase();
  const matches = (name: string) => !needle || name.toLowerCase().includes(needle);
  for (const section of SECTIONS) {
    const rows = doc.rows.filter((r) => r.section === section && (matches(r.name) || (r.groupId !== null && matches(doc.groups.find((g) => g.id === r.groupId)?.name ?? ""))));
    const groups = doc.groups.filter((g) => g.section === section && (!needle || rows.some((r) => r.groupId === g.id)));
    const hasUnplanned = !needle && nonZero(computed.unplanned[section]);
    // Savings and debt only appear once the plan or Actual has something for them; income and expenses always do.
    if ((section === "savings" || section === "debt" || needle) && rows.length === 0 && groups.length === 0 && !hasUnplanned) continue;
    const sectionKey = lineKey.section(section);
    const sectionCollapsed = !needle && collapsed.has(sectionKey);
    lines.push({ kind: "section", key: sectionKey, section, label: SECTION_LABEL[section], values: computed.sectionTotals[section], aggregate: "sum", collapsed: sectionCollapsed });
    if (sectionCollapsed) continue;
    for (const group of groups) {
      const members = rows.filter((r) => r.groupId === group.id);
      const groupKey = lineKey.group(group.id);
      const groupCollapsed = !needle && collapsed.has(groupKey);
      lines.push({ kind: "group", key: groupKey, group, values: computed.groupTotals.get(group.id)!, aggregate: "sum", collapsed: groupCollapsed, count: members.length });
      if (!groupCollapsed) for (const row of members) lines.push({ kind: "row", key: lineKey.row(row.id), row, result: computed.rows.get(row.id)!, aggregate: "sum", depth: 2 });
    }
    for (const row of rows.filter((r) => !r.groupId)) lines.push({ kind: "row", key: lineKey.row(row.id), row, result: computed.rows.get(row.id)!, aggregate: "sum", depth: 1 });
    if (hasUnplanned) lines.push({ kind: "unplanned", key: lineKey.unplanned(section), section, label: "Not in plan", values: computed.unplanned[section], aggregate: "sum" });
  }
  if (nonZero(computed.inTransit)) lines.push({ kind: "memo", key: "inTransit", label: "Transfers in transit", values: computed.inTransit, aggregate: "sum", hint: "Transfers between the plan's cash accounts whose two sides fall in different months. They cancel out over time." });
  if (nonZero(computed.moved)) lines.push({ kind: "memo", key: "moved", label: "Moved between months", values: computed.moved, aggregate: "sum", hint: "Transactions counted in another month than their date (a #YYYY-MM tag in the note, or moved in this plan). This line puts the amount back in the month the money really moved, so the balances stay the real ones." });
  if (nonZero(computed.startingBalances)) lines.push({ kind: "memo", key: "starting", label: "Starting balances added", values: computed.startingBalances, aggregate: "sum", hint: "Starting balances recorded in Actual in these months: an account that joined the plan's cash. Not income." });
  // The pinned lines, at the bottom of the grid.
  lines.push({ kind: "memo", key: "net", label: "Net cashflow", values: computed.net, aggregate: "sum" });
  lines.push({ kind: "balance", key: "closing", label: "Closing balance", values: computed.closing, aggregate: "last" });
  // With savings accounts, the savings balance and cash plus savings close the pinned block, as a small sum under the closing balance.
  if (computed.savings) {
    const all = computed.savings, locked = computed.lockedSavings;
    const hint = "The balance of the plan's savings accounts in Actual, then what the plan puts aside each month, with the yearly growth set in Plan settings. Market changes are not forecast.";
    if (locked) {
      // Split by access: what could be used now, and what is locked (a term deposit, a pension), as the Accounts page sets it.
      lines.push({ kind: "memo", key: "savings", label: "Savings you can use (estimate)", values: all.map((v, i) => v - locked[i]), aggregate: "last", hint: `${hint} Savings accounts marked Available now in Accounts.` });
      lines.push({ kind: "memo", key: "locked", label: "Locked savings (estimate)", values: locked, aggregate: "last", hint: `${hint} Savings, investments and retirement accounts you cannot use now, and the savings rows that only put money into them.` });
    } else {
      lines.push({ kind: "memo", key: "savings", label: "Savings (estimate)", values: all, aggregate: "last", hint });
    }
    lines.push({ kind: "memo", key: "total", label: "Cash + savings", values: computed.closing.map((v, i) => v + all[i]), aggregate: "last" });
  }
  return lines;
}

export function aggregate(values: readonly number[], indexes: readonly number[], how: Aggregate): number {
  if (how === "first") return values[indexes[0]];
  if (how === "last") return values[indexes[indexes.length - 1]];
  let sum = 0;
  for (const i of indexes) sum += values[i];
  return sum;
}

/** Amounts in the grid: whole units unless cents are asked for. Integer minor units in, text out. */
export function formatCell(minor: number, cents: boolean): string {
  if (cents) return formatAmount(minor, 2);
  const rounded = Math.round(minor / 100);
  return formatAmount(rounded === 0 ? 0 : rounded, 0);
}
