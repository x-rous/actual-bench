import type { MetadataJson } from "../types";
import { runDiagnosticChecks, runIntegrityCheck, type DiagnosticDb } from "./diagnosticChecks";
import { EXPECTED_COLUMNS, EXPECTED_TABLES, EXPECTED_VIEWS } from "./expectedSchema";

type Row = Record<string, unknown>;

class FakeDiagnosticDb implements DiagnosticDb {
  private readonly objects = new Map<string, { type: "table" | "view"; rows: Row[]; columns: string[] }>();
  private readonly pragmas = new Map<string, unknown>([
    ["PRAGMA quick_check", "ok"],
    ["PRAGMA page_count", 10],
    ["PRAGMA page_size", 4096],
    ["PRAGMA freelist_count", 0],
    ["PRAGMA integrity_check", "ok"],
  ]);

  exec() {}

  addObject(name: string, type: "table" | "view", columns: readonly string[], rows: Row[] = []) {
    this.objects.set(name, { type, columns: [...columns], rows });
  }

  setPragma(sql: string, value: unknown) {
    this.pragmas.set(sql, value);
  }

  selectValue(sql: string): unknown {
    if (this.pragmas.has(sql)) return this.pragmas.get(sql);

    const countMatch = /SELECT COUNT\(\*\) FROM "([^"]+)"/.exec(sql);
    if (countMatch) {
      const object = this.objects.get(countMatch[1]);
      if (!object) return 0;
      const idMatch = /WHERE "id" = '([^']+)'/.exec(sql);
      if (!idMatch) return object.rows.length;
      const id = idMatch[1];
      return object.rows.filter((row) => row.id === id && row.tombstone !== 1).length;
    }

    return 0;
  }

  selectRows<T extends Row>(sql: string): T[] {
    if (sql === "PRAGMA foreign_key_check") return [];
    if (sql === "SELECT id FROM notes") {
      return (this.objects.get("notes")?.rows ?? []).map((row) => ({ id: row.id })) as unknown as T[];
    }

    if (sql.includes("WITH note_refs")) {
      const tableMatch = /LEFT JOIN "([^"]+)"/.exec(sql);
      const table = tableMatch?.[1];
      if (!table) return [];
      const rightRows = this.objects.get(table)?.rows ?? [];
      return [...sql.matchAll(/\('([^']+)', '([^']+)'\)/g)]
        .map((match) => ({ noteId: match[1], entityId: match[2] }))
        .filter(
          (ref) =>
            !rightRows.some((row) => row.id === ref.entityId && row.tombstone !== 1)
        )
        .slice(0, 100) as unknown as T[];
    }

    const relationMatch = /FROM "([^"]+)" l\s+LEFT JOIN "([^"]+)" r/.exec(sql);
    const rowIdColumnMatch = /SELECT l\."([^"]+)" AS rowId/.exec(sql);
    const columnMatch = /l\."([^"]+)" AS relatedId/.exec(sql);
    const targetColumnMatch = /ON l\."[^"]+" = r\."([^"]+)"/.exec(sql);
    if (relationMatch && rowIdColumnMatch && columnMatch && targetColumnMatch) {
      const [, table, relatedTable] = relationMatch;
      const rowIdColumn = rowIdColumnMatch[1];
      const column = columnMatch[1];
      const targetColumn = targetColumnMatch[1];
      const leftRows = this.objects.get(table)?.rows ?? [];
      const rightRows = this.objects.get(relatedTable)?.rows ?? [];
      const childOnly = sql.includes('l."isChild" = 1');

      return leftRows
        .filter((row) => row[column] !== null && row[column] !== undefined)
        .filter((row) => row.tombstone !== 1)
        .filter((row) => !childOnly || row.isChild === 1)
        .filter(
          (row) =>
            !rightRows.some(
              (right) => right[targetColumn] === row[column] && right.tombstone !== 1
            )
        )
        .map((row) => ({ rowId: String(row[rowIdColumn]), relatedId: String(row[column]) })) as unknown as T[];
    }

    return [];
  }

  objectExists(name: string, type?: "table" | "view"): boolean {
    const object = this.objects.get(name);
    if (!object) return false;
    return type ? object.type === type : true;
  }

  getColumns(name: string): readonly string[] {
    return this.objects.get(name)?.columns ?? [];
  }
}

