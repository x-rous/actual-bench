import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  createSavedQuery,
  deleteSavedQuery,
  getSavedQuery,
  importSavedQueries,
  listSavedQueries,
  updateSavedQuery,
} from "./savedQueryRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-saved-query-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

describe("saved query repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates, lists, updates, and deletes saved queries", () => {
    const db = tempDb();

    const created = createSavedQuery(db, {
      name: "Uncategorized",
      query: '{"table":"transactions"}',
    });
    expect(created.id).toBeTruthy();
    expect(created.isFavorite).toBe(false);
    expect(created.createdAt).toBe(created.updatedAt);

    expect(listSavedQueries(db)).toHaveLength(1);

    const updated = updateSavedQuery(db, created.id, { name: "All txns", isFavorite: true });
    expect(updated?.name).toBe("All txns");
    expect(updated?.isFavorite).toBe(true);
    expect(updated?.query).toBe('{"table":"transactions"}'); // unchanged fields preserved

    expect(deleteSavedQuery(db, created.id)).toBe(true);
    expect(deleteSavedQuery(db, created.id)).toBe(false);
    expect(listSavedQueries(db)).toHaveLength(0);
  });

  it("is global — a single list is shared regardless of budget", () => {
    const db = tempDb();
    createSavedQuery(db, { name: "A", query: '{"table":"payees"}' });
    createSavedQuery(db, { name: "B", query: '{"table":"accounts"}' });
    // No budget parameter exists anywhere in the API — the list is instance-wide.
    expect(listSavedQueries(db).map((q) => q.name).sort()).toEqual(["A", "B"]);
  });

  it("orders favorites first", () => {
    const db = tempDb();
    createSavedQuery(db, { name: "plain", query: "{}" });
    const fav = createSavedQuery(db, { name: "starred", query: "{}", isFavorite: true });
    expect(listSavedQueries(db)[0].id).toBe(fav.id);
  });

  it("rejects empty names and empty queries", () => {
    const db = tempDb();
    expect(() => createSavedQuery(db, { name: "  ", query: "{}" })).toThrow(AppDbValidationError);
    expect(() => createSavedQuery(db, { name: "ok", query: "" })).toThrow(AppDbValidationError);
  });

  it("returns null when updating a missing query", () => {
    const db = tempDb();
    expect(updateSavedQuery(db, "does-not-exist", { name: "x" })).toBeNull();
  });

  it("imports legacy queries, deduping by name+query and skipping malformed rows", () => {
    const db = tempDb();
    createSavedQuery(db, { name: "Existing", query: "{}" });

    const result = importSavedQueries(db, {
      queries: [
        { name: "Existing", query: "{}" }, // dup of existing → skip
        { name: "New one", query: '{"table":"rules"}', isFavorite: true },
        { name: "New one", query: '{"table":"rules"}' }, // dup within batch → skip
        { name: "", query: "{}" }, // malformed → skip
        { totally: "wrong" }, // malformed → skip
      ],
    });

    expect(result.imported).toBe(1);
    const names = listSavedQueries(db).map((q) => q.name).sort();
    expect(names).toEqual(["Existing", "New one"]);
    expect(getSavedQuery(db, listSavedQueries(db).find((q) => q.name === "New one")!.id)?.isFavorite).toBe(true);
  });
});
