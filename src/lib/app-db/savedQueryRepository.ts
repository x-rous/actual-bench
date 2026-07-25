import { generateId } from "@/lib/uuid";
import { AppDbValidationError } from "./errors";
import type { SavedQueryRecord, SqliteDatabase } from "./types";

/**
 * Persistence for saved ActualQL queries (RD-064 / PR-029).
 *
 * These are global to the Actual Bench instance — not scoped to any budget — so
 * a query saved while connected to one budget is available from every budget.
 * The table stores only user-authored ActualQL text; there are no secrets or
 * copied budget data here.
 */

type SavedQueryRow = {
  id: string;
  name: string;
  query: string;
  is_favorite: number;
  created_at: string;
  updated_at: string;
};

const NAME_MAX = 200;
const QUERY_MAX = 100_000;

function rowToRecord(row: SavedQueryRow): SavedQueryRecord {
  return {
    id: row.id,
    name: row.name,
    query: row.query,
    isFavorite: row.is_favorite === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError("Saved query name is required");
  }
  const name = value.trim();
  if (name.length > NAME_MAX) {
    throw new AppDbValidationError(`Saved query name must be ${NAME_MAX} characters or fewer`);
  }
  return name;
}

function normalizeQuery(value: unknown, required: boolean): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    throw new AppDbValidationError("Saved query text is required");
  }
  if (value.length > QUERY_MAX) {
    throw new AppDbValidationError(`Saved query text must be ${QUERY_MAX} characters or fewer`);
  }
  return value;
}

function normalizeFavorite(value: unknown, defaultValue?: boolean): boolean | undefined {
  if (value === undefined) return defaultValue;
  if (typeof value !== "boolean") {
    throw new AppDbValidationError("Saved query isFavorite must be true or false");
  }
  return value;
}

export function listSavedQueries(db: SqliteDatabase): SavedQueryRecord[] {
  return db
    .prepare(
      "SELECT * FROM saved_queries ORDER BY is_favorite DESC, updated_at DESC, name COLLATE NOCASE ASC"
    )
    .all<SavedQueryRow>()
    .map(rowToRecord);
}

export function getSavedQuery(db: SqliteDatabase, id: string): SavedQueryRecord | null {
  const row = db.prepare("SELECT * FROM saved_queries WHERE id = ?").get<SavedQueryRow>(id);
  return row ? rowToRecord(row) : null;
}

export function createSavedQuery(db: SqliteDatabase, input: unknown): SavedQueryRecord {
  if (!isRecord(input)) {
    throw new AppDbValidationError("Request body must be an object");
  }
  const name = normalizeName(input.name, true)!;
  const query = normalizeQuery(input.query, true)!;
  const isFavorite = normalizeFavorite(input.isFavorite, false)!;
  const now = new Date().toISOString();
  const id = generateId();

  db.prepare(
    `INSERT INTO saved_queries (id, name, query, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, name, query, isFavorite ? 1 : 0, now, now);

  const created = getSavedQuery(db, id);
  if (!created) throw new AppDbValidationError("Failed to create saved query");
  return created;
}

export function updateSavedQuery(
  db: SqliteDatabase,
  id: string,
  input: unknown
): SavedQueryRecord | null {
  const existing = getSavedQuery(db, id);
  if (!existing) return null;
  if (!isRecord(input)) {
    throw new AppDbValidationError("Request body must be an object");
  }

  const name = normalizeName(input.name, false);
  const query = normalizeQuery(input.query, false);
  const isFavorite = normalizeFavorite(input.isFavorite);
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE saved_queries
     SET name = ?, query = ?, is_favorite = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name ?? existing.name,
    query ?? existing.query,
    (isFavorite === undefined ? existing.isFavorite : isFavorite) ? 1 : 0,
    now,
    id
  );

  return getSavedQuery(db, id);
}

export function deleteSavedQuery(db: SqliteDatabase, id: string): boolean {
  const result = db.prepare("DELETE FROM saved_queries WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * Bulk-insert legacy queries during the one-time localStorage → DB migration.
 * Deduplicates by exact (name, query) against both the incoming batch and the
 * rows already present, so re-running is safe. Returns the number inserted.
 */
export function importSavedQueries(db: SqliteDatabase, input: unknown): { imported: number } {
  if (!isRecord(input) || !Array.isArray(input.queries)) {
    throw new AppDbValidationError("Import body must be { queries: [...] }");
  }

  const existing = listSavedQueries(db);
  const seen = new Set(existing.map((q) => `${q.name}\u0000${q.query}`));

  const insert = db.prepare(
    `INSERT INTO saved_queries (id, name, query, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const items: unknown[] = input.queries;
  let imported = 0;
  const run = db.transaction(() => {
    for (const item of items) {
      if (!isRecord(item)) continue;
      // Skip malformed legacy entries silently — a bad row must not abort import.
      let name: string;
      let query: string;
      try {
        name = normalizeName(item.name, true)!;
        query = normalizeQuery(item.query, true)!;
      } catch {
        continue;
      }
      const key = `${name}\u0000${query}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const isFavorite = item.isFavorite === true;
      const now = new Date().toISOString();
      insert.run(generateId(), name, query, isFavorite ? 1 : 0, now, now);
      imported += 1;
    }
  });

  run();
  return { imported };
}