const FULL_METADATA: MetadataJson = {
  id: "budget-id",
  budgetName: "Budget",
  cloudFileId: "cloud-id",
  groupId: "group-id",
  userId: "user-id",
  lastUploaded: "2026-04-06",
  lastSyncedTimestamp: "2026-04-12T12:24:26.880Z",
  lastScheduleRun: "2026-04-12",
  encryptKeyId: null,
  resetClock: true,
};

function buildDb(): FakeDiagnosticDb {
  const db = new FakeDiagnosticDb();
  for (const table of EXPECTED_TABLES) {
    db.addObject(table, "table", EXPECTED_COLUMNS[table], [{ id: `${table}-id` }]);
  }
  for (const view of EXPECTED_VIEWS) {
    db.addObject(view, "view", EXPECTED_COLUMNS[view], [{ id: `${view}-id` }]);
  }

  db.addObject("accounts", "table", EXPECTED_COLUMNS.accounts, [{ id: "account-1" }]);
  db.addObject("category_groups", "table", EXPECTED_COLUMNS.category_groups, [
    { id: "group-1" },
  ]);
  db.addObject("categories", "table", EXPECTED_COLUMNS.categories, [
    { id: "category-1", cat_group: "group-1", tombstone: 0 },
  ]);
  db.addObject("category_mapping", "table", EXPECTED_COLUMNS.category_mapping, [
    { id: "category-map-1", transferId: "category-1" },
  ]);
  db.addObject("rules", "table", EXPECTED_COLUMNS.rules, [{ id: "rule-1", tombstone: 0 }]);
  db.addObject("schedules", "table", EXPECTED_COLUMNS.schedules, [
    { id: "schedule-1", rule: "rule-1", tombstone: 0 },
  ]);
  db.addObject("payees", "table", EXPECTED_COLUMNS.payees, [
    {
      id: "payee-1",
      category: "category-1",
      transfer_acct: "account-1",
      tombstone: 0,
    },
  ]);
  db.addObject("payee_mapping", "table", EXPECTED_COLUMNS.payee_mapping, [
    { id: "payee-map-1", targetId: "payee-1" },
  ]);
  db.addObject("transactions", "table", EXPECTED_COLUMNS.transactions, [
    {
      id: "transaction-parent",
      isChild: 0,
      acct: "account-1",
      category: "category-map-1",
      description: "payee-map-1",
      tombstone: 0,
    },
    {
      id: "transaction-child",
      isChild: 1,
      acct: "account-1",
      category: "category-map-1",
      description: "payee-map-1",
      parent_id: "transaction-parent",
      transferred_id: "transaction-parent",
      schedule: "schedule-1",
      tombstone: 0,
    },
  ]);
  db.addObject("schedules_next_date", "table", EXPECTED_COLUMNS.schedules_next_date, [
    { id: "schedule-next-1", schedule_id: "schedule-1", tombstone: 0 },
  ]);
  db.addObject("schedules_json_paths", "table", EXPECTED_COLUMNS.schedules_json_paths, [
    { schedule_id: "schedule-1" },
  ]);
  db.addObject("dashboard_pages", "table", EXPECTED_COLUMNS.dashboard_pages, [
    { id: "dashboard-page-1" },
  ]);
  db.addObject("dashboard", "table", EXPECTED_COLUMNS.dashboard, [
    { id: "dashboard-1", dashboard_page_id: "dashboard-page-1", tombstone: 0 },
  ]);
  db.addObject("payee_locations", "table", EXPECTED_COLUMNS.payee_locations, [
    { id: "payee-location-1", payee_id: "payee-1", tombstone: 0 },
  ]);
  db.addObject("reflect_budgets", "table", EXPECTED_COLUMNS.reflect_budgets, [
    { id: "reflect-budget-1", category: "category-1" },
  ]);
  db.addObject("zero_budgets", "table", EXPECTED_COLUMNS.zero_budgets, [
    { id: "zero-budget-1", category: "category-1" },
  ]);

  return db;
}

function relationshipFindings(db: FakeDiagnosticDb) {
  return runDiagnosticChecks(db, FULL_METADATA).filter((finding) =>
    finding.code.startsWith("REL_")
  );
}

