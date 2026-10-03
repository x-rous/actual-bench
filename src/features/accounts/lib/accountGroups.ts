import type { StagedMap } from "@/types/staged";
import type { Account, AccountGroup } from "@/types/entities";

/** Select value for "no group". Real group ids are UUIDs, so this cannot collide. */
export const NO_GROUP = "__no_group__";
/** Select value that opens the "new group" dialog instead of assigning. */
export const NEW_GROUP = "__new_group__";

export const GROUP_NAME_MAX = 100;

/** Groups that will exist after Save: everything not staged for deletion, by name. */
export function liveGroups(staged: StagedMap<AccountGroup>): AccountGroup[] {
  return Object.values(staged)
    .filter((entry) => !entry.isDeleted)
    .map((entry) => entry.entity)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/**
 * Validates a group name the way Actual does: required, and unique among live
 * groups ignoring case. `exceptId` skips the group being renamed.
 * Returns an error message, or null when the name is fine.
 */
export function validateGroupName(
  name: string,
  staged: StagedMap<AccountGroup>,
  exceptId?: string
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Name is required";
  if (trimmed.length > GROUP_NAME_MAX) return `Name cannot exceed ${GROUP_NAME_MAX} characters`;
  const key = trimmed.toLowerCase();
  const clash = liveGroups(staged).some((g) => g.id !== exceptId && g.name.trim().toLowerCase() === key);
  return clash ? "A group with this name already exists" : null;
}

/** Live (not deleted) accounts per group id. Ungrouped accounts are not counted. */
export function groupMemberCounts(staged: StagedMap<Account>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of Object.values(staged)) {
    if (entry.isDeleted || !entry.entity.groupId) continue;
    counts.set(entry.entity.groupId, (counts.get(entry.entity.groupId) ?? 0) + 1);
  }
  return counts;
}

/**
 * The label for an account's group cell. A group id that matches no live group
 * (deleted in this draft, or not loaded) reads as ungrouped rather than leaking
 * an id.
 */
export function groupLabel(groupId: string | null | undefined, groups: AccountGroup[]): string {
  if (!groupId) return "No group";
  return groups.find((g) => g.id === groupId)?.name ?? "No group";
}
