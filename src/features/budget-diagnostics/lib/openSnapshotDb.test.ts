import type { SqliteWasmApi, SqliteWasmDb } from "@sqlite.org/sqlite-wasm";
import { openSnapshotDb } from "./openSnapshotDb";

const FREEONCLOSE = 1, READONLY = 4;
const bytes = new Uint8Array([1, 2, 3, 4, 5]);

function fake(options: { deserializeRc?: number; constructFails?: boolean } = {}) {
  const events: string[] = [];
  const database = {
    pointer: 4242,
    close: jest.fn(() => { events.push("close"); }),
    checkRc: jest.fn((rc: number) => { if (rc !== 0) throw new Error(`rc ${rc}`); return database; }),
  } as unknown as SqliteWasmDb;
  const deserialize = jest.fn((...args: number[]) => { events.push(`deserialize ${args[3]} ${args[4]} ${args[5]}`); return options.deserializeRc ?? 0; });
  const sqlite3 = {
    oo1: { DB: function () { if (options.constructFails) throw new Error("no connection"); return database; } },
    wasm: { allocFromTypedArray: jest.fn(() => { events.push("alloc"); return 7000; }), dealloc: jest.fn((pointer: number) => { events.push(`dealloc ${pointer}`); }) },
    capi: { sqlite3_deserialize: deserialize, SQLITE_DESERIALIZE_FREEONCLOSE: FREEONCLOSE, SQLITE_DESERIALIZE_READONLY: READONLY },
  } as unknown as SqliteWasmApi;
  return { sqlite3, database, events, deserialize };
}

describe("opening a budget snapshot", () => {
  it("deserializes the bytes read-only into a new connection and hands the copy to SQLite", () => {
    const { sqlite3, database, events, deserialize } = fake();
    expect(openSnapshotDb(sqlite3, bytes)).toBe(database);
    expect(events).toEqual(["alloc", "deserialize 5 5 5"]);
    expect(deserialize).toHaveBeenCalledWith(4242, "main", 7000, 5, 5, FREEONCLOSE | READONLY);
    expect(sqlite3.wasm.dealloc).not.toHaveBeenCalled();
  });

  it("closes the connection and does not free the copy again when SQLite refuses it, because SQLite has freed it", () => {
    const { sqlite3, database, events } = fake({ deserializeRc: 11 });
    expect(() => openSnapshotDb(sqlite3, bytes)).toThrow("rc 11");
    expect(database.close).toHaveBeenCalledTimes(1);
    expect(events).not.toContain("dealloc 7000");
  });

  it("frees the copy itself when no connection can be made", () => {
    const { sqlite3, deserialize, events } = fake({ constructFails: true });
    expect(() => openSnapshotDb(sqlite3, bytes)).toThrow("no connection");
    expect(events).toEqual(["alloc", "dealloc 7000"]);
    expect(deserialize).not.toHaveBeenCalled();
  });
});
