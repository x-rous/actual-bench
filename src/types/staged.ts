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
  /** Account rows only: the access and report flags of an account not yet created (or whose flag save failed), written to Bench once it has a permanent id. Never sent to Actual. */
  pendingAccountFlags?: PendingAccountFlags;
  /** Category and category-group rows only: on delete, the category that takes over their transactions and budget amounts. */
  transferCategoryId?: string | null;
  /** Account rows only: where the balance goes when the staged close is saved. */
  closeTransfer?: import("./entities").AccountCloseTransfer | null;
};

/** The saved flags a new account will get: each true flag is written once the account exists. */
export type PendingAccountFlags = { excluded: boolean; accessible: boolean; locked: boolean };

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
