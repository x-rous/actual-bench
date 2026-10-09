import { resolveAccountClass, type AccountClassMaps, type EffectiveAccountClass } from "@/lib/account-class";
import type { StagedMap } from "@/types/staged";
import type { Account, AccountGroup } from "@/types/entities";

/**
 * The effective class of every staged account. Group membership comes from the
 * draft, so a pending move into a group shows its effect at once. `groups` is
 * undefined on a server without account groups, where nothing is inherited.
 */
export function effectiveAccountClasses(
  staged: StagedMap<Account>,
  groups: readonly AccountGroup[] | undefined,
  maps: AccountClassMaps
): Map<string, EffectiveAccountClass> {
  const liveGroupIds = groups ? new Set(groups.map((g) => g.id)) : null;
  const result = new Map<string, EffectiveAccountClass>();
  for (const { entity } of Object.values(staged)) {
    const groupId = liveGroupIds && entity.groupId && liveGroupIds.has(entity.groupId) ? entity.groupId : null;
    result.set(entity.id, resolveAccountClass(entity.id, groupId, maps));
  }
  return result;
}
