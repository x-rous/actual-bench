import type {
  ColumnInfo,
  FetchRowsPayload,
  IndexInfo,
  LookupRowPayload,
  RowKeyInfo,
  SchemaObjectDetails,
  SchemaObjectGroup,
  SchemaObjectSummary,
  SchemaObjectType,
  TableCountsPayload,
} from "../types";
import { FEATURED_VIEWS } from "./expectedSchema";
import { assertDirection, assertKnownIdentifier, quoteIdentifier } from "./sqlIdentifier";

export type SchemaDb = {
  selectValue: (sql: string) => unknown;
  selectRows: <T extends Record<string, unknown>>(sql: string) => T[];
};

type SqliteSchemaRow = {
  name: string;
  type: SchemaObjectType;
  tbl_name?: string | null;
  sql?: string | null;
};

type TableInfoRow = {
  cid?: number;
  name?: string;
  type?: string | null;
  notnull?: number;
  dflt_value?: unknown;
  pk?: number;
};

type IndexListRow = {
  name?: string;
  unique?: number;
  origin?: string | null;
  partial?: number;
};

const SCHEMA_OBJECT_TYPES: readonly SchemaObjectType[] = [
  "table",
  "view",
  "index",
  "trigger",
];
const MAX_FETCH_LIMIT = 1000;
const FEATURED_VIEW_SET = new Set<string>(FEATURED_VIEWS);
const CORE_TABLES = new Set([
  "accounts",
  "category_groups",
  "categories",
  "payees",
  "transactions",
  "schedules",
  "rules",
  "tags",
  "notes",
]);
const MAPPING_TABLES = new Set(["category_mapping", "payee_mapping"]);
const BUDGET_TABLES = new Set([
  "reflect_budgets",
  "zero_budgets",
  "zero_budget_months",
  "created_budgets",
]);
const SYSTEM_METADATA_TABLES = new Set([
  "__meta__",
  "__migrations__",
  "preferences",
  "messages_clock",
  "messages_crdt",
  "kvcache",
  "kvcache_key",
]);
const REPORTING_DASHBOARD_TABLES = new Set([
  "custom_reports",
  "dashboard",
  "dashboard_pages",
  "transaction_filters",
]);
const KNOWN_KEY_COLUMNS = ["schedule_id", "month", "key"] as const;

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function normalizeObjectType(value: unknown): SchemaObjectType | null {
  return typeof value === "string" && SCHEMA_OBJECT_TYPES.includes(value as SchemaObjectType)
    ? (value as SchemaObjectType)
    : null;
}

function listSchemaRows(db: SchemaDb): SqliteSchemaRow[] {
  return db
    .selectRows<SqliteSchemaRow>(
      `SELECT name, type, tbl_name, sql
       FROM sqlite_schema
       WHERE type IN ('table','view','index','trigger')
         AND name NOT LIKE 'sqlite_%'
       ORDER BY
         CASE type
           WHEN 'view' THEN 0
           WHEN 'table' THEN 1
           WHEN 'index' THEN 2
           ELSE 3
         END,
         name`
    )
    .map((row) => {
      const type = normalizeObjectType(row.type);
      if (!type) throw new Error(`Unsupported schema object type: ${String(row.type)}`);
      return {
        name: String(row.name),
        type,
        tbl_name: row.tbl_name === undefined || row.tbl_name === null ? null : String(row.tbl_name),
        sql: row.sql === undefined || row.sql === null ? null : String(row.sql),
      };
    });
}

function getSchemaRow(db: SchemaDb, name: string): SqliteSchemaRow {
  const row = listSchemaRows(db).find((schemaRow) => schemaRow.name === name);
  if (!row) throw new Error(`Unknown schema object: ${name}`);
  return row;
}

function getKnownObjectNames(db: SchemaDb): string[] {
  return listSchemaRows(db).map((row) => row.name);
}

function objectSupportsRows(type: SchemaObjectType): boolean {
  return type === "table" || type === "view";
}

function countRows(db: SchemaDb, object: string, type: SchemaObjectType): number | null {
  if (!objectSupportsRows(type)) return null;
  const value = db.selectValue(`SELECT COUNT(*) FROM ${quoteIdentifier(object)}`);
  return toNumber(value);
}

function getGroup(name: string, type: SchemaObjectType): SchemaObjectGroup {
  if (FEATURED_VIEW_SET.has(name)) return "featuredViews";
  if (type !== "table") return "other";
  if (CORE_TABLES.has(name)) return "coreTables";
  if (MAPPING_TABLES.has(name)) return "mappingTables";
  if (BUDGET_TABLES.has(name)) return "budgetTables";
  if (SYSTEM_METADATA_TABLES.has(name)) return "systemMetadata";
  if (REPORTING_DASHBOARD_TABLES.has(name)) return "reportingDashboard";
  return "other";
}

export function listSchemaObjects(db: SchemaDb): SchemaObjectSummary[] {
  return listSchemaRows(db).map((row) => ({
    name: row.name,
    type: row.type,
    rowCount: countRows(db, row.name, row.type),
    featured: FEATURED_VIEW_SET.has(row.name),
    group: getGroup(row.name, row.type),
  }));
}

export function getColumns(db: SchemaDb, object: string): ColumnInfo[] {
  assertKnownIdentifier(object, getKnownObjectNames(db), "schema object");
  const rows = db.selectRows<TableInfoRow>(`PRAGMA table_info(${quoteIdentifier(object)})`);
  return rows.map((row) => ({
    cid: toNumber(row.cid),
    name: String(row.name ?? ""),
    type: row.type === undefined || row.type === null ? "" : String(row.type),
    notNull: toNumber(row.notnull) === 1,
    defaultValue: row.dflt_value ?? null,
    primaryKeyPosition: toNumber(row.pk),
  }));
}

