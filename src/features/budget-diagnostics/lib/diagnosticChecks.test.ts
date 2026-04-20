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

    const relationMatch = /FROM "([^"]+)" l\s+LEFT JOIN "([^"]+)" r/.exec(sql);
    const rowIdColumnMatch = /SELECT l\."([^"]+)" AS rowId/.exec(sql);
    const columnMatch = /l\."([^"]+)" AS relatedId/.exec(sql);
    if (relationMatch && rowIdColumnMatch && columnMatch) {
      const [, table, relatedTable] = relationMatch;
      const rowIdColumn = rowIdColumnMatch[1];
      const column = columnMatch[1];
      const leftRows = this.objects.get(table)?.rows ?? [];
      const rightRows = this.objects.get(relatedTable)?.rows ?? [];
      const childOnly = sql.includes('l."isChild" = 1');

      return leftRows
        .filter((row) => row[column] !== null && row[column] !== undefined)
        .filter((row) => row.tombstone !== 1)
        .filter((row) => !childOnly || row.isChild === 1)
        .filter((row) => !rightRows.some((right) => right.id === row[column] && right.tombstone !== 1))
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
  return db;
}

describe("diagnosticChecks", () => {
  it("does not produce errors for a clean schema snapshot", () => {
    const findings = runDiagnosticChecks(buildDb(), FULL_METADATA);

    expect(findings.filter((finding) => finding.severity === "error")).toEqual([]);
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
