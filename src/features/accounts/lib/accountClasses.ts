import { resolveAccountClass, type AccountClass, type AccountClassMaps, type EffectiveAccountClass } from "@/lib/account-class";
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
  for (const entry of Object.values(staged)) {
    const { entity } = entry;
    const groupId = liveGroupIds && entity.groupId && liveGroupIds.has(entity.groupId) ? entity.groupId : null;
    // A pending own class takes the place of the saved one before the group's precedence is applied, so a pending class that is a
    // narrower kind of the group's (a Fixed Deposit moving into a Checking group) applies, and any other still yields to the group.
    const pending = entry.pendingAccountClass;
    // A chosen class also replaces a narrower class kept from before schema 68, as saving it will (the server clears it then).
    const own = pending === undefined ? maps : { ...maps, accounts: withOwn(maps.accounts, entity.id, pending), refinements: withoutKept(maps.refinements, entity.id) };
    result.set(entity.id, resolveAccountClass(entity.id, groupId, own));
  }
  return result;
}

function withOwn(accounts: ReadonlyMap<string, AccountClass>, id: string, accountClass: AccountClass | null): Map<string, AccountClass> {
  const next = new Map(accounts);
  if (accountClass) next.set(id, accountClass); else next.delete(id);
  return next;
}

function withoutKept(refinements: ReadonlyMap<string, AccountClass> | undefined, id: string): Map<string, AccountClass> | undefined {
  if (!refinements?.has(id)) return refinements as Map<string, AccountClass> | undefined;
  const next = new Map(refinements);
  next.delete(id);
  return next;
}
