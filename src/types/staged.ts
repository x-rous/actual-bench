import type { BaseEntity } from "./entities";
import type { AccountClass } from "@/lib/account-class";

/**
 * Wraps any entity with staging metadata.
 * The original field holds the server snapshot; the entity field holds the current (possibly edited) version.
 */
export type StagedEntity<T extends BaseEntity> = {
  entity: T;
  /** Immutable snapshot from the server — used by the diff engine */
  original: T | null;
  isNew: boolean;
  isUpdated: boolean;
  isDeleted: boolean;
  /** Per-field validation errors keyed by field name */
  validationErrors: Record<string, string>;
  /** Error returned by the API on the last save attempt */
  saveError?: string;
  /** Account rows only: Bench metadata staged until creation returns a real id, or awaiting a retry. Never sent to Actual. */
  pendingAccountClass?: AccountClass | null;
};

export type StagedMap<T extends BaseEntity> = Record<string, StagedEntity<T>>;

/** The full staged state across all entity types */
export type StagedState = {
  accounts: StagedMap<import("./entities").Account>;
  payees: StagedMap<import("./entities").Payee>;
  categoryGroups: StagedMap<import("./entities").CategoryGroup>;
  categories: StagedMap<import("./entities").Category>;
  rules: StagedMap<import("./entities").Rule>;
  schedules: StagedMap<import("./entities").Schedule>;
};
