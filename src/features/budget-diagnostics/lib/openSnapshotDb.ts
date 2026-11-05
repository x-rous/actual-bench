import type { SqliteWasmApi, SqliteWasmDb } from "@sqlite.org/sqlite-wasm";

/**
 * Opens the bytes of an exported budget database as a read-only, in-memory database. The bytes are deserialized straight into the
 * connection, so no file is created in the worker's file system, nothing can be written back, and SQLite frees the copy when the
 * database is closed.
 *
 * Who frees the copy: until it is handed to `sqlite3_deserialize` it is ours, so it is freed here if no connection can be made.
 * From then on SQLite owns it with `FREEONCLOSE`, and frees it itself whether the call succeeds or fails, so a failure only needs the
 * connection closed. Freeing it again would be a double free.
 */
export function openSnapshotDb(sqlite3: SqliteWasmApi, bytes: Uint8Array): SqliteWasmDb {
  const { capi, wasm, oo1 } = sqlite3;
  const memory = wasm.allocFromTypedArray(bytes);
  let database: SqliteWasmDb;
  try {
    database = new oo1.DB();
  } catch (error) {
    wasm.dealloc(memory);
    throw error;
  }
  try {
    return database.checkRc(capi.sqlite3_deserialize(
      database.pointer as number, "main", memory, bytes.byteLength, bytes.byteLength,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_READONLY,
    ));
  } catch (error) {
    database.close();
    throw error;
  }
}
