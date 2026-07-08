declare module "better-sqlite3" {
  class Database {
    constructor(filename: string, options?: Database.Options);

    readonly name: string;
    readonly open: boolean;

    prepare(source: string): Database.Statement;
    exec(source: string): this;
    pragma(source: string): unknown;
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
    close(): void;
  }

  namespace Database {
    type SqliteValue = string | number | bigint | Buffer | null;

    interface Options {
      readonly?: boolean;
      fileMustExist?: boolean;
      timeout?: number;
      verbose?: (message?: unknown, ...additionalArgs: unknown[]) => void;
    }

    interface RunResult {
      changes: number;
      lastInsertRowid: number | bigint;
    }

    interface Statement {
      run(...params: unknown[]): RunResult;
      get<T = unknown>(...params: unknown[]): T | undefined;
      all<T = unknown>(...params: unknown[]): T[];
    }
  }

  export = Database;
}
