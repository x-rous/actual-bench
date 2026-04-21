import type { BudgetDiagnostic, MetadataJson } from "../types";
import { EXPECTED_COLUMNS, EXPECTED_TABLES, EXPECTED_VIEWS } from "./expectedSchema";
import { RELATIONSHIPS } from "./relationshipMap";

export type DiagnosticDb = {
  exec?: (sql: string) => void;
  selectValue: (sql: string) => unknown;
  selectRows: <T extends Record<string, unknown>>(sql: string) => T[];
  objectExists: (name: string, type?: "table" | "view") => boolean;
  getColumns: (name: string) => readonly string[];
};

const NOTE_ID_PATTERN = /^(account|category|payee|schedule)-([0-9a-f-]{36})$/i;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function asString(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function hasColumn(db: DiagnosticDb, object: string, column: string): boolean {
  return db.getColumns(object).includes(column);
}

function rowCount(db: DiagnosticDb, object: string): number {
  try {
    return asNumber(db.selectValue(`SELECT COUNT(*) FROM ${quoteIdentifier(object)}`));
  } catch {
    return 0;
  }
}

function entityExists(db: DiagnosticDb, table: string, id: string): boolean {
  if (!db.objectExists(table, "table")) return false;
  const tombstoneClause = hasColumn(db, table, "tombstone")
    ? ` AND IFNULL(${quoteIdentifier("tombstone")}, 0) = 0`
    : "";
  const count = db.selectValue(
    `SELECT COUNT(*) FROM ${quoteIdentifier(table)} WHERE ${quoteIdentifier("id")} = ${sqlLiteral(id)}${tombstoneClause}`
  );
  return asNumber(count) > 0;
}

function sqliteChecks(db: DiagnosticDb): BudgetDiagnostic[] {
  const findings: BudgetDiagnostic[] = [];
  db.exec?.("PRAGMA foreign_keys = ON");

  const quickCheck = asString(db.selectValue("PRAGMA quick_check"));
  if (quickCheck && quickCheck.toLowerCase() !== "ok") {
    findings.push({
      code: "SQLITE_QUICK_CHECK",
      severity: "error",
      title: "SQLite quick check failed",
      message: quickCheck,
    });
  }

  const foreignKeyRows = db.selectRows<{
    table?: string;
    rowid?: string | number;
    parent?: string;
    fkid?: string | number;
  }>("PRAGMA foreign_key_check");
  for (const row of foreignKeyRows) {
    findings.push({
      code: "SQLITE_FOREIGN_KEY_CHECK",
      severity: "warning",
      title: "Declared foreign key check failed",
      message: `SQLite reported a foreign key issue in ${row.table ?? "unknown table"}.`,
      table: row.table ? String(row.table) : undefined,
      rowId: row.rowid === undefined ? undefined : String(row.rowid),
      relatedTable: row.parent ? String(row.parent) : undefined,
      details: row.fkid === undefined ? undefined : [`Foreign key id: ${row.fkid}`],
    });
  }

  const pageCount = asNumber(db.selectValue("PRAGMA page_count"));
  const pageSize = asNumber(db.selectValue("PRAGMA page_size"));
  const freelistCount = asNumber(db.selectValue("PRAGMA freelist_count"));
  findings.push({
    code: "SQLITE_STORAGE_STATS",
    severity: "info",
    title: "SQLite storage stats",
    message: `${pageCount} pages at ${pageSize} bytes per page; ${freelistCount} free pages.`,
    details: [
      `page_count=${pageCount}`,
      `page_size=${pageSize}`,
      `freelist_count=${freelistCount}`,
    ],
  });

  return findings;
}

function schemaChecks(db: DiagnosticDb): BudgetDiagnostic[] {
  const findings: BudgetDiagnostic[] = [];

  for (const table of EXPECTED_TABLES) {
    if (!db.objectExists(table, "table")) {
      findings.push({
        code: "SCHEMA_MISSING_TABLE",
        severity: "warning",
        title: "Expected table is missing",
        message: `Expected table ${table} was not found in the snapshot.`,
        table,
      });
      continue;
    }
    if (rowCount(db, table) === 0) {
      findings.push({
        code: "SCHEMA_EMPTY_OBJECT",
        severity: "info",
        title: "Table has zero rows",
        message: `${table} exists but has no rows.`,
        table,
      });
    }
  }

  for (const view of EXPECTED_VIEWS) {
    if (!db.objectExists(view, "view")) {
      findings.push({
        code: "SCHEMA_MISSING_VIEW",
        severity: "warning",
        title: "Expected view is missing",
        message: `Expected view ${view} was not found in the snapshot.`,
        table: view,
      });
      continue;
    }
    if (rowCount(db, view) === 0) {
      findings.push({
        code: "SCHEMA_EMPTY_OBJECT",
        severity: "info",
        title: "View has zero rows",
        message: `${view} exists but returns no rows.`,
        table: view,
      });
    }
  }

  for (const [object, expectedColumns] of Object.entries(EXPECTED_COLUMNS)) {
    if (!db.objectExists(object)) continue;
    const actual = new Set(db.getColumns(object));
    const missing = expectedColumns.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      findings.push({
        code: "SCHEMA_MISSING_COLUMNS",
        severity: "warning",
        title: "Expected columns are missing",
        message: `${object} is missing ${missing.length} expected column${missing.length === 1 ? "" : "s"}.`,
        table: object,
        details: missing,
      });
    }
  }

  findings.push({
    code: "SCHEMA_PENDING_TXN_ACCT_TYPE",
    severity: "info",
    title: "Pending transaction account type differs from accounts.id",
    message:
      "pending_transactions.acct is declared INTEGER while accounts.id is TEXT in the reference DDL.",
    table: "pending_transactions",
    relatedTable: "accounts",
  });
  findings.push({
    code: "SCHEMA_TRANSACTION_CASE_COLUMNS",
    severity: "info",
    title: "Transaction column casing differs between table and views",
    message:
      "transactions uses isParent/isChild while v_transactions_internal exposes is_parent/is_child.",
    table: "transactions",
    relatedTable: "v_transactions_internal",
  });

  return findings;
}

