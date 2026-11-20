import { findRuleIssues } from "./ruleHealth";
import type { EntityMaps } from "../utils/rulePreview";
import type { Rule } from "@/types/entities";
import type { StagedEntity, StagedMap } from "@/types/staged";

function staged<T extends { id: string }>(entity: T, isDeleted = false): StagedEntity<T> {
  return { entity, original: entity, isNew: false, isUpdated: false, isDeleted, validationErrors: {} };
}

function mapOf<T extends { id: string }>(...entries: StagedEntity<T>[]): StagedMap<T> {
  return Object.fromEntries(entries.map((e) => [e.entity.id, e]));
}

const maps: EntityMaps = {
  payees: mapOf(staged({ id: "p1", name: "Shop" }), staged({ id: "p-gone", name: "Old" }, true)),
  categories: mapOf(staged({ id: "c1", name: "Food", groupId: "g1", isIncome: false, hidden: false })),
  accounts: mapOf(staged({ id: "a1", name: "Checking", offBudget: false, closed: false })),
  categoryGroups: mapOf(staged({ id: "g1", name: "Living", isIncome: false, hidden: false, categoryIds: ["c1"] })),
};

const rule = (id: string, overrides: Partial<Rule> = {}): Rule => ({
  id,
  stage: "default",
  conditionsOp: "and",
  conditions: [{ field: "payee", op: "is", value: "p1" }],
  actions: [{ field: "category", op: "set", value: "c1" }],
  ...overrides,
});

describe("findRuleIssues", () => {
  it("flags rules that name a deleted or unknown entity, but not text matches on an id field", () => {
    const issues = findRuleIssues(mapOf(
      staged(rule("deleted-payee", { conditions: [{ field: "payee", op: "oneOf", value: ["p1", "p-gone"] }] })),
      staged(rule("unknown-category", { actions: [{ field: "category", op: "set", value: "c-missing" }] })),
      staged(rule("text-match", { conditions: [{ field: "payee", op: "contains", value: "p-gone" }] })),
    ), maps);
    expect(issues.get("deleted-payee")).toEqual(["missing-reference"]);
    expect(issues.get("unknown-category")).toEqual(["missing-reference"]);
    expect(issues.has("text-match")).toBe(false);
  });

  it("flags identical rules in any condition order, and rules without conditions", () => {
    const two = [{ field: "payee", op: "is", value: "p1" }, { field: "account", op: "is", value: "a1" }];
    const issues = findRuleIssues(mapOf(
      staged(rule("first", { conditions: two })),
      staged(rule("second", { conditions: [...two].reverse() })),
      staged(rule("other-stage", { stage: "pre", conditions: two })),
      staged(rule("deleted-copy", { conditions: two }), true),
      staged(rule("empty", { conditions: [] })),
    ), maps);
    expect(issues.get("first")).toEqual(["duplicate"]);
    expect(issues.get("second")).toEqual(["duplicate"]);
    expect(issues.has("other-stage")).toBe(false);
    expect(issues.has("deleted-copy")).toBe(false);
    expect(issues.get("empty")).toEqual(["no-conditions"]);
  });

  it("does not call rules duplicates when their actions run in another order", () => {
    const setThenAppend = [
      { field: "notes", op: "set", value: "A" },
      { field: "notes", op: "append-notes", value: "B" },
    ];
    const issues = findRuleIssues(mapOf(
      staged(rule("set-first", { actions: setThenAppend })),
      staged(rule("append-first", { actions: [...setThenAppend].reverse() })),
    ), maps);
    expect(issues.has("set-first")).toBe(false);
    expect(issues.has("append-first")).toBe(false);
  });
});
