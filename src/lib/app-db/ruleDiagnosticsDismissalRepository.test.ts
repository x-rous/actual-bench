import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import {
  createRuleDiagnosticsDismissal,
  deleteRuleDiagnosticsDismissal,
  deleteRuleDiagnosticsDismissals,
  listRuleDiagnosticsDismissals,
} from "./ruleDiagnosticsDismissalRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  const root = mkdtempSync(join(tmpdir(), "actual-bench-rule-dismissal-db-"));
  return getAppDb(join(root, "metadata.sqlite"));
}

const base = {
  budgetSyncId: "budget-1",
  code: "RULE_NEAR_DUPLICATE_FAMILY",
  ruleIds: ["r1", "r2"],
  signatures: ["sig-1", "sig-2"],
};

describe("rule diagnostics dismissal repository", () => {
  afterEach(() => {
    resetAppDbForTests();
  });

  it("creates and lists dismissals for a budget", () => {
    const db = tempDb();
    const created = createRuleDiagnosticsDismissal(db, base);

    expect(created.id).toBeTruthy();
    expect(created.ruleIds).toEqual(["r1", "r2"]);
    expect(created.signatures).toEqual(["sig-1", "sig-2"]);

    const listed = listRuleDiagnosticsDismissals(db, "budget-1");
    expect(listed).toHaveLength(1);
    expect(listed[0].code).toBe("RULE_NEAR_DUPLICATE_FAMILY");
  });

  it("keeps budgets apart", () => {
    const db = tempDb();
    createRuleDiagnosticsDismissal(db, base);
    createRuleDiagnosticsDismissal(db, { ...base, budgetSyncId: "budget-2" });

    expect(listRuleDiagnosticsDismissals(db, "budget-1")).toHaveLength(1);
    expect(listRuleDiagnosticsDismissals(db, "budget-2")).toHaveLength(1);
  });

  it("round-trips an optional discriminator and note", () => {
    const db = tempDb();
    const created = createRuleDiagnosticsDismissal(db, {
      ...base,
      code: "RULE_BROAD_MATCH",
      discriminator: "imported_payee A",
      note: "deliberate",
    });

    expect(created.discriminator).toBe("imported_payee A");
    expect(created.note).toBe("deliberate");

    const [listed] = listRuleDiagnosticsDismissals(db, "budget-1");
    expect(listed.discriminator).toBe("imported_payee A");
  });

  it("omits an absent discriminator rather than storing an empty string", () => {
    const db = tempDb();
    const created = createRuleDiagnosticsDismissal(db, base);
    expect(created.discriminator).toBeUndefined();
    expect(listRuleDiagnosticsDismissals(db, "budget-1")[0].discriminator).toBeUndefined();
  });

  it("rejects a record with nothing to match on", () => {
    const db = tempDb();
    expect(() =>
      createRuleDiagnosticsDismissal(db, { ...base, ruleIds: [], signatures: [] })
    ).toThrow(AppDbValidationError);
  });

  it("requires a budget and a code", () => {
    const db = tempDb();
    expect(() => createRuleDiagnosticsDismissal(db, { ...base, budgetSyncId: "" })).toThrow(
      AppDbValidationError
    );
    expect(() => createRuleDiagnosticsDismissal(db, { ...base, code: "  " })).toThrow(
      AppDbValidationError
    );
  });

  it("caps list length", () => {
    const db = tempDb();
    const tooMany = Array.from({ length: 51 }, (_, i) => `r${i}`);
    expect(() => createRuleDiagnosticsDismissal(db, { ...base, ruleIds: tooMany })).toThrow(
      AppDbValidationError
    );
  });

  it("deletes by id, scoped to the budget", () => {
    const db = tempDb();
    const created = createRuleDiagnosticsDismissal(db, base);

    // Another budget must not be able to delete this decision.
    expect(deleteRuleDiagnosticsDismissal(db, created.id, "budget-2")).toBe(false);
    expect(deleteRuleDiagnosticsDismissal(db, created.id, "budget-1")).toBe(true);
    expect(listRuleDiagnosticsDismissals(db, "budget-1")).toHaveLength(0);
  });

  it("bulk-deletes for the garbage collector, scoped to the budget", () => {
    const db = tempDb();
    const a = createRuleDiagnosticsDismissal(db, base);
    const b = createRuleDiagnosticsDismissal(db, { ...base, ruleIds: ["r3"] });
    const other = createRuleDiagnosticsDismissal(db, { ...base, budgetSyncId: "budget-2" });

    const removed = deleteRuleDiagnosticsDismissals(db, [a.id, b.id, other.id], "budget-1");

    expect(removed).toBe(2);
    expect(listRuleDiagnosticsDismissals(db, "budget-1")).toHaveLength(0);
    expect(listRuleDiagnosticsDismissals(db, "budget-2")).toHaveLength(1);
  });

  it("bulk-deletes nothing for an empty id list", () => {
    const db = tempDb();
    createRuleDiagnosticsDismissal(db, base);
    expect(deleteRuleDiagnosticsDismissals(db, [], "budget-1")).toBe(0);
    expect(listRuleDiagnosticsDismissals(db, "budget-1")).toHaveLength(1);
  });
});
