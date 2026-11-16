import type { Placed } from "./actuals";
import type { Computed } from "./engine";
import type { PlanDocument, PlanRow } from "./types";

/**
 * What a row's links that an earlier row already holds mean for it. Recorded history of a category, group or account goes to the
 * first row that follows it, so a later row's link has no effect on past months; the later row can still use it for its forecast.
 * That is only a problem when something is counted twice or when the row has nothing to work from, so the rest is a quiet note.
 */
export type LinkNote = {
  /** `warning`: a figure is likely wrong. `note`: nothing is counted twice, it is only worth knowing. */
  severity: "warning" | "note";
  /** One line, for a tooltip and the list of things to look at. */
  summary: string;
  items: { kind: "category" | "group" | "account"; name: string; heldBy: { id: string; name: string } }[];
  /** Why it is a warning, when it is. */
  reason?: string;
};

/** The forecast months in which the row expects anything, from the plan as calculated. Two rows count a link twice only in a month both have. */
function forecastMonths(computed: Computed, row: PlanRow): Set<number> {
  const plan = computed.rows.get(row.id)?.plan;
  const months = new Set<number>();
  if (plan) computed.kinds.forEach((kind, i) => { if (kind === "forecast" && plan[i]) months.add(i); });
  return months;
}

export function linkNotes(doc: PlanDocument, computed: Computed, placed: Placed | null): Map<string, LinkNote> {
  const notes = new Map<string, LinkNote>();
  if (!placed) return notes;
  const byId = new Map(doc.rows.map((r) => [r.id, r]));
  for (const conflict of placed.conflicts) {
    const holder = byId.get(conflict.heldBy);
    const note = notes.get(conflict.rowId) ?? { severity: "note" as const, summary: "", items: [] };
    note.items.push({ kind: conflict.kind, name: conflict.name, heldBy: { id: conflict.heldBy, name: holder?.name ?? "another row" } });
    notes.set(conflict.rowId, note);
  }
  for (const [rowId, note] of notes) {
    const row = byId.get(rowId);
    const holders = note.items.map((i) => byId.get(i.heldBy.id)).filter((r): r is PlanRow => !!r);
    if (row?.basis.kind === "average") note.reason = "The earlier row holds their recorded history, so this row has none to average.";
    else if (row && (() => { const mine = forecastMonths(computed, row); return holders.some((h) => [...forecastMonths(computed, h)].some((i) => mine.has(i))); })()) note.reason = "Both rows forecast them, so they are counted twice.";
    if (note.reason) note.severity = "warning";
    const first = note.items[0];
    const base = note.items.length === 1
      ? `${first.name} is also followed by “${first.heldBy.name}”, which comes first`
      : `${note.items.length} links are also followed by rows that come first`;
    note.summary = note.reason ? `${base}. ${note.reason}` : base;
  }
  return notes;
}
