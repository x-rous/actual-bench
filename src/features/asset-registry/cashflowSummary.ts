import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import type { OperatingEntry } from "./timeline";

/** One period of the table: the same ones as the Performance breakdown, `from` and `to` inclusive. */
export type PeriodColumn = { key: string; from: string; to: string };
export type PeriodRow = { key: string; label: string; values: number[] };
export type PeriodGroup = { label: string; kind: "income" | "expenses" | "capital"; rows: PeriodRow[]; values: number[] };
const CAPITAL_ROWS: { kind: CapitalMovement["kind"]; label: string }[] = [
  { kind: "investment", label: "Purchases and payments" }, { kind: "disposal", label: "Disposal proceeds, net of selling costs" },
];
const UNCATEGORIZED = "Uncategorized";

/**
 * Linked cashflows by Actual category for each period. Income and expenses follow Actual's category type (an income
 * category's refund nets into it) and are the operating result's inputs; capital movements (real money only, selling costs
 * already netted out of disposals) are listed apart and never enter the operating result.
 */
export function cashflowByPeriod(operating: OperatingEntry[], capital: CapitalMovement[], columns: PeriodColumn[]) {
  const sum = <T extends { date: string }>(items: T[], pick: (item: T) => number) => columns.map((c) => items.filter((e) => e.date >= c.from && e.date <= c.to).reduce((s, e) => s + pick(e), 0));
  const row = <T extends { date: string }>(key: string, label: string, items: T[], pick: (item: T) => number): PeriodRow => ({ key, label, values: sum(items, pick) });
  const categoryRows = (income: boolean): PeriodRow[] => {
    const items = operating.filter((e) => e.income === income);
    return [...new Set(items.map((e) => e.category || UNCATEGORIZED))].sort((a, b) => a.localeCompare(b))
      .map((category) => row(category, category, items.filter((e) => (e.category || UNCATEGORIZED) === category), (e) => e.amountMinor));
  };
  const combine = (label: string, kind: PeriodGroup["kind"], rows: PeriodRow[]): PeriodGroup | null => rows.length ? { label, kind, rows, values: columns.map((_, i) => rows.reduce((s, r) => s + r.values[i], 0)) } : null;
  const capitalRows = CAPITAL_ROWS.map(({ kind, label }) => { const items = capital.filter((m) => m.kind === kind); return items.length ? row(kind, label, items, (m) => m.amountMinor) : null; }).filter((r): r is PeriodRow => !!r);
  const groups = [combine("Income", "income", categoryRows(true)), combine("Expenses", "expenses", categoryRows(false)), combine("Capital & disposal", "capital", capitalRows)].filter((g): g is PeriodGroup => !!g);
  const operatingGroups = groups.filter((g) => g.kind !== "capital");
  return { groups, operating: columns.map((_, i) => operatingGroups.reduce((s, g) => s + g.values[i], 0)) };
}
