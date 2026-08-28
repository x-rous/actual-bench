import type { BackupDestinationKind } from "@/lib/app-db/backupRepository";

/**
 * The destination contract (RD-077 / PR-047b).
 *
 * Every place a backup can land — a mounted volume, a bucket — is reduced to
 * the same seven operations, so the backup run in 047c never branches on where
 * it is writing and retention never branches on where it is deleting.
 *
 * The interface is deliberately smaller than any storage API. It has no rename,
 * no copy, no partial read: a backup system that needs those is a backup system
 * doing something clever, and clever is the wrong instinct here.
 */

export type StoredObject = {
  key: string;
  sizeBytes: number;
  /** ISO timestamp, when the destination reports one. */
  lastModified: string | null;
};

/** What Bench can tell the user about a destination before trusting it. */
export type DestinationFacts = {
  /** Human-readable location — a path, or `bucket/prefix`. */
  location: string;
  /** Bytes free where the destination writes, when knowable. */
  freeBytes?: number | null;
  totalBytes?: number | null;
  /** Filesystem type and device id, for local paths. */
  filesystem?: string | null;
  sameDeviceAsAppDb?: boolean | null;
};

export type DestinationCheckStatus = "pass" | "warn" | "fail";

export type DestinationCheck = {
  name: string;
  status: DestinationCheckStatus;
  detail: string;
};

export type DestinationTestResult = {
  ok: boolean;
  checks: DestinationCheck[];
  facts: DestinationFacts;
};

/** Raised for any destination-level failure; carries something a user can act on. */
export class DestinationError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message);
    this.name = "DestinationError";
    this.retryable = options.retryable ?? false;
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

export interface DestinationAdapter {
  readonly kind: BackupDestinationKind;
  readonly destinationId: string;
  readonly name: string;

  /** Write bytes at `key`, overwriting. Returns what was actually stored. */
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<StoredObject>;
  /** Read the whole object. Throws `DestinationError` when absent. */
  get(key: string): Promise<Buffer>;
  /** Metadata only, or null when the object is not there. */
  head(key: string): Promise<StoredObject | null>;
  list(prefix: string): Promise<StoredObject[]>;
  remove(key: string): Promise<void>;
  facts(): Promise<DestinationFacts>;
  /** Write, read back, compare, delete — the only honest way to test a destination. */
  test(): Promise<DestinationTestResult>;
}
