declare module "@sqlite.org/sqlite-wasm" {
  export type SqliteWasmDb = {
    close: () => void;
    /** The C `sqlite3*` of an open database; undefined once it is closed. */
    pointer: number | undefined;
    /** Throws if `resultCode` is an error, otherwise returns the database. */
    checkRc: (resultCode: number) => SqliteWasmDb;
    exec: (sqlOrOptions: string | { sql: string; rowMode?: string; resultRows?: unknown[] }) => unknown;
    selectValue: (sql: string) => unknown;
  };

  export type SqliteWasmApi = {
    oo1: {
      DB: new (filename?: string, flags?: string, vfs?: string | null) => SqliteWasmDb;
    };
    wasm: {
      /** Copies the bytes into memory SQLite can own, and returns its pointer; free it with `dealloc` unless SQLite owns it. */
      allocFromTypedArray: (source: Uint8Array) => number;
      dealloc: (pointer: number) => void;
    };
    capi: {
      /** Replaces the database `schema` of `db` with the one serialized in the memory at `data`. */
      sqlite3_deserialize: (db: number, schema: string, data: number, dbSize: number, bufferSize: number, flags: number) => number;
      /** SQLite frees the memory when the database closes. */
      SQLITE_DESERIALIZE_FREEONCLOSE: number;
      SQLITE_DESERIALIZE_READONLY: number;
    };
  };

  export type SqliteWasmConfig = {
    locateFile?: (file: string, prefix?: string) => string;
    print?: (...args: unknown[]) => void;
    printErr?: (...args: unknown[]) => void;
  };

  export default function sqlite3InitModule(
    config?: SqliteWasmConfig
  ): Promise<SqliteWasmApi>;
}
