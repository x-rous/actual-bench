declare module "@sqlite.org/sqlite-wasm" {
  export type SqliteWasmDb = {
    close: () => void;
    exec: (sqlOrOptions: string | { sql: string; rowMode?: string; resultRows?: unknown[] }) => unknown;
    selectValue: (sql: string) => unknown;
  };

  export type SqliteWasmApi = {
    oo1: {
      DB: new (filename?: string, flags?: string, vfs?: string | null) => SqliteWasmDb;
    };
    capi: {
      sqlite3_js_vfs_create_file: (
        vfs: string | number | null,
        filename: string,
        data: Uint8Array,
        dataLen?: number
      ) => void;
      sqlite3_vfs_find: (name: string | null) => number;
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