describe("diagnosticChecks", () => {
  it("does not produce errors for a clean schema snapshot", () => {
    const findings = runDiagnosticChecks(buildDb(), FULL_METADATA);

    expect(findings.filter((finding) => finding.severity === "error")).toEqual([]);
  });

  it("does not produce relationship findings for a clean linked snapshot", () => {
    expect(relationshipFindings(buildDb())).toEqual([]);
  });

  it("reports category group orphan relationships with row context", () => {
    const db = buildDb();
    db.addObject("category_groups", "table", EXPECTED_COLUMNS.category_groups, [
      { id: "group-1" },
    ]);
    db.addObject("categories", "table", EXPECTED_COLUMNS.categories, [
      { id: "cat-1", cat_group: "missing-group", tombstone: 0 },
    ]);

    const findings = runDiagnosticChecks(db, FULL_METADATA);
    const orphan = findings.find((finding) => finding.code === "REL_CATEGORY_ORPHAN_GROUP");

    expect(orphan).toMatchObject({
      severity: "warning",
      table: "categories",
      rowId: "cat-1",
      relatedTable: "category_groups",
      relatedId: "missing-group",
    });
  });

  it("reports missing category mappings referenced by transactions", () => {
    const db = buildDb();
    db.addObject("category_mapping", "table", EXPECTED_COLUMNS.category_mapping, []);
    db.addObject("transactions", "table", EXPECTED_COLUMNS.transactions, [
      {
        id: "transaction-1",
        isChild: 0,
        acct: "account-1",
        category: "category-map-1",
        description: "payee-map-1",
        tombstone: 0,
      },
    ]);

    expect(relationshipFindings(db)).toEqual([
      expect.objectContaining({
        code: "REL_TRANSACTION_ORPHAN_CATEGORY_MAPPING",
        severity: "warning",
        table: "transactions",
        rowId: "transaction-1",
        relatedTable: "category_mapping",
        relatedId: "category-map-1",
      }),
    ]);
  });

  it("reports missing payee mappings referenced by transactions", () => {
    const db = buildDb();
    db.addObject("payee_mapping", "table", EXPECTED_COLUMNS.payee_mapping, []);
    db.addObject("transactions", "table", EXPECTED_COLUMNS.transactions, [
      {
        id: "transaction-1",
        isChild: 0,
        acct: "account-1",
        category: "category-map-1",
        description: "payee-map-1",
        tombstone: 0,
      },
    ]);

    expect(relationshipFindings(db)).toEqual([
      expect.objectContaining({
        code: "REL_TRANSACTION_ORPHAN_PAYEE_MAPPING",
        severity: "warning",
        table: "transactions",
        rowId: "transaction-1",
        relatedTable: "payee_mapping",
        relatedId: "payee-map-1",
      }),
    ]);
  });

  it("reports missing categories referenced by category mappings", () => {
    const db = buildDb();
    db.addObject("categories", "table", EXPECTED_COLUMNS.categories, [
      { id: "category-other", cat_group: "group-1", tombstone: 0 },
    ]);
    db.addObject("payees", "table", EXPECTED_COLUMNS.payees, [
      { id: "payee-1", category: "category-other", transfer_acct: "account-1", tombstone: 0 },
    ]);
    db.addObject("reflect_budgets", "table", EXPECTED_COLUMNS.reflect_budgets, [
      { id: "reflect-budget-1", category: "category-other" },
    ]);
    db.addObject("zero_budgets", "table", EXPECTED_COLUMNS.zero_budgets, [
      { id: "zero-budget-1", category: "category-other" },
    ]);

    const findings = relationshipFindings(db);

    expect(findings).toEqual([
      expect.objectContaining({
        code: "REL_CATEGORY_MAPPING_ORPHAN_TRANSFER",
        severity: "warning",
        table: "category_mapping",
        rowId: "category-map-1",
        relatedTable: "categories",
        relatedId: "category-1",
      }),
    ]);
  });

  it("reports missing payees referenced by payee mappings", () => {
    const db = buildDb();
    db.addObject("payees", "table", EXPECTED_COLUMNS.payees, []);
    db.addObject("payee_locations", "table", EXPECTED_COLUMNS.payee_locations, []);

    expect(relationshipFindings(db)).toEqual([
      expect.objectContaining({
        code: "REL_PAYEE_MAPPING_ORPHAN_TARGET",
        severity: "warning",
        table: "payee_mapping",
        rowId: "payee-map-1",
        relatedTable: "payees",
        relatedId: "payee-1",
      }),
    ]);
  });

  it("reports missing categories referenced by payees", () => {
    const db = buildDb();
    db.addObject("payees", "table", EXPECTED_COLUMNS.payees, [
      { id: "payee-1", category: "missing-category", transfer_acct: "account-1", tombstone: 0 },
    ]);
    db.addObject("payee_mapping", "table", EXPECTED_COLUMNS.payee_mapping, [
      { id: "payee-map-1", targetId: "payee-1" },
    ]);
    db.addObject("payee_locations", "table", EXPECTED_COLUMNS.payee_locations, [
      { id: "payee-location-1", payee_id: "payee-1", tombstone: 0 },
    ]);

    expect(relationshipFindings(db)).toEqual([
      expect.objectContaining({
        code: "REL_PAYEE_ORPHAN_CATEGORY",
        severity: "warning",
        table: "payees",
        rowId: "payee-1",
        relatedTable: "categories",
        relatedId: "missing-category",
      }),
    ]);
  });

  it("softens stale transaction transfer and schedule relationships to info", () => {
    const db = buildDb();
    db.addObject("transactions", "table", EXPECTED_COLUMNS.transactions, [
      {
        id: "transaction-1",
        isChild: 0,
        acct: "account-1",
        category: "category-map-1",
        description: "payee-map-1",
        transferred_id: "missing-transfer",
        schedule: "missing-schedule",
        tombstone: 0,
      },
    ]);

    expect(relationshipFindings(db)).toEqual([
      expect.objectContaining({
        code: "REL_TRANSACTION_ORPHAN_TRANSFER",
        severity: "info",
        relatedId: "missing-transfer",
      }),
      expect.objectContaining({
        code: "REL_TRANSACTION_ORPHAN_SCHEDULE",
        severity: "info",
        relatedId: "missing-schedule",
      }),
    ]);
  });

  it("uses the relationship column as row context when the table has no id column", () => {
    const db = buildDb();
    db.addObject("schedules", "table", EXPECTED_COLUMNS.schedules, []);
    db.addObject("schedules_json_paths", "table", EXPECTED_COLUMNS.schedules_json_paths, [
      { schedule_id: "missing-schedule" },
    ]);

    const findings = runDiagnosticChecks(db, FULL_METADATA);
    const orphan = findings.find(
      (finding) => finding.code === "REL_SCHEDULE_JSON_PATHS_ORPHAN_SCHEDULE"
    );

    expect(orphan).toMatchObject({
      table: "schedules_json_paths",
      rowId: "missing-schedule",
      relatedTable: "schedules",
      relatedId: "missing-schedule",
    });
  });

  it("reports note relationships with batched target lookups", () => {
    const db = buildDb();
    db.addObject("notes", "table", EXPECTED_COLUMNS.notes, [
      { id: "account-00000000-0000-0000-0000-000000000001" },
      { id: "payee-00000000-0000-0000-0000-000000000002" },
      { id: "other-note" },
    ]);

    const findings = relationshipFindings(db);

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "REL_NOTE_ORPHAN_ENTITY",
          table: "notes",
          rowId: "account-00000000-0000-0000-0000-000000000001",
          relatedTable: "accounts",
          relatedId: "00000000-0000-0000-0000-000000000001",
        }),
        expect.objectContaining({
          code: "REL_NOTE_ORPHAN_ENTITY",
          rowId: "payee-00000000-0000-0000-0000-000000000002",
          relatedTable: "payees",
          relatedId: "00000000-0000-0000-0000-000000000002",
        }),
      ])
    );
  });

  it("reports malformed metadata dates", () => {
    const findings = runDiagnosticChecks(buildDb(), {
      ...FULL_METADATA,
      lastUploaded: "not-a-date",
    });

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SNAPSHOT_METADATA_DATE",
          severity: "warning",
        }),
      ])
    );
  });

  it("accepts Actual sync timestamps with vector-clock suffixes", () => {
    const findings = runDiagnosticChecks(buildDb(), {
      ...FULL_METADATA,
      lastSyncedTimestamp: "2026-04-12T12:24:26.880Z-0011-956c3954c9864854",
    });

    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SNAPSHOT_METADATA_DATE",
        }),
      ])
    );
  });

  it("returns full integrity check info when SQLite reports ok", () => {
    expect(runIntegrityCheck(buildDb())).toEqual([
      expect.objectContaining({
        code: "SQLITE_INTEGRITY_CHECK",
        severity: "info",
      }),
    ]);
  });

  it("returns full integrity check error when SQLite reports a problem", () => {
    const db = buildDb();
    db.setPragma("PRAGMA integrity_check", "database disk image is malformed");

    expect(runIntegrityCheck(db)).toEqual([
      expect.objectContaining({
        code: "SQLITE_INTEGRITY_CHECK",
        severity: "error",
      }),
    ]);
  });
});
