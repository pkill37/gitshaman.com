declare module 'better-sqlite3' {
  export interface BetterSqlite3RunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface BetterSqlite3Statement {
    all(): Array<Record<string, unknown>>;
    bind(...params: unknown[]): this;
    get(...params: unknown[]): Record<string, unknown> | undefined;
    run(...params: unknown[]): BetterSqlite3RunResult;
  }

  export interface BetterSqlite3Database {
    prepare(sql: string): BetterSqlite3Statement;
    transaction<T extends (...args: never[]) => unknown>(fn: T): T;
    exec(sql: string): void;
    pragma(pragma: string): unknown;
    close(): void;
  }

  interface BetterSqlite3Options {
    readonly?: boolean;
    fileMustExist?: boolean;
  }

  const Database: {
    new (filename: string, options?: BetterSqlite3Options): BetterSqlite3Database;
  };

  export default Database;
}

declare module 'sql.js' {
  export interface SqlJsStatement {
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): void;
  }

  export interface SqlJsDatabase {
    close(): void;
    prepare(sql: string): SqlJsStatement;
  }

  export interface SqlJsStatic {
    Database: new (data?: Uint8Array) => SqlJsDatabase;
  }

  interface SqlJsConfig {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
