import { contributionsOf, unplannedTarget, type Contribution, type Placed, type Snapshot } from "@/lib/cashflow-planning/actuals";
import { monthLabel } from "@/lib/cashflow-planning/months";
import { SECTION_LABEL, type Month, type PlanDocument } from "@/lib/cashflow-planning/types";
import type { Line } from "./view";

/** What the transactions list shows: the figure of a row, group, section or "Not in plan" line, or one of the two lines made of transactions only. */
export type TransactionsRequest = {
  title: string;
  /** The row ids and "Not in plan" targets whose figures are listed together. */
  targets: string[];
  months: Month[];
  items: Pick<Contribution, "kind" | "id">[];
  /** Natural-sign multiplier for display. */
  sign: 1 | -1;
  /** "transit": transfers between the plan's cash accounts. "moved": transactions counted in another month than their date. */
  mode?: "transit" | "moved";
};

/** The targets a line's figure is made of: a row, a group's rows, a section's rows and its "Not in plan" part. */
export function targetsOf(doc: PlanDocument, line: Line): string[] {
  switch (line.kind) {
    case "row": return [line.row.id];
    case "unplanned": return [unplannedTarget(line.section)];
    case "group": return doc.rows.filter((r) => r.groupId === line.group.id).map((r) => r.id);
    case "section": return [...doc.rows.filter((r) => r.section === line.section).map((r) => r.id), unplannedTarget(line.section)];
    default: return [];
  }
}

/** The pieces of several targets together, the same kind and id added up. */
export function piecesOf(placed: Placed, snapshot: Snapshot, targets: readonly string[], months: ReadonlySet<Month>) {
  const merged = new Map<string, ReturnType<typeof contributionsOf>[number]>();
  for (const target of targets) {
    for (const piece of contributionsOf(placed, snapshot, target, months)) {
      const key = `${piece.kind}:${piece.id}`, entry = merged.get(key);
      if (entry) entry.amount += piece.amount; else merged.set(key, { ...piece });
    }
  }
  return [...merged.values()].filter((p) => p.amount !== 0).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

/** The request for a line over some months, or null when the line has no transactions behind it there. */
export function requestFor(doc: PlanDocument, snapshot: Snapshot | null, placed: Placed | null, line: Line, months: Month[], label: string): TransactionsRequest | null {
  if (!snapshot || !placed || !doc.useActuals || months.length === 0) return null;
  if (line.kind === "memo") {
    if (line.key === "inTransit") return months.some((m) => placed.inTransit.get(m)) ? { title: `${line.label}, ${label}`, targets: [], months, items: [], sign: 1, mode: "transit" } : null;
    if (line.key === "moved") return months.some((m) => [...placed.shifted.values()].some((s) => s.from === m || s.to === m)) ? { title: `${line.label}, ${label}`, targets: [], months, items: [], sign: 1, mode: "moved" } : null;
    return null;
  }
  const section = line.kind === "row" ? line.row.section : line.kind === "group" ? line.group.section : line.kind === "section" || line.kind === "unplanned" ? line.section : null;
  if (!section) return null;
  const targets = targetsOf(doc, line);
  const items = piecesOf(placed, snapshot, targets, new Set(months));
  if (items.length === 0) return null;
  const name = line.kind === "row" ? line.row.name : line.kind === "group" ? line.group.name : line.kind === "section" ? SECTION_LABEL[section] : `Not in plan (${SECTION_LABEL[section]})`;
  return { title: `${name}, ${label}`, targets, months, items, sign: section === "income" ? 1 : -1 };
}

export const monthsLabel = (months: Month[]) => (months.length === 1 ? monthLabel(months[0]) : `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}`);
