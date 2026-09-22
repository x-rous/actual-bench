import Database from "better-sqlite3";
import {
  DEFAULT_PDF_PARSER_GUIDANCE,
  createPdfLayoutProfile,
  parsePdfStatementPages,
} from "@/lib/reconciliation/statement/pdf";
import { runMigrations } from "./migrations";
import {
  assignPdfStatementLayout,
  deletePdfStatementLayout,
  listPdfStatementLayouts,
  removePdfStatementLayoutAssignment,
  renamePdfStatementLayout,
  renamePdfStatementLayoutBank,
  savePdfStatementLayout,
} from "./pdfStatementLayoutRepository";
import type { SqliteDatabase } from "./types";

function statement(header: string) {
  const items = [
    [header, 20, 740], ["Description", 200, 740], ["Amount", 480, 740],
    ["08/15/2026", 20, 700], ["ANON SHOP", 200, 700], ["-12.50", 480, 700],
  ].map(([text, x, y], index) => ({
    id: `item-${index}`,
    str: String(text),
    transform: [10, 0, 0, 10, Number(x), Number(y)] as [number, number, number, number, number, number],
    width: String(text).length * 6,
    height: 10,
  }));
  return parsePdfStatementPages([{ pageNumber: 1, width: 700, height: 800, items }], {
    guidance: { ...DEFAULT_PDF_PARSER_GUIDANCE, currency: "USD", dateFormat: "mdy" },
  });
}

function envelope(id: string, name: string, header = "Transaction Date") {
  return {
    kind: "pdf-layout-v3" as const,
    profile: createPdfLayoutProfile({ id, name, result: statement(header) }),
  };
}

function withDb(run: (db: SqliteDatabase) => void) {
  const db = new Database(":memory:") as unknown as SqliteDatabase;
  (db as unknown as { pragma: (value: string) => void }).pragma("foreign_keys = ON");
  try {
    runMigrations(db);
    run(db);
  } finally {
    (db as unknown as { close: () => void }).close();
  }
}

const save = (db: SqliteDatabase, overrides: Partial<Parameters<typeof savePdfStatementLayout>[1]> = {}) =>
  savePdfStatementLayout(db, {
    budgetSyncId: "budget-1",
    accountId: "acct-1",
    bankName: "HSBC Bank",
    layoutName: "Credit card",
    layout: envelope("layout-1", "Credit card"),
    ...overrides,
  });

describe("statement layout repository", () => {
  it("shares layouts across budgets while keeping assignments to one account", () => {
    withDb((db) => {
      save(db, { assignToAccount: true });

      // The layout itself is global: another budget sees it without being
      // assigned to it.
      expect(listPdfStatementLayouts(db, "budget-2", "acct-9").layouts).toHaveLength(1);
      expect(listPdfStatementLayouts(db, "budget-2", "acct-9").accountLayoutId).toBeNull();
      expect(listPdfStatementLayouts(db, "budget-1", "acct-1").accountLayoutId).not.toBeNull();
    });
  });

  it("refuses a name already taken, and replaces it when asked to", () => {
    withDb((db) => {
      const first = save(db);
      expect(() => save(db)).toThrow(/already has a layout named/);

      const updated = save(db, {
        mode: "update",
        layout: envelope("layout-1", "Credit card", "Posting Date"),
      });
      expect(updated.id).toBe(first.id);
      expect(listPdfStatementLayouts(db).layouts).toHaveLength(1);
    });
  });

  it("refuses to update a layout that is not there", () => {
    withDb((db) => {
      expect(() => save(db, { mode: "update" })).toThrow(/was not found/);
    });
  });

  it("renames a bank across the layouts that carry the label", () => {
    withDb((db) => {
      save(db);
      save(db, { layoutName: "Checking", layout: envelope("layout-2", "Checking") });

      expect(renamePdfStatementLayoutBank(db, { from: "HSBC Bank", to: "HSBC" })).toBe(2);
      expect(listPdfStatementLayouts(db).layouts.map((layout) => layout.bankName)).toEqual(["HSBC", "HSBC"]);
    });
  });

  it("refuses a bank rename that would collide two layouts of the same name", () => {
    withDb((db) => {
      save(db);
      save(db, { bankName: "Barclays", layout: envelope("layout-2", "Credit card") });

      // This is a merge, not a rename, and it would leave two layouts with one
      // name under one bank.
      expect(() => renamePdfStatementLayoutBank(db, { from: "Barclays", to: "HSBC Bank" }))
        .toThrow(/already has a layout with that name/);
    });
  });

  it("keeps the stored layout's own name in step when a layout is renamed", () => {
    withDb((db) => {
      const saved = save(db);

      const renamed = renamePdfStatementLayout(db, { layoutId: saved.id, name: "Platinum card" });

      expect(renamed.name).toBe("Platinum card");
      // The name lives in the JSON too, and the two disagreeing is how a
      // layout becomes unsavable later.
      expect((renamed.layout as { profile: { name: string } }).profile.name).toBe("Platinum card");
    });
  });

  it("takes an account's assignment with the layout when it is deleted", () => {
    withDb((db) => {
      const saved = save(db, { assignToAccount: true });

      expect(deletePdfStatementLayout(db, saved.id)).toBe(true);
      expect(listPdfStatementLayouts(db, "budget-1", "acct-1")).toEqual({
        layouts: [],
        accountLayoutId: null,
      });
    });
  });

  it("moves an assignment rather than adding a second one", () => {
    withDb((db) => {
      const card = save(db, { assignToAccount: true });
      const checking = save(db, { layoutName: "Checking", layout: envelope("layout-2", "Checking") });

      assignPdfStatementLayout(db, { budgetSyncId: "budget-1", accountId: "acct-1", layoutId: checking.id });
      expect(listPdfStatementLayouts(db, "budget-1", "acct-1").accountLayoutId).toBe(checking.id);

      removePdfStatementLayoutAssignment(db, { budgetSyncId: "budget-1", accountId: "acct-1" });
      expect(listPdfStatementLayouts(db, "budget-1", "acct-1").accountLayoutId).toBeNull();
      // Removing the assignment leaves both layouts in place.
      expect(listPdfStatementLayouts(db).layouts.map((layout) => layout.id).sort())
        .toEqual([card.id, checking.id].sort());
    });
  });

  it("refuses layout data that is not a layout", () => {
    withDb((db) => {
      expect(() => save(db, { layout: { kind: "pdf-layout-v3", profile: { id: "x" } } }))
        .toThrow(/data is invalid/);
      expect(() => save(db, { layout: { statementText: "PRIVATE" } })).toThrow(/data is invalid/);
    });
  });
});
