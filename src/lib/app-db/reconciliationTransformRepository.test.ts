import Database from "better-sqlite3";
import { runMigrations } from "./migrations";
import {
  createSavedTransform,
  deleteSavedTransform,
  listSavedTransforms,
  reorderSavedTransforms,
  updateSavedTransform,
} from "./reconciliationTransformRepository";
import type { SqliteDatabase } from "./types";

function withDb(run: (db: SqliteDatabase) => void) {
  const db = new Database(":memory:") as unknown as SqliteDatabase;
  try {
    runMigrations(db);
    run(db);
  } finally {
    (db as unknown as { close: () => void }).close();
  }
}

const apiToMonth = {
  conditions: [{ field: "notes", operator: "hasTag", value: "#API" }],
  actions: [{ kind: "replaceTag", from: "#API", to: "#{month}" }],
};
const fullPayee = { conditions: [], actions: [{ kind: "useStatementImportedPayee" }] };

describe("saved reconciliation transforms", () => {
  it("saves, lists in run order, and keeps each budget's transforms apart", () => {
    withDb((db) => {
      createSavedTransform(db, { budgetSyncId: "b1", name: "API to month", rule: apiToMonth });
      createSavedTransform(db, { budgetSyncId: "b1", name: "Full payee", rule: fullPayee });
      createSavedTransform(db, { budgetSyncId: "b2", name: "Other budget", rule: fullPayee });

      const list = listSavedTransforms(db, "b1");
      expect(list.map((entry) => entry.name)).toEqual(["API to month", "Full payee"]);
      expect(list[0].rule).toEqual(apiToMonth);
      expect(listSavedTransforms(db, "b2")).toHaveLength(1);
    });
  });

  it("refuses a duplicate name and a rule it cannot read", () => {
    withDb((db) => {
      createSavedTransform(db, { budgetSyncId: "b1", name: "Full payee", rule: fullPayee });
      expect(() => createSavedTransform(db, { budgetSyncId: "b1", name: "full payee", rule: fullPayee }))
        .toThrow(/already exists/);
      expect(() => createSavedTransform(db, {
        budgetSyncId: "b1", name: "Bad", rule: { conditions: [], actions: [{ kind: "deleteEverything" }] },
      })).toThrow(/invalid/);
    });
  });

  it("renames, replaces the rule, reorders and deletes", () => {
    withDb((db) => {
      const first = createSavedTransform(db, { budgetSyncId: "b1", name: "API to month", rule: apiToMonth });
      const second = createSavedTransform(db, { budgetSyncId: "b1", name: "Full payee", rule: fullPayee });

      const renamed = updateSavedTransform(db, { budgetSyncId: "b1", id: first.id, name: "Monthly tag", rule: fullPayee });
      expect(renamed).toMatchObject({ name: "Monthly tag", rule: fullPayee });
      expect(updateSavedTransform(db, { budgetSyncId: "b2", id: first.id, name: "x" })).toBeNull();

      expect(reorderSavedTransforms(db, { budgetSyncId: "b1", ids: [second.id] }).map((entry) => entry.id))
        .toEqual([second.id, first.id]);

      expect(deleteSavedTransform(db, "b2", first.id)).toBe(false);
      expect(deleteSavedTransform(db, "b1", first.id)).toBe(true);
      expect(listSavedTransforms(db, "b1").map((entry) => entry.id)).toEqual([second.id]);
    });
  });

  it("skips a stored rule this build does not understand instead of failing the list", () => {
    withDb((db) => {
      createSavedTransform(db, { budgetSyncId: "b1", name: "Full payee", rule: fullPayee });
      db.prepare(
        `INSERT INTO reconciliation_transforms (id, budget_sync_id, name, rule_json, position, created_at, updated_at)
         VALUES ('future', 'b1', 'Future', '{"conditions":[],"actions":[{"kind":"newKind"}]}', 5, 't', 't')`
      ).run();
      expect(listSavedTransforms(db, "b1").map((entry) => entry.name)).toEqual(["Full payee"]);
    });
  });
});
