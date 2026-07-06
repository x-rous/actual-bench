export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export type JsonEnvelope = {
  version: number;
  data: JsonObject;
};

export type SqliteStatement = {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get<T = unknown>(...params: unknown[]): T | undefined;
  all<T = unknown>(...params: unknown[]): T[];
};

export type SqliteDatabase = {
  readonly name: string;
  readonly open: boolean;
  prepare(source: string): SqliteStatement;
  exec(source: string): unknown;
  pragma(source: string): unknown;
  transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
  close(): void;
};

export type AppDbHealth = {
  status: "ready" | "unavailable";
  ready: boolean;
  configuredPath: string;
  defaultPath: string;
  envOverride: boolean;
  writable: boolean;
  runtime: "node" | "vercel";
  durable: boolean;
  schemaVersion: number | null;
  latestSchemaVersion: number;
  createdAt: string | null;
  lastMigratedAt: string | null;
  checkedAt: string;
  error?: string;
};

export type SyncFlowLeg = {
  id: string;
  flowId: string;
  position: number;
  sourceRef: JsonEnvelope;
  targetRef: JsonEnvelope;
  filter: JsonEnvelope;
  transform: JsonEnvelope;
  options: JsonEnvelope;
  createdAt: string;
  updatedAt: string;
};

export type SyncFlow = {
  id: string;
  name: string;
  enabled: boolean;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  legs: SyncFlowLeg[];
};

export type SyncFlowRun = {
  id: string;
  flowId: string | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  summary: JsonEnvelope;
  error: JsonEnvelope | null;
};
