import type { SchemaObjectType } from "../types";
import {
  createExportRowsCursor,
  exportRowsBeginPayload,
  fetchRows,
  getSchemaObject,
  inferRowKey,
  listSchemaObjects,
  lookupRow,
  readExportRowsChunk,
  tableCounts,
  type SchemaDb,
} from "./schemaObjects";
import { assertDirection, quoteIdentifier } from "./sqlIdentifier";

type Row = Record<string, unknown>;
type FakeObject = {
  name: string;
  type: SchemaObjectType;
  tableName?: string | null;
  sql: string | null;
  columns: Array<{ name: string; type?: string; pk?: number }>;
  rows: Row[];
  indexes?: Array<{ name: string; unique?: number; origin?: string; partial?: number }>;
  supportsRowid?: boolean;
  countError?: string;
};

class FakeSchemaDb implements SchemaDb {
  private readonly objects = new Map<string, FakeObject>();

  addObject(object: FakeObject) {
    this.objects.set(object.name, object);
  }

  selectValue(sql: string): unknown {
    const countMatch = /SELECT COUNT\(\*\) FROM "([^"]+)"/.exec(sql);
    if (countMatch) {
      const object = this.objects.get(countMatch[1]);
      if (object?.countError) throw new Error(object.countError);
      return object?.rows.length ?? 0;
    }
    return null;
  }

  selectRows<T extends Row>(sql: string): T[] {
    if (sql.includes("FROM sqlite_schema")) {
      return [...this.objects.values()]
        .map((object) => ({
          name: object.name,
          type: object.type,
          tbl_name: object.tableName ?? object.name,
          sql: object.sql,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)) as unknown as T[];
    }

    const tableInfoMatch = /PRAGMA table_info\("([^"]+)"\)/.exec(sql);
    if (tableInfoMatch) {
      const object = this.objects.get(tableInfoMatch[1]);
      return (object?.columns ?? []).map((column, cid) => ({
        cid,
        name: column.name,
        type: column.type ?? "",
        notnull: 0,
        dflt_value: null,
        pk: column.pk ?? 0,
      })) as unknown as T[];
    }

    const indexListMatch = /PRAGMA index_list\("([^"]+)"\)/.exec(sql);
    if (indexListMatch) {
      return (this.objects.get(indexListMatch[1])?.indexes ?? []) as unknown as T[];
    }

    const rowidMatch = /SELECT rowid FROM "([^"]+)" LIMIT 1/.exec(sql);
    if (rowidMatch) {
      const object = this.objects.get(rowidMatch[1]);
      if (!object?.supportsRowid) throw new Error("rowid unavailable");
      return [] as T[];
    }

    const selectMatch = /SELECT \* FROM "([^"]+)"(?: ORDER BY "([^"]+)" (asc|desc))? LIMIT ([0-9]+) OFFSET ([0-9]+)/.exec(sql);
    if (selectMatch) {
      const [, objectName, orderBy, direction, limitValue, offsetValue] = selectMatch;
      const object = this.objects.get(objectName);
      const rows = [...(object?.rows ?? [])];
      if (orderBy) {
        rows.sort((a, b) => {
          const left = String(a[orderBy] ?? "");
          const right = String(b[orderBy] ?? "");
          return direction === "desc" ? right.localeCompare(left) : left.localeCompare(right);
        });
      }
      const offset = Number(offsetValue);
      const limit = Number(limitValue);
      return rows.slice(offset, offset + limit) as T[];
    }

    const lookupMatch = /SELECT \* FROM "([^"]+)" WHERE "([^"]+)" = (.+) LIMIT 1/.exec(sql);
    if (lookupMatch) {
      const [, objectName, keyColumn, rawValue] = lookupMatch;
      const object = this.objects.get(objectName);
      const value = rawValue.startsWith("'")
        ? rawValue.slice(1, -1).replaceAll("''", "'")
        : Number(rawValue);
      return (object?.rows.filter((row) => row[keyColumn] === value).slice(0, 1) ?? []) as T[];
    }

    return [];
  }
}

