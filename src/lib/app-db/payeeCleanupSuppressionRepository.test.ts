import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  clearPayeeCleanupSuppressions,
  createPayeeCleanupSuppression,
  deletePayeeCleanupSuppression,
  listPayeeCleanupSuppressions,
} from "./payeeCleanupSuppressionRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-payee-suppression-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

const base = {
  budgetSyncId: "budget-1",
  kind: "not-duplicates" as const,
  payeeIds: ["p1", "p2"],
  normalizedNames: ["EMIRATES", "EMIRATES NBD"],
  detectorIds: ["fuzzy-similarity"],
};

describe("payee cleanup suppression repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates and lists suppressions for a budget", () => {
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, base);

    expect(created.id).toBeTruthy();
    expect(created.payeeIds).toEqual(["p1", "p2"]);
    expect(created.normalizedNames).toEqual(["EMIRATES", "EMIRATES NBD"]);

    expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(1);
  });

  it("scopes decisions to one budget", () => {
    // Payee ids and names belong to a budget file. A decision about the
    // household budget must not silence a suggestion in the business one.
    const db = tempDb();
    createPayeeCleanupSuppression(db, base);
    createPayeeCleanupSuppression(db, { ...base, budgetSyncId: "budget-2" });

    expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(1);
    expect(listPayeeCleanupSuppressions(db, "budget-2")).toHaveLength(1);
    expect(listPayeeCleanupSuppressions(db, "budget-3")).toHaveLength(0);
  });

  it("requires a budget", () => {
    const db = tempDb();
    expect(() =>
      createPayeeCleanupSuppression(db, { ...base, budgetSyncId: "" })
    ).toThrow(AppDbValidationError);
  });

  it("rejects a record with nothing to match on", () => {
    // It could never match again, so it would silently do nothing — worse than
    // an error, because the user would think their decision was saved.
    const db = tempDb();
    expect(() =>
      createPayeeCleanupSuppression(db, {
        ...base,
        payeeIds: [],
        normalizedNames: [],
      })
    ).toThrow(AppDbValidationError);
  });

  it("accepts names alone, for a decision that must outlive the payee ids", () => {
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, { ...base, payeeIds: [] });
    expect(created.normalizedNames).toHaveLength(2);
  });

  it("rejects an unknown kind", () => {
    const db = tempDb();
    expect(() =>
      createPayeeCleanupSuppression(db, { ...base, kind: "delete-everything" })
    ).toThrow(AppDbValidationError);
  });

  it("stores an affix rejection", () => {
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, {
      budgetSyncId: "budget-1",
      kind: "rejected-affix",
      payeeIds: [],
      normalizedNames: ["TRANSFER", "FROM"],
      detectorIds: ["corpus-prefix"],
    });
    expect(created.kind).toBe("rejected-affix");
  });

  it("deduplicates and trims the lists it stores", () => {
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, {
      ...base,
      payeeIds: [" p1 ", "p1", "p2"],
    });
    expect(created.payeeIds).toEqual(["p1", "p2"]);
  });

  it("caps list sizes rather than storing unbounded input", () => {
    const db = tempDb();
    expect(() =>
      createPayeeCleanupSuppression(db, {
        ...base,
        payeeIds: Array.from({ length: 60 }, (_, i) => `p${i}`),
      })
    ).toThrow(AppDbValidationError);
  });

  it("deletes one decision and reports an unknown id", () => {
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, base);

    expect(deletePayeeCleanupSuppression(db, created.id, "budget-1")).toBe(true);
    expect(deletePayeeCleanupSuppression(db, "not-a-real-id", "budget-1")).toBe(false);
    expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(0);
  });

  it("will not delete another budget's decision by id", () => {
    // Ids are guessable and every other operation on this table is
    // budget-scoped; the id alone must not be enough.
    const db = tempDb();
    const created = createPayeeCleanupSuppression(db, base);

    expect(deletePayeeCleanupSuppression(db, created.id, "budget-2")).toBe(false);
    expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(1);
  });

  it("clears every decision for one budget only", () => {
    const db = tempDb();
    createPayeeCleanupSuppression(db, base);
    createPayeeCleanupSuppression(db, { ...base, payeeIds: ["p3", "p4"] });
    createPayeeCleanupSuppression(db, { ...base, budgetSyncId: "budget-2" });

    expect(clearPayeeCleanupSuppressions(db, "budget-1")).toBe(2);
    expect(listPayeeCleanupSuppressions(db, "budget-1")).toHaveLength(0);
    expect(listPayeeCleanupSuppressions(db, "budget-2")).toHaveLength(1);
  });

  it("rejects a payload that is not an object", () => {
    const db = tempDb();
    expect(() => createPayeeCleanupSuppression(db, "nope")).toThrow(
      AppDbValidationError
    );
    expect(() => createPayeeCleanupSuppression(db, [1, 2, 3])).toThrow(
      AppDbValidationError
    );
  });
});
