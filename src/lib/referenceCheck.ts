/**
 * Pure utilities for counting rule references to entities.
 * No React, no hooks — safe to use in useMemo, plain functions, and tests.
 */

import type { StagedMap } from "@/types/staged";
import type { Rule } from "@/types/entities";

/**
 * Builds a Map<entityId, referenceCount> by scanning all non-deleted staged
 * rules for conditions and actions that reference entity IDs via the given
 * field names.
 *
 * Use this in useMemo blocks where counts for all entities of a type are
 * needed at once (table rendering, filter logic).
 *
 * Field arrays per entity type:
 *   Accounts:   ["account"]
 *   Categories: ["category"]
 *   Payees:     ["payee", "imported_payee"]
 */
export function buildRuleReferenceMap(
  stagedRules: StagedMap<Rule>,
  fields: string[]
): Map<string, number> {
  const fieldSet = new Set(fields);
  const counts = new Map<string, number>();

  for (const s of Object.values(stagedRules)) {
    if (s.isDeleted) continue;
    for (const part of [...s.entity.conditions, ...s.entity.actions]) {
      if (!part.field || !fieldSet.has(part.field)) continue;
      const ids = Array.isArray(part.value) ? part.value : [part.value];
      for (const id of ids) {
        if (typeof id === "string" && id) {
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
      }
    }
  }

  return counts;
}

