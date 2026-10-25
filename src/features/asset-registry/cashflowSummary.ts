import type { CapitalMovement } from "@/lib/asset-registry/capitalMovements";
import { CASHFLOW_GROUPS, CASHFLOW_TYPES, type CashflowType } from "@/lib/asset-registry/models";
import { EXPENSE_TYPES, INCOME_TYPES, type OperatingEntry } from "./timeline";

export type YearRow = { key: string; label: string; byYear: number[]; total: number };
export type YearGroup = { label: string; kind: "income" | "expenses" | "capital"; rows: YearRow[]; byYear: number[]; total: number };
const CAPITAL_ROWS: { kind: CapitalMovement["kind"]; label: string }[] = [
  { kind: "investment", label: "Acquisition payments" }, { kind: "capex", label: "Capital expenditure" }, { kind: "disposal", label: "Disposal proceeds, net of selling costs" },
];

/**
 * Linked cashflows by calendar year for the last `count` years ending `endYear`. Income and expenses are the operating
 * result's inputs; capital movements (real money only, selling costs already netted out of disposals) are listed apart.
 */
export function cashflowByYear(operating: OperatingEntry[], capital: CapitalMovement[], endYear: number, count = 5) {
  const years = Array.from({ length: count }, (_, i) => endYear - count + 1 + i);
  const sumBy = <T extends { date: string }>(items: T[], pick: (item: T) => number) => years.map((y) => items.filter((e) => Number(e.date.slice(0, 4)) === y).reduce((s, e) => s + pick(e), 0));
  const total = (byYear: number[]) => byYear.reduce((a, b) => a + b, 0);
  const typeRow = (type: CashflowType, sign: 1 | -1): YearRow | null => {
    const items = operating.filter((e) => e.type === type && Math.sign(e.amountMinor) === sign);
    if (!items.some((e) => years.includes(Number(e.date.slice(0, 4))))) return null;
    const byYear = sumBy(items, (e) => e.amountMinor); return { key: type, label: CASHFLOW_TYPES[type], byYear, total: total(byYear) };
  };
  const group = (index: number, kind: YearGroup["kind"], types: CashflowType[], sign: 1 | -1): YearGroup | null => {
    const rows = types.map((t) => typeRow(t, sign)).filter((r): r is YearRow => !!r);
    if (!rows.length) return null;
    const byYear = years.map((_, i) => rows.reduce((s, r) => s + r.byYear[i], 0));
    return { label: CASHFLOW_GROUPS[index].label.split(" · ")[0], kind, rows, byYear, total: total(byYear) };
  };
  const capitalRows = CAPITAL_ROWS.map(({ kind, label }): YearRow | null => {
    const items = capital.filter((m) => m.kind === kind);
    if (!items.some((m) => years.includes(Number(m.date.slice(0, 4))))) return null;
    const byYear = sumBy(items, (m) => m.amountMinor); return { key: kind, label, byYear, total: total(byYear) };
  }).filter((r): r is YearRow => !!r);
  const groups: YearGroup[] = [group(0, "income", INCOME_TYPES, 1), group(1, "expenses", EXPENSE_TYPES, -1),
    capitalRows.length ? { label: "Capital & disposal", kind: "capital" as const, rows: capitalRows, byYear: years.map((_, i) => capitalRows.reduce((s, r) => s + r.byYear[i], 0)), total: total(capitalRows.reduce((acc, r) => acc.map((v, i) => v + r.byYear[i]), years.map(() => 0))) } : null].filter((g): g is YearGroup => !!g);
  const operatingByYear = years.map((_, i) => groups.filter((g) => g.kind !== "capital").reduce((s, g) => s + g.byYear[i], 0));
  return { years, groups, operating: operatingByYear, operatingTotal: total(operatingByYear) };
}
