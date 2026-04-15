/**
 * Shared utilities for save hooks.
 * Single source of truth — do not duplicate these per-feature.
 */

import type { BaseEntity } from "@/types/entities";
import type { StagedEntity } from "@/types/staged";

/**
 * Extract a human-readable message from an unknown thrown value.
 */
export function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err !== null && "message" in err)
    return String((err as { message: unknown }).message);
  return fallback;
}

/**
 * Partition a staged entity map into create / update / delete buckets.
 * Generic over any entity type.
 */
export function computeSaveOperations<T extends BaseEntity>(
  staged: Record<string, StagedEntity<T>>
): { toCreate: T[]; toUpdate: T[]; toDelete: string[] } {
  const toCreate: T[] = [];
  const toUpdate: T[] = [];
  const toDelete: string[] = [];

  for (const s of Object.values(staged)) {
    if (s.isNew && !s.isDeleted) toCreate.push(s.entity);
    else if (s.isDeleted && !s.isNew) toDelete.push(s.entity.id);
    else if (s.isUpdated && !s.isDeleted) toUpdate.push(s.entity);
  }

  return { toCreate, toUpdate, toDelete };
}

/**
 * Returns true when a staged entity map contains any pending create/update/delete.
 */
export function hasPendingStagedChanges<T extends BaseEntity>(
  staged: Record<string, StagedEntity<T>>
): boolean {
  return Object.values(staged).some(
    (entry) => !(entry.isNew && entry.isDeleted) && (entry.isNew || entry.isUpdated || entry.isDeleted)
  );
}
