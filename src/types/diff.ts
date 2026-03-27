import type { BaseEntity } from "./entities";

/** Output of the diff engine for a single entity type */
export type EntityDiff<T extends BaseEntity> = {
  create: T[];
  update: T[];
  delete: string[];
};

/** Aggregated diff across all entity types before a save */
export type StagedDiff = {
  accounts: EntityDiff<import("./entities").Account>;
  payees: EntityDiff<import("./entities").Payee>;
  categoryGroups: EntityDiff<import("./entities").CategoryGroup>;
  categories: EntityDiff<import("./entities").Category>;
  rules: EntityDiff<import("./entities").Rule>;
  schedules: EntityDiff<import("./entities").Schedule>;
};

/** Per-row result returned after executing a save */
export type SaveResult =
  | { status: "success"; id: string }
  | { status: "error"; id: string; message: string };

export type SaveSummary = {
  succeeded: SaveResult[];
  failed: SaveResult[];
  /** Maps client-generated UUIDs to server-assigned IDs for newly created entities */
  idMap: Record<string, string>;
};