function relationshipChecks(db: DiagnosticDb): BudgetDiagnostic[] {
  const findings: BudgetDiagnostic[] = [];

  for (const check of RELATIONSHIPS.filter((relationship) => relationship.kind === "raw")) {
    const fromObject = check.from.object;
    const fromColumn = check.from.column;
    const toTable = check.to.table;
    const toColumn = check.to.column;

    if (!db.objectExists(fromObject, "table") || !db.objectExists(toTable, "table")) {
      continue;
    }
    if (!hasColumn(db, fromObject, fromColumn)) continue;
    if (!hasColumn(db, toTable, toColumn)) continue;
    const rowIdColumn = hasColumn(db, fromObject, "id") ? "id" : fromColumn;

    const leftTombstone = hasColumn(db, fromObject, "tombstone")
      ? ` AND IFNULL(l.${quoteIdentifier("tombstone")}, 0) = 0`
      : "";
    const rightTombstone = hasColumn(db, toTable, "tombstone")
      ? ` AND IFNULL(r.${quoteIdentifier("tombstone")}, 0) = 0`
      : "";
    const extra = check.skipWhere ? ` AND ${check.skipWhere}` : "";
    const rows = db.selectRows<{ rowId: string; relatedId: string }>(
      `SELECT l.${quoteIdentifier(rowIdColumn)} AS rowId, l.${quoteIdentifier(fromColumn)} AS relatedId
       FROM ${quoteIdentifier(fromObject)} l
       LEFT JOIN ${quoteIdentifier(toTable)} r
         ON l.${quoteIdentifier(fromColumn)} = r.${quoteIdentifier(toColumn)}${rightTombstone}
       WHERE l.${quoteIdentifier(fromColumn)} IS NOT NULL${leftTombstone}${extra}
         AND r.${quoteIdentifier(toColumn)} IS NULL
       LIMIT 100`
    );

    for (const row of rows) {
      const message =
        check.severity === "info"
          ? `${fromObject}.${fromColumn} contains a stale raw reference to ${toTable}.${toColumn}.`
          : `${fromObject}.${fromColumn} references a missing ${toTable}.${toColumn}.`;

      findings.push({
        code: check.code,
        severity: check.severity,
        title: check.title,
        message,
        table: fromObject,
        rowId: String(row.rowId),
        relatedTable: toTable,
        relatedId: String(row.relatedId),
      });
    }
  }

  return findings;
}