function buildDb() {
  const db = new FakeSchemaDb();
  db.addObject({
    name: "v_transactions",
    type: "view",
    sql: "CREATE VIEW v_transactions AS SELECT * FROM transactions",
    columns: [
      { name: "id", type: "TEXT" },
      { name: "date", type: "INTEGER" },
      { name: "payee", type: "TEXT" },
    ],
    rows: [
      { id: "tx-2", date: 20260402, payee: "payee-2" },
      { id: "tx-1", date: 20260401, payee: "payee-1" },
    ],
  });
  db.addObject({
    name: "transactions",
    type: "table",
    sql: "CREATE TABLE transactions (id TEXT PRIMARY KEY, date INTEGER)",
    columns: [
      { name: "id", type: "TEXT", pk: 1 },
      { name: "date", type: "INTEGER" },
    ],
    rows: [{ id: "tx-1", date: 20260401 }],
    indexes: [{ name: "transactions_id_idx", unique: 1, origin: "pk", partial: 0 }],
    supportsRowid: true,
  });
  db.addObject({
    name: "schedules_json_paths",
    type: "table",
    sql: "CREATE TABLE schedules_json_paths (schedule_id TEXT)",
    columns: [{ name: "schedule_id", type: "TEXT" }],
    rows: [{ schedule_id: "schedule-1" }],
    supportsRowid: false,
  });
  db.addObject({
    name: "messages_crdt_row_idx",
    type: "index",
    tableName: "messages_crdt",
    sql: "CREATE INDEX messages_crdt_row_idx ON messages_crdt(row)",
    columns: [],
    rows: [],
  });
  db.addObject({
    name: "messages_crdt_ai",
    type: "trigger",
    tableName: "messages_crdt",
    sql: "CREATE TRIGGER messages_crdt_ai AFTER INSERT ON messages_crdt BEGIN SELECT 1; END",
    columns: [],
    rows: [],
  });
  return db;
}

