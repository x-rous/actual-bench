import type { Rule, Payee, Category, Account, CategoryGroup } from "@/types/entities";
import type { StagedMap } from "@/types/staged";
import type { WorkingSet, CheckContext } from "../../types";
import { missingEntityReferences } from "./missingEntityReferences";

function staged<T extends { id: string }>(entity: T, isDeleted = false): StagedMap<T>[string] {
  return {
    entity,
    original: isDeleted ? entity : entity,
    isNew: false,
    isUpdated: false,
    isDeleted,
    validationErrors: {},
  };
}

function makeRule(partial: Partial<Rule>): Rule {
  return {
    id: partial.id ?? "r1",
    stage: partial.stage ?? "default",
    conditionsOp: partial.conditionsOp ?? "and",
    conditions: partial.conditions ?? [],
    actions: partial.actions ?? [{ field: "category", op: "set", value: "cat-1" }],
  };
}

function buildWs(rules: Rule[], options?: {
  livePayees?: string[];
  liveCategories?: string[];
  liveAccounts?: string[];
  liveCategoryGroups?: string[];
}): WorkingSet {
  const payees: StagedMap<Payee> = {};
  const categories: StagedMap<Category> = {};
  const accounts: StagedMap<Account> = {};
  const categoryGroups: StagedMap<CategoryGroup> = {};

  for (const id of options?.livePayees ?? []) {
    payees[id] = staged({ id, name: `Payee ${id}` });
  }
  for (const id of options?.liveCategories ?? []) {
    categories[id] = staged({ id, name: `Category ${id}`, groupId: "g-1", isIncome: false, hidden: false });
  }
  for (const id of options?.liveAccounts ?? []) {
    accounts[id] = staged({ id, name: `Account ${id}`, offBudget: false, closed: false });
  }
  for (const id of options?.liveCategoryGroups ?? []) {
    categoryGroups[id] = staged({ id, name: `Group ${id}`, isIncome: false, hidden: false, categoryIds: [] });
  }

  return {
    rules,
    entityMaps: { payees, categories, accounts, categoryGroups, schedules: {} },
    entityExists: {
      payees: new Set(options?.livePayees ?? []),
      categories: new Set(options?.liveCategories ?? []),
      accounts: new Set(options?.liveAccounts ?? []),
      categoryGroups: new Set(options?.liveCategoryGroups ?? []),
    },
  };
}

const emptyCtx: CheckContext = {
  partSignatures: new Map(),
  ruleSignatures: new Map(),
  rulesByPartition: new Map(),
  scheduleLinkedRuleIds: new Set(),
  fullDuplicateRuleIds: new Set(),
};

describe("missingEntityReferences", () => {
  it("flags missing payee, category, account, and category_group references", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r1",
        conditions: [{ field: "payee", op: "is", value: "p-deleted" }],
      }),
      makeRule({
        id: "r2",
        actions: [{ field: "category", op: "set", value: "c-deleted" }],
      }),
      makeRule({
        id: "r3",
        conditions: [{ field: "account", op: "is", value: "a-deleted" }],
      }),
      makeRule({
        id: "r4",
        conditions: [{ field: "category_group", op: "is", value: "g-deleted" }],
      }),
      makeRule({
        id: "r5",
        conditions: [{ field: "payee", op: "is", value: "p-live" }],
        actions: [{ field: "category", op: "set", value: "c-live" }],
      }),
    ];
    const ws = buildWs(rules, {
      livePayees: ["p-live"],
      // cat-1 is the default action category referenced by every makeRule fixture
      liveCategories: ["c-live", "cat-1"],
    });
    const findings = missingEntityReferences(ws, emptyCtx);

    expect(findings).toHaveLength(4);
    expect(findings.map((f) => f.code).sort()).toEqual([
      "RULE_MISSING_ACCOUNT",
      "RULE_MISSING_CATEGORY",
      "RULE_MISSING_CATEGORY_GROUP",
      "RULE_MISSING_PAYEE",
    ]);
    const payeeFinding = findings.find((f) => f.code === "RULE_MISSING_PAYEE");
    expect(payeeFinding?.affected[0].id).toBe("r1");
    expect(payeeFinding?.details).toContain("payee: p-deleted");
  });

  it("flags schedule-linked rules for missing entities (guarantee G3)", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r-sched",
        conditions: [{ field: "payee", op: "is", value: "p-deleted" }],
        actions: [{ field: "link-schedule", op: "link-schedule", value: "sch-1" }],
      }),
    ];
    const ws = buildWs(rules, { livePayees: [] });
    const findings = missingEntityReferences(ws, emptyCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_MISSING_PAYEE");
    expect(findings[0].affected[0].id).toBe("r-sched");
  });

  it("emits one finding per rule per entity kind, not per missing ID", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r1",
        conditions: [
          { field: "payee", op: "oneOf", value: ["p-x", "p-y"] },
        ],
      }),
    ];
    const ws = buildWs(rules, { liveCategories: ["cat-1"] });
    const findings = missingEntityReferences(ws, emptyCtx);
    expect(findings).toHaveLength(1);
    expect(findings[0].code).toBe("RULE_MISSING_PAYEE");
    expect(findings[0].details).toEqual(expect.arrayContaining(["payee: p-x", "payee: p-y"]));
  });

  it("does not flag rules whose references all exist", () => {
    const rules: Rule[] = [
      makeRule({
        id: "r1",
        conditions: [{ field: "payee", op: "is", value: "p-live" }],
        actions: [{ field: "category", op: "set", value: "c-live" }],
      }),
    ];
    const ws = buildWs(rules, { livePayees: ["p-live"], liveCategories: ["c-live"] });
    const findings = missingEntityReferences(ws, emptyCtx);
    expect(findings).toHaveLength(0);
  });
});
