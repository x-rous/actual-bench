import { formatAmount } from "@/features/assets-debt/lib/money";
import type { Computed, RowResult } from "@/lib/cashflow-planning/engine";
import { yearOf } from "@/lib/cashflow-planning/months";
import { SECTIONS, SECTION_LABEL, type Month, type PlanDocument, type PlanGroup, type PlanRow, type SectionId } from "@/lib/cashflow-planning/types";

/** What the grid draws: its columns (months and year totals) and its lines, from a plan and its calculation. Pure. */

export type Column =
  | { kind: "month"; key: string; index: number; month: Month }
  /** A calendar year of the plan: the months it covers, summed (or the balance at its end). */
  | { kind: "year"; key: string; year: number; indexes: number[]; partial: boolean };

/** Month columns of the plan years in the window, each calendar year followed by its total; or one column per year. */
export function buildColumns(months: readonly Month[], view: { mode: "months" | "years"; fromYear: number; span: number }): Column[] {
  const byYear = new Map<number, number[]>();
  months.forEach((month, index) => byYear.set(yearOf(month), [...(byYear.get(yearOf(month)) ?? []), index]));
  const columns: Column[] = [];
  for (const [year, indexes] of byYear) {
    const total: Column = { kind: "year", key: `y${year}`, year, indexes, partial: indexes.length < 12 };
    if (view.mode === "years") { columns.push(total); continue; }
    if (year < view.fromYear || year >= view.fromYear + view.span) continue;
    for (const index of indexes) columns.push({ kind: "month", key: months[index], index, month: months[index] });
    columns.push(total);
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
  | { kind: "memo"; key: "inTransit" | "starting" | "net" | "savings" | "total"; label: string; values: number[]; aggregate: Aggregate; hint?: string };

export const lineKey = {
  section: (section: SectionId) => `section:${section}`,
  group: (id: string) => `group:${id}`,
  row: (id: string) => `row:${id}`,
  unplanned: (section: SectionId) => `unplanned:${section}`,
};

export function buildLines(doc: PlanDocument, computed: Computed, collapsed: ReadonlySet<string>): Line[] {
  const lines: Line[] = [{ kind: "balance", key: "opening", label: "Opening balance", values: computed.opening, aggregate: "first" }];
  const nonZero = (values: readonly number[]) => values.some((v) => v !== 0);
  for (const section of SECTIONS) {
    const rows = doc.rows.filter((r) => r.section === section);
    const groups = doc.groups.filter((g) => g.section === section);
    const hasUnplanned = nonZero(computed.unplanned[section]);
    // Savings and debt only appear once the plan or Actual has something for them; income and expenses always do.
    if ((section === "savings" || section === "debt") && rows.length === 0 && groups.length === 0 && !hasUnplanned) continue;
    const sectionKey = lineKey.section(section);
    const sectionCollapsed = collapsed.has(sectionKey);
    lines.push({ kind: "section", key: sectionKey, section, label: SECTION_LABEL[section], values: computed.sectionTotals[section], aggregate: "sum", collapsed: sectionCollapsed });
    if (sectionCollapsed) continue;
    for (const group of groups) {
      const members = rows.filter((r) => r.groupId === group.id);
      const groupKey = lineKey.group(group.id);
      const groupCollapsed = collapsed.has(groupKey);
      lines.push({ kind: "group", key: groupKey, group, values: computed.groupTotals.get(group.id)!, aggregate: "sum", collapsed: groupCollapsed, count: members.length });
      if (!groupCollapsed) for (const row of members) lines.push({ kind: "row", key: lineKey.row(row.id), row, result: computed.rows.get(row.id)!, aggregate: "sum", depth: 2 });
    }
    for (const row of rows.filter((r) => !r.groupId)) lines.push({ kind: "row", key: lineKey.row(row.id), row, result: computed.rows.get(row.id)!, aggregate: "sum", depth: 1 });
    if (hasUnplanned) lines.push({ kind: "unplanned", key: lineKey.unplanned(section), section, label: "Not in plan", values: computed.unplanned[section], aggregate: "sum" });
  }
  if (nonZero(computed.inTransit)) lines.push({ kind: "memo", key: "inTransit", label: "Transfers in transit", values: computed.inTransit, aggregate: "sum", hint: "Transfers between the plan's cash accounts whose two sides fall in different months. They cancel out over time." });
  lines.push({ kind: "memo", key: "net", label: "Net cashflow", values: computed.net, aggregate: "sum" });
  if (nonZero(computed.startingBalances)) lines.push({ kind: "memo", key: "starting", label: "Starting balances added", values: computed.startingBalances, aggregate: "sum", hint: "Starting balances recorded in Actual in these months: an account that joined the plan's cash. Not income." });
  lines.push({ kind: "balance", key: "closing", label: "Closing balance", values: computed.closing, aggregate: "last" });
  if (computed.savings) {
    lines.push({ kind: "memo", key: "savings", label: "Savings (estimate)", values: computed.savings, aggregate: "last", hint: "The balance of the plan's savings accounts in Actual, then what the plan puts aside each month, with the yearly growth set in Plan settings. Market changes are not forecast." });
    lines.push({ kind: "memo", key: "total", label: "Cash + savings", values: computed.closing.map((v, i) => v + computed.savings![i]), aggregate: "last" });
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
