import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AppDbValidationError } from "./errors";
import { getAppDb, resetAppDbForTests } from "./connection";
import { deleteCashBufferScenario, listCashBufferScenarios, saveCashBufferScenario } from "./cashBufferScenarioRepository";
import type { SqliteDatabase } from "./types";

function tempDb(): SqliteDatabase {
  return getAppDb(join(mkdtempSync(join(tmpdir(), "actual-bench-buffer-scenarios-db-")), "metadata.sqlite"));
}

const adjustments = { excluded: ["fun"], amounts: { food: 50_000 }, loansExcluded: [], loanAmounts: {} };
const result = { months: 12.4, cashMinor: 3_000_000, monthlyNeedMinor: 240_000, actualMonths: 9.2, at: "2026-11-04T10:00:00.000Z" };

describe("cash buffer scenario repository", () => {
  afterEach(() => resetAppDbForTests());

  it("saves a scenario, updates it by id, and lists it with its result", () => {
    const db = tempDb();
    const [first] = saveCashBufferScenario(db, { budgetSyncId: "b1", name: "Lean months", adjustments, result });
    expect(first).toMatchObject({ name: "Lean months", adjustments, result });
    const renamed = saveCashBufferScenario(db, { budgetSyncId: "b1", id: first.id, name: "Leaner", adjustments: { ...adjustments, excluded: [] }, result: null });
    expect(renamed).toHaveLength(1);
    expect(renamed[0]).toMatchObject({ id: first.id, name: "Leaner", result: null });
    expect(renamed[0].adjustments.excluded).toEqual([]);
    expect(renamed[0].createdAt).toBe(first.createdAt);
  });

  it("keeps several scenarios, scoped to one budget", () => {
    const db = tempDb();
    saveCashBufferScenario(db, { budgetSyncId: "b1", name: "A", adjustments });
    saveCashBufferScenario(db, { budgetSyncId: "b1", name: "B", adjustments });
    saveCashBufferScenario(db, { budgetSyncId: "b2", name: "C", adjustments });
    expect(listCashBufferScenarios(db, "b1").map((s) => s.name).sort()).toEqual(["A", "B"]);
    expect(listCashBufferScenarios(db, "b2").map((s) => s.name)).toEqual(["C"]);
  });

  it("deletes one scenario", () => {
    const db = tempDb();
    const [a] = saveCashBufferScenario(db, { budgetSyncId: "b1", name: "A", adjustments });
    saveCashBufferScenario(db, { budgetSyncId: "b1", name: "B", adjustments });
    expect(deleteCashBufferScenario(db, "b1", a.id).map((s) => s.name)).toEqual(["B"]);
  });

  it("rejects bad input without writing anything", () => {
    const db = tempDb();
    expect(() => saveCashBufferScenario(db, { budgetSyncId: "b1", name: " ", adjustments })).toThrow(AppDbValidationError);
    expect(() => saveCashBufferScenario(db, { budgetSyncId: "b1", name: "x".repeat(81), adjustments })).toThrow(AppDbValidationError);
    expect(() => saveCashBufferScenario(db, { budgetSyncId: "b1", name: "A", adjustments: { ...adjustments, amounts: { food: -5 } } })).toThrow(AppDbValidationError);
    expect(() => saveCashBufferScenario(db, { budgetSyncId: "b1", name: "A", adjustments, result: { months: "x" } })).toThrow(AppDbValidationError);
    expect(() => saveCashBufferScenario(db, { name: "A", adjustments })).toThrow(AppDbValidationError);
    expect(listCashBufferScenarios(db, "b1")).toEqual([]);
  });

  it("skips a row it cannot read instead of failing the list", () => {
    const db = tempDb();
    saveCashBufferScenario(db, { budgetSyncId: "b1", name: "Good", adjustments });
    db.prepare("INSERT INTO cash_buffer_scenarios (budget_sync_id, id, name, adjustments, result, created_at, updated_at) VALUES ('b1','bad','Bad','not json',NULL,'2026-01-01','2026-01-01')").run();
    expect(listCashBufferScenarios(db, "b1").map((s) => s.name)).toEqual(["Good"]);
  });

  it("limits how many a budget can hold", () => {
    const db = tempDb();
    for (let i = 0; i < 50; i++) saveCashBufferScenario(db, { budgetSyncId: "b1", name: `S${i}`, adjustments });
    expect(() => saveCashBufferScenario(db, { budgetSyncId: "b1", name: "one too many", adjustments })).toThrow(AppDbValidationError);
  });
});
