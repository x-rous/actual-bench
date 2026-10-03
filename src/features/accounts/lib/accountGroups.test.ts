import type { StagedEntity, StagedMap } from "@/types/staged";
import type { Account, AccountGroup } from "@/types/entities";
import { groupLabel, groupMemberCounts, liveGroups, validateGroupName } from "./accountGroups";

function staged<T extends { id: string }>(entity: T, over: Partial<StagedEntity<T>> = {}): StagedEntity<T> {
  return { entity, original: entity, isNew: false, isUpdated: false, isDeleted: false, validationErrors: {}, ...over };
}
const groups = (...gs: StagedEntity<AccountGroup>[]): StagedMap<AccountGroup> =>
  Object.fromEntries(gs.map((g) => [g.entity.id, g]));

describe("validateGroupName", () => {
  const map = groups(
    staged({ id: "g1", name: "Everyday" }),
    staged({ id: "g2", name: "Gone" }, { isDeleted: true })
  );

  it("requires a name", () => {
    expect(validateGroupName("   ", map)).toBe("Name is required");
  });

  it("rejects a duplicate ignoring case and surrounding space", () => {
    expect(validateGroupName("  everyday ", map)).toMatch(/already exists/);
  });

  it("lets a group keep its own name and reuse the name of a deleted group", () => {
    expect(validateGroupName("Everyday", map, "g1")).toBeNull();
    expect(validateGroupName("Gone", map)).toBeNull();
  });

  it("rejects a name over the limit", () => {
    expect(validateGroupName("x".repeat(101), map)).toMatch(/exceed/);
  });
});

describe("liveGroups / groupLabel", () => {
  const map = groups(
    staged({ id: "g2", name: "savings" }),
    staged({ id: "g1", name: "Banking" }),
    staged({ id: "g3", name: "Deleted" }, { isDeleted: true })
  );

  it("lists non-deleted groups sorted by name", () => {
    expect(liveGroups(map).map((g) => g.name)).toEqual(["Banking", "savings"]);
  });

  it("labels a missing or deleted group as no group", () => {
    const live = liveGroups(map);
    expect(groupLabel("g1", live)).toBe("Banking");
    expect(groupLabel("g3", live)).toBe("No group");
    expect(groupLabel(null, live)).toBe("No group");
    expect(groupLabel(undefined, live)).toBe("No group");
  });
});

describe("groupMemberCounts", () => {
  it("counts live members per group and ignores deleted and ungrouped accounts", () => {
    const acc = (id: string, groupId: string | null, over: Partial<StagedEntity<Account>> = {}) =>
      staged<Account>({ id, name: id, offBudget: false, closed: false, groupId }, over);
    const map: StagedMap<Account> = Object.fromEntries(
      [acc("a", "g1"), acc("b", "g1"), acc("c", "g2", { isDeleted: true }), acc("d", null)].map((e) => [e.entity.id, e])
    );
    expect([...groupMemberCounts(map)]).toEqual([["g1", 2]]);
  });
});
