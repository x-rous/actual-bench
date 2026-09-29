import { generateId } from "@/lib/uuid";
import type { SqliteDatabase } from "./types";

/**
 * Replace a debt's child rows as one set (RD-084 P1.3).
 *
 * The editor saves the whole list. A row that keeps its id is updated in
 * place and keeps its `created_at`; a row with no id (or an id this debt does
 * not own) is inserted; a stored row missing from the list is deleted. Runs
 * inside the caller's transaction.
 */
export function replaceChildRows<T extends { id?: string | null }>(
  db: SqliteDatabase,
  table: "debt_rate_periods" | "debt_offset_links" | "debt_future_assumptions",
  debtId: string,
  rows: readonly T[],
  write: { insert: (id: string, row: T) => void; update: (id: string, row: T) => void }
): void {
  const existing = new Set(
    db.prepare(`SELECT id FROM ${table} WHERE debt_id = ?`).all<{ id: string }>(debtId).map((r) => r.id)
  );
  const kept = new Set<string>();
  // Delete first, so an update that takes over a removed row's unique date does not collide.
  const incoming = new Set(rows.map((r) => r.id).filter((id): id is string => !!id && existing.has(id)));
  for (const id of existing) if (!incoming.has(id)) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
  for (const row of rows) {
    if (row.id && existing.has(row.id) && !kept.has(row.id)) {
      kept.add(row.id);
      write.update(row.id, row);
    } else {
      write.insert(generateId(), row);
    }
  }
}