describe("schemaObjects", () => {
  it("lists schema objects with row counts and grouping metadata", () => {
    const objects = listSchemaObjects(buildDb());

    expect(objects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "v_transactions",
          type: "view",
          rowCount: 2,
          featured: true,
          group: "featuredViews",
        }),
        expect.objectContaining({
          name: "transactions",
          type: "table",
          rowCount: 1,
          group: "coreTables",
        }),
        expect.objectContaining({
          name: "messages_crdt_row_idx",
          type: "index",
          rowCount: null,
        }),
      ])
    );
  });

  it("keeps objects with row count failures in the schema list", () => {
    const db = buildDb();
    db.addObject({
      name: "z_accounts",
      type: "view",
      sql: "CREATE VIEW z_accounts AS SELECT * FROM accounts",
      columns: [{ name: "id", type: "TEXT" }],
      rows: [{ id: "acct-1" }],
      countError: "malformed JSON",
    });

    expect(listSchemaObjects(db)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "z_accounts",
          rowCount: null,
          rowCountError: "malformed JSON",
          group: "other",
        }),
      ])
    );
    expect(getSchemaObject(db, "z_accounts")).toMatchObject({
      name: "z_accounts",
      rowCount: null,
      rowCountError: "malformed JSON",
    });
    expect(fetchRows(db, { object: "z_accounts", offset: 0, limit: 100 })).toMatchObject({
      object: "z_accounts",
      rowCount: null,
      rowCountError: "malformed JSON",
      rows: [{ id: "acct-1" }],
    });
  });

  it("returns schema object details with columns, indexes, SQL, and row key", () => {
    const details = getSchemaObject(buildDb(), "transactions");

    expect(details).toMatchObject({
      name: "transactions",
      type: "table",
      tableName: "transactions",
      sql: "CREATE TABLE transactions (id TEXT PRIMARY KEY, date INTEGER)",
      rowCount: 1,
      rowKey: { column: "id", source: "primaryKey" },
    });
    expect(details.columns.map((column) => column.name)).toEqual(["id", "date"]);
    expect(details.indexes).toEqual([
      { name: "transactions_id_idx", unique: true, origin: "pk", partial: false },
    ]);
  });

  it("returns parent table names for schema-only objects", () => {
    expect(getSchemaObject(buildDb(), "messages_crdt_row_idx")).toMatchObject({
      name: "messages_crdt_row_idx",
      type: "index",
      tableName: "messages_crdt",
      rowCount: null,
    });
  });

  it("fetches bounded, paginated rows with validated sorting", () => {
    expect(
      fetchRows(buildDb(), {
        object: "v_transactions",
        offset: 0,
        limit: 1,
        orderBy: "id",
        direction: "asc",
      })
    ).toMatchObject({
      object: "v_transactions",
      columns: ["id", "date", "payee"],
      rowCount: 2,
      rows: [{ id: "tx-1", date: 20260401, payee: "payee-1" }],
    });
  });

  it("creates worker export cursors and reads 10k-row chunks", () => {
    const db = buildDb();
    const cursor = createExportRowsCursor(
      db,
      {
        object: "v_transactions",
        orderBy: "id",
        direction: "asc",
      },
      "export-1",
      1_000
    );

    expect(exportRowsBeginPayload(cursor)).toMatchObject({
      cursorId: "export-1",
      object: "v_transactions",
      rowCount: 2,
      chunkSize: 10_000,
    });

    expect(readExportRowsChunk(db, cursor, 2_000)).toMatchObject({
      cursorId: "export-1",
      offset: 0,
      rowCount: 2,
      done: true,
      rows: [
        { id: "tx-1", date: 20260401, payee: "payee-1" },
        { id: "tx-2", date: 20260402, payee: "payee-2" },
      ],
    });
    expect(cursor.lastAccessedAt).toBe(2_000);
  });

  it("rejects unsafe row fetch input", () => {
    const db = buildDb();

    expect(() =>
      fetchRows(db, { object: "missing", offset: 0, limit: 100 })
    ).toThrow("Unknown schema object: missing");
    expect(() =>
      fetchRows(db, { object: "v_transactions", offset: -1, limit: 100 })
    ).toThrow("Invalid fetchRows offset: -1");
    expect(() =>
      fetchRows(db, { object: "v_transactions", offset: 0, limit: 1001 })
    ).toThrow("Invalid fetchRows limit: 1001");
    expect(() =>
      fetchRows(db, { object: "v_transactions", offset: 0, limit: 100, orderBy: "bad" })
    ).toThrow("Unknown sort column: bad");
    expect(() =>
      fetchRows(db, {
        object: "v_transactions",
        offset: 0,
        limit: 100,
        direction: "ASC" as "asc",
      })
    ).toThrow("Invalid sort direction: ASC");
    expect(() =>
      fetchRows(db, { object: "messages_crdt_row_idx", offset: 0, limit: 100 })
    ).toThrow("Schema object is not row-browsable: messages_crdt_row_idx");
  });

  it("returns table counts and null counts for indexes or triggers", () => {
    expect(tableCounts(buildDb(), ["transactions", "messages_crdt_ai"])).toEqual({
      counts: {
        transactions: 1,
        messages_crdt_ai: null,
      },
    });
  });

  it("looks up rows by inferred or explicit keys", () => {
    expect(
      lookupRow(buildDb(), {
        object: "transactions",
        keyValue: "tx-1",
      })
    ).toMatchObject({
      object: "transactions",
      objectType: "table",
      keyColumn: "id",
      row: { id: "tx-1", date: 20260401 },
    });

    expect(
      lookupRow(buildDb(), {
        object: "v_transactions",
        keyColumn: "payee",
        keyValue: "missing",
      })
    ).toMatchObject({
      object: "v_transactions",
      objectType: "view",
      keyColumn: "payee",
      keyValue: "missing",
      row: null,
    });
  });

  it("infers known keys and rowid fallback", () => {
    const db = buildDb();

    expect(getSchemaObject(db, "schedules_json_paths").rowKey).toEqual({
      column: "schedule_id",
      source: "knownKey",
    });
    expect(
      inferRowKey(db, "transactions", "table", [
        { cid: 0, name: "value", type: "TEXT", notNull: false, defaultValue: null, primaryKeyPosition: 0 },
      ])
    ).toEqual({ column: "rowid", source: "rowid" });
  });

  it("validates standalone identifier helpers", () => {
    expect(quoteIdentifier("v_transactions")).toBe("\"v_transactions\"");
    expect(() => quoteIdentifier("bad-name")).toThrow("Invalid SQL identifier: bad-name");
    expect(assertDirection(undefined)).toBe("asc");
    expect(assertDirection("desc")).toBe("desc");
    expect(() => assertDirection("DESC")).toThrow("Invalid sort direction: DESC");
  });
});