function getIndexes(db: SchemaDb, object: string, type: SchemaObjectType): IndexInfo[] {
  if (type !== "table") return [];
  return db
    .selectRows<IndexListRow>(`PRAGMA index_list(${quoteIdentifier(object)})`)
    .map((row) => ({
      name: String(row.name ?? ""),
      unique: toNumber(row.unique) === 1,
      origin: row.origin === undefined || row.origin === null ? null : String(row.origin),
      partial: toNumber(row.partial) === 1,
    }));
}

function canReadRowid(db: SchemaDb, object: string, type: SchemaObjectType): boolean {
  if (type !== "table") return false;
  try {
    db.selectRows(`SELECT rowid FROM ${quoteIdentifier(object)} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

export function inferRowKey(
  db: SchemaDb,
  object: string,
  type: SchemaObjectType,
  columns: readonly ColumnInfo[]
): RowKeyInfo | null {
  const primaryKey = columns
    .filter((column) => column.primaryKeyPosition > 0)
    .sort((a, b) => a.primaryKeyPosition - b.primaryKeyPosition)[0];
  if (primaryKey) return { column: primaryKey.name, source: "primaryKey" };

  const columnNames = new Set(columns.map((column) => column.name));
  const knownKey = KNOWN_KEY_COLUMNS.find((column) => columnNames.has(column));
  if (knownKey) return { column: knownKey, source: "knownKey" };

  return canReadRowid(db, object, type) ? { column: "rowid", source: "rowid" } : null;
}

export function getSchemaObject(db: SchemaDb, name: string): SchemaObjectDetails {
  const row = getSchemaRow(db, name);
  const columns = getColumns(db, row.name);
  return {
    name: row.name,
    type: row.type,
    tableName: row.tbl_name ?? null,
    sql: row.sql ?? null,
    columns,
    indexes: getIndexes(db, row.name, row.type),
    rowCount: countRows(db, row.name, row.type),
    rowKey: inferRowKey(db, row.name, row.type, columns),
  };
}

export function tableCounts(db: SchemaDb, names: readonly string[]): TableCountsPayload {
  const rows = listSchemaRows(db);
  const objectByName = new Map(rows.map((row) => [row.name, row]));
  const counts: Record<string, number | null> = {};

  for (const name of names) {
    const row = objectByName.get(name);
    if (!row) throw new Error(`Unknown schema object: ${name}`);
    counts[name] = countRows(db, row.name, row.type);
  }

  return { counts };
}

function validateFetchLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FETCH_LIMIT) {
    throw new Error(`Invalid fetchRows limit: ${limit}`);
  }
  return limit;
}

function validateOffset(offset: number): number {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Invalid fetchRows offset: ${offset}`);
  }
  return offset;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid SQL literal: ${String(value)}`);
    return String(value);
  }
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Uint8Array) {
    throw new Error("Binary values cannot be used as row lookup keys");
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function fetchRows(
  db: SchemaDb,
  request: {
    object: string;
    offset: number;
    limit: number;
    orderBy?: string;
    direction?: "asc" | "desc";
  }
): FetchRowsPayload {
  const row = getSchemaRow(db, request.object);
  if (!objectSupportsRows(row.type)) {
    throw new Error(`Schema object is not row-browsable: ${request.object}`);
  }

  const offset = validateOffset(request.offset);
  const limit = validateFetchLimit(request.limit);
  const direction = assertDirection(request.direction);
  const columns = getColumns(db, row.name);
  const columnNames = columns.map((column) => column.name);
  const orderBy = request.orderBy
    ? assertKnownIdentifier(request.orderBy, columnNames, "sort column")
    : null;
  const orderClause = orderBy
    ? ` ORDER BY ${quoteIdentifier(orderBy)} ${direction}`
    : "";
  const rowCount = countRows(db, row.name, row.type) ?? 0;
  const rows = db.selectRows<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdentifier(row.name)}${orderClause} LIMIT ${limit} OFFSET ${offset}`
  );

  return {
    object: row.name,
    columns: columnNames,
    rows,
    offset,
    limit,
    rowCount,
  };
}

export function lookupRow(
  db: SchemaDb,
  request: {
    object: string;
    keyValue: unknown;
    keyColumn?: string;
  }
): LookupRowPayload {
  const schemaRow = getSchemaRow(db, request.object);
  if (!objectSupportsRows(schemaRow.type)) {
    throw new Error(`Schema object is not row-browsable: ${request.object}`);
  }

  const columns = getColumns(db, schemaRow.name);
  const rowKey = inferRowKey(db, schemaRow.name, schemaRow.type, columns);
  const keyColumn = request.keyColumn ?? rowKey?.column;
  if (!keyColumn) {
    throw new Error(`No row key available for schema object: ${request.object}`);
  }

  const columnNames = columns.map((column) => column.name);
  if (keyColumn === "rowid") {
    if (!rowKey || rowKey.source !== "rowid") {
      throw new Error(`Unknown lookup column: ${keyColumn}`);
    }
  } else {
    assertKnownIdentifier(keyColumn, columnNames, "lookup column");
  }

  const rows = db.selectRows<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdentifier(schemaRow.name)} WHERE ${quoteIdentifier(keyColumn)} = ${sqlLiteral(request.keyValue)} LIMIT 1`
  );

  return {
    object: schemaRow.name,
    objectType: schemaRow.type,
    columns: columnNames,
    row: rows[0] ?? null,
    keyColumn,
    keyValue: request.keyValue,
    rowKey,
  };
}