function noteRelationshipChecks(db: DiagnosticDb): BudgetDiagnostic[] {
  if (!db.objectExists("notes", "table")) return [];
  const findings: BudgetDiagnostic[] = [];
  const rows = db.selectRows<{ id: string }>("SELECT id FROM notes");

  for (const row of rows) {
    const match = NOTE_ID_PATTERN.exec(String(row.id));
    if (!match) continue;
    const [, kind, entityId] = match;
    const table =
      kind === "account"
        ? "accounts"
        : kind === "category"
          ? "categories"
          : kind === "payee"
            ? "payees"
            : "schedules";
    if (!entityExists(db, table, entityId)) {
      findings.push({
        code: "REL_NOTE_ORPHAN_ENTITY",
        severity: "warning",
        title: "Note references a missing entity",
        message: `Note ${row.id} appears to reference a missing ${kind}.`,
        table: "notes",
        rowId: String(row.id),
        relatedTable: table,
        relatedId: entityId,
      });
    }
  }

  return findings;
}

function isValidDateString(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!Number.isNaN(Date.parse(value))) return true;
  const isoPrefix = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)-/.exec(value);
  return Boolean(isoPrefix && !Number.isNaN(Date.parse(isoPrefix[1])));
}

function snapshotChecks(metadata: MetadataJson | null): BudgetDiagnostic[] {
  const findings: BudgetDiagnostic[] = [];

  if (!metadata) {
    return [
      {
        code: "SNAPSHOT_METADATA_MISSING",
        severity: "warning",
        title: "metadata.json is missing",
        message: "The export ZIP did not include metadata.json.",
      },
    ];
  }

  const identifiers: Array<[keyof MetadataJson, string]> = [
    ["id", "internal budget id"],
    ["budgetName", "budget name"],
    ["cloudFileId", "cloud file id"],
    ["groupId", "group id"],
    ["userId", "user id"],
  ];
  const missing = identifiers
    .filter(([key]) => !metadata[key])
    .map(([, label]) => label);
  if (missing.length > 0) {
    findings.push({
      code: "SNAPSHOT_METADATA_IDENTIFIERS",
      severity: "warning",
      title: "Snapshot metadata identifiers are missing",
      message: `metadata.json is missing ${missing.join(", ")}.`,
      details: missing,
    });
  }

  const dateFields: Array<keyof MetadataJson> = [
    "lastUploaded",
    "lastSyncedTimestamp",
    "lastScheduleRun",
  ];
  for (const field of dateFields) {
    const value = metadata[field];
    if (value && !isValidDateString(value)) {
      findings.push({
        code: "SNAPSHOT_METADATA_DATE",
        severity: "warning",
        title: "Snapshot metadata date is malformed",
        message: `${field} is not a parseable date.`,
        details: [String(value)],
      });
    }
  }

  if (
    isValidDateString(metadata.lastScheduleRun) &&
    isValidDateString(metadata.lastUploaded) &&
    Date.parse(metadata.lastScheduleRun ?? "") < Date.parse(metadata.lastUploaded ?? "")
  ) {
    findings.push({
      code: "SNAPSHOT_SCHEDULE_BEFORE_UPLOAD",
      severity: "info",
      title: "Last schedule run predates last upload",
      message: "lastScheduleRun is earlier than lastUploaded in metadata.json.",
    });
  }

  return findings;
}

export function runDiagnosticChecks(
  db: DiagnosticDb,
  metadata: MetadataJson | null
): BudgetDiagnostic[] {
  return [
    ...sqliteChecks(db),
    ...schemaChecks(db),
    ...relationshipChecks(db),
    ...noteRelationshipChecks(db),
    ...snapshotChecks(metadata),
  ];
}

export function runIntegrityCheck(db: DiagnosticDb): BudgetDiagnostic[] {
  const result = asString(db.selectValue("PRAGMA integrity_check"));
  if (result.toLowerCase() === "ok") {
    return [
      {
        code: "SQLITE_INTEGRITY_CHECK",
        severity: "info",
        title: "SQLite full integrity check passed",
        message: "PRAGMA integrity_check returned ok.",
      },
    ];
  }
  return [
    {
      code: "SQLITE_INTEGRITY_CHECK",
      severity: "error",
      title: "SQLite full integrity check failed",
      message: result || "PRAGMA integrity_check returned a non-ok result.",
    },
  ];
}
