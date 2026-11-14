import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPlanDocument, createRow } from "@/lib/cashflow-planning/document";
import { AppDbConflictError, AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { deleteCashflowPlan, listCashflowPlans, saveCashflowPlan } from "./cashflowPlanRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  return getAppDb(join(mkdtempSync(join(tmpdir(), "actual-bench-cashflow-plans-db-")), "metadata.sqlite"));
}

const document = () => ({ ...createPlanDocument({ name: "Household", startMonth: "2026-01", years: 3 }), rows: [createRow({ name: "Salary", section: "income" })] });

describe("cashflow plan repository", () => {
  afterEach(() => resetAppDbForTests());

  it("saves a new plan, then updates it only from the revision it was read at", () => {
    const db = tempDb();
    const doc = document();
    const created = saveCashflowPlan(db, { budgetSyncId: "b1", document: doc });
    expect(created).toMatchObject({ name: "Household", revision: 1, document: doc });

    const updated = saveCashflowPlan(db, { budgetSyncId: "b1", id: created.id, baseRevision: 1, document: { ...doc, name: "Renamed" } });
    expect(updated).toMatchObject({ id: created.id, name: "Renamed", revision: 2, createdAt: created.createdAt });

    // A second tab still holding revision 1 is refused, unless it says to overwrite.
    expect(() => saveCashflowPlan(db, { budgetSyncId: "b1", id: created.id, baseRevision: 1, document: doc })).toThrow(AppDbConflictError);
    expect(saveCashflowPlan(db, { budgetSyncId: "b1", id: created.id, baseRevision: 1, force: true, document: doc }).revision).toBe(3);
    expect(listCashflowPlans(db, "b1")).toHaveLength(1);
  });

  it("keeps plans per budget, refuses what is not a plan, and deletes", () => {
    const db = tempDb();
    const a = saveCashflowPlan(db, { budgetSyncId: "b1", document: document() });
    saveCashflowPlan(db, { budgetSyncId: "b2", document: document() });
    expect(listCashflowPlans(db, "b1").map((p) => p.id)).toEqual([a.id]);
    expect(() => saveCashflowPlan(db, { budgetSyncId: "b1", document: { ...document(), years: 80 } })).toThrow(AppDbValidationError);
    expect(() => saveCashflowPlan(db, { document: document() })).toThrow("budgetSyncId is required");
    deleteCashflowPlan(db, "b1", a.id);
    expect(listCashflowPlans(db, "b1")).toEqual([]);
    expect(listCashflowPlans(db, "b2")).toHaveLength(1);
  });

  it("skips a stored plan this version cannot read", () => {
    const db = tempDb();
    saveCashflowPlan(db, { budgetSyncId: "b1", document: document() });
    db.prepare("INSERT INTO cashflow_plans (budget_sync_id, id, name, revision, document, created_at, updated_at) VALUES ('b1','future','Future',1,'{\"schemaVersion\":99}','t','t')").run();
    expect(listCashflowPlans(db, "b1").map((p) => p.name)).toEqual(["Household"]);
  });
});
