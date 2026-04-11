import { buildEntityUsage } from "./entityUsage";
import type { StagedMap } from "@/types/staged";
import type { Rule, Category } from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(id: string, overrides: Partial<Rule> = {}): Rule {
  return {
    id,
    stage: "default",
    conditionsOp: "and",
    conditions: [],
    actions: [],
    ...overrides,
  };
}

function stagedRules(rules: Rule[]): StagedMap<Rule> {
  const map: StagedMap<Rule> = {};
  for (const r of rules) {
    map[r.id] = {
      entity: r,
      original: r,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    };
  }
  return map;
}

function stagedCategories(
  cats: Array<{ id: string; name: string; groupId: string; isNew?: boolean; isDeleted?: boolean }>
): StagedMap<Category> {
  const map: StagedMap<Category> = {};
  for (const c of cats) {
    const entity: Category = { id: c.id, name: c.name, groupId: c.groupId, isIncome: false, hidden: false };
    map[c.id] = {
      entity,
      original: c.isNew ? null : entity,
      isNew: c.isNew ?? false,
      isUpdated: false,
      isDeleted: c.isDeleted ?? false,
      validationErrors: {},
    };
  }
  return map;
}

const NO_RULES: StagedMap<Rule> = {};
const NO_TX = new Map<string, number>();

// ─── account ──────────────────────────────────────────────────────────────────

describe("buildEntityUsage — account", () => {
  it("returns ruleCount=0, txCount=0, balance=0, no warnings when entity has no refs", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
      balanceMap: new Map([["acc1", 0]]),
    });

    expect(result.ruleCount).toBe(0);
    expect(result.txCount).toBe(0);
    expect(result.balance).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("counts rules referencing the account", () => {
    const rules = stagedRules([
      makeRule("r1", { conditions: [{ field: "account", op: "is", value: "acc1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "account", op: "is", value: "acc1", type: "id" }] }),
    ]);

    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: rules,
      txCounts: NO_TX,
      txLoading: false,
      balanceMap: new Map(),
    });

    expect(result.ruleCount).toBe(2);
  });

  it("reads balance from the balanceMap", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: new Map([["acc1", 0]]),
      txLoading: false,
      balanceMap: new Map([["acc1", 500]]),
    });

    expect(result.balance).toBe(500);
    expect(result.warnings.length).toBeGreaterThan(0); // non-zero balance triggers a warning
  });

  it("includes warning when balance is non-zero", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: new Map([["acc1", 0]]),
      txLoading: false,
      balanceMap: new Map([["acc1", 100]]),
    });

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(String(result.warnings[0])).toContain("100");
  });

  it("includes warning when txCount > 0", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: new Map([["acc1", 5]]),
      txLoading: false,
      balanceMap: new Map([["acc1", 0]]),
    });

    expect(result.txCount).toBe(5);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("sets txCount=undefined when txCounts is undefined (not yet loaded / isNew entity)", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: undefined,
      txLoading: false,
      balanceMap: new Map(),
    });

    expect(result.txCount).toBeUndefined();
  });

  it("sets txLoading=true and emits a warning when loading", () => {
    const result = buildEntityUsage({
      entityId: "acc1",
      entityType: "account",
      entityLabel: "Checking",
      stagedRules: NO_RULES,
      txCounts: undefined,
      txLoading: true,
      balanceMap: new Map(),
    });

    expect(result.txLoading).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(String(result.warnings[0])).toContain("Checking usage");
  });
});

// ─── payee ────────────────────────────────────────────────────────────────────

describe("buildEntityUsage — payee", () => {
  it("returns no warnings for a payee with no refs", () => {
    const result = buildEntityUsage({
      entityId: "p1",
      entityType: "payee",
      entityLabel: "Amazon",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(0);
    expect(result.txCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("counts payee and imported_payee rule references", () => {
    const rules = stagedRules([
      makeRule("r1", { conditions: [{ field: "payee", op: "is", value: "p1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "imported_payee", op: "is", value: "p1", type: "id" }] }),
    ]);

    const result = buildEntityUsage({
      entityId: "p1",
      entityType: "payee",
      entityLabel: "Amazon",
      stagedRules: rules,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(2);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("includes warning when txCount > 0", () => {
    const result = buildEntityUsage({
      entityId: "p1",
      entityType: "payee",
      entityLabel: "Amazon",
      stagedRules: NO_RULES,
      txCounts: new Map([["p1", 8]]),
      txLoading: false,
    });

    expect(result.txCount).toBe(8);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(String(result.warnings[0])).toContain("8 transaction");
  });

  it("balance and childCount are undefined for payees", () => {
    const result = buildEntityUsage({
      entityId: "p1",
      entityType: "payee",
      entityLabel: "Amazon",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.balance).toBeUndefined();
    expect(result.childCount).toBeUndefined();
  });
});

// ─── category ─────────────────────────────────────────────────────────────────

describe("buildEntityUsage — category", () => {
  it("returns no warnings for a category with no refs", () => {
    const result = buildEntityUsage({
      entityId: "cat1",
      entityType: "category",
      entityLabel: "Groceries",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(0);
    expect(result.txCount).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("counts only 'category' field references (not account or payee)", () => {
    const rules = stagedRules([
      makeRule("r1", { conditions: [{ field: "category", op: "is", value: "cat1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "account",  op: "is", value: "cat1", type: "id" }] }),
    ]);

    const result = buildEntityUsage({
      entityId: "cat1",
      entityType: "category",
      entityLabel: "Groceries",
      stagedRules: rules,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(1); // only the category field rule counts
  });

  it("mentions 'uncategorized' in the warning when tx > 0", () => {
    const result = buildEntityUsage({
      entityId: "cat1",
      entityType: "category",
      entityLabel: "Groceries",
      stagedRules: NO_RULES,
      txCounts: new Map([["cat1", 3]]),
      txLoading: false,
    });

    expect(String(result.warnings[0])).toContain("uncategorized");
  });
});

// ─── categoryGroup ────────────────────────────────────────────────────────────

describe("buildEntityUsage — categoryGroup", () => {
  it("counts children that belong to the group", () => {
    const cats = stagedCategories([
      { id: "c1", name: "Groceries", groupId: "g1" },
      { id: "c2", name: "Dining",    groupId: "g1" },
      { id: "c3", name: "Transport", groupId: "g2" }, // different group
    ]);

    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Food",
      stagedRules: NO_RULES,
      txCounts: new Map([["c1", 5], ["c2", 3]]),
      txLoading: false,
      stagedCategories: cats,
    });

    expect(result.childCount).toBe(2);
    expect(result.txCount).toBe(8); // 5 + 3 aggregated
  });

  it("excludes deleted children from childCount", () => {
    const cats = stagedCategories([
      { id: "c1", name: "Groceries",  groupId: "g1" },
      { id: "c2", name: "Dining",     groupId: "g1", isDeleted: true },
    ]);

    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Food",
      stagedRules: NO_RULES,
      txCounts: new Map([["c1", 2]]),
      txLoading: false,
      stagedCategories: cats,
    });

    expect(result.childCount).toBe(1);
  });

  it("sums rule references across all children", () => {
    const cats = stagedCategories([
      { id: "c1", name: "Groceries", groupId: "g1" },
      { id: "c2", name: "Dining",    groupId: "g1" },
    ]);
    const rules = stagedRules([
      makeRule("r1", { conditions: [{ field: "category", op: "is", value: "c1", type: "id" }] }),
      makeRule("r2", { conditions: [{ field: "category", op: "is", value: "c2", type: "id" }] }),
      makeRule("r3", { conditions: [{ field: "category", op: "is", value: "c2", type: "id" }] }),
    ]);

    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Food",
      stagedRules: rules,
      txCounts: NO_TX,
      txLoading: false,
      stagedCategories: cats,
    });

    expect(result.ruleCount).toBe(3);
  });

  it("emits a warning when there are children or refs", () => {
    const cats = stagedCategories([
      { id: "c1", name: "Groceries", groupId: "g1" },
    ]);

    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Food",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
      stagedCategories: cats,
    });

    expect(result.warnings).toHaveLength(1);
    expect(String(result.warnings[0])).toContain("Food");
  });

  it("emits NO warning and shows empty state for a group with 0 children, 0 rules, 0 tx", () => {
    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Empty Group",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
      stagedCategories: {},
    });

    expect(result.childCount).toBe(0);
    expect(result.ruleCount).toBe(0);
    expect(result.txCount).toBe(0);
    expect(result.warnings).toHaveLength(0); // Fix 2: empty groups get no warning
  });

  it("returns txCount=undefined while loading", () => {
    const cats = stagedCategories([{ id: "c1", name: "Groceries", groupId: "g1" }]);

    const result = buildEntityUsage({
      entityId: "g1",
      entityType: "categoryGroup",
      entityLabel: "Food",
      stagedRules: NO_RULES,
      txCounts: undefined,
      txLoading: true,
      stagedCategories: cats,
    });

    expect(result.txCount).toBeUndefined();
    expect(result.txLoading).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0); // loading triggers warning
  });
});

// ─── schedule ─────────────────────────────────────────────────────────────────

describe("buildEntityUsage — schedule", () => {
  it("returns ruleCount=0 (schedules have a linked rule, not rule references)", () => {
    const result = buildEntityUsage({
      entityId: "s1",
      entityType: "schedule",
      entityLabel: "Rent",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(0);
  });

  it("returns no warnings when no ruleId and no tx", () => {
    const result = buildEntityUsage({
      entityId: "s1",
      entityType: "schedule",
      entityLabel: "Rent",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.warnings).toHaveLength(0);
  });

  it("includes warning when linkedRuleId is present", () => {
    const result = buildEntityUsage({
      entityId: "s1",
      entityType: "schedule",
      entityLabel: "Rent",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
      scheduleRuleId: "rule-abc",
      schedulePostsTransaction: false,
    });

    expect(result.linkedRuleId).toBe("rule-abc");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(String(result.warnings[0])).toContain("unlinked");
  });

  it("mentions auto-post when postsTransaction=true", () => {
    const result = buildEntityUsage({
      entityId: "s1",
      entityType: "schedule",
      entityLabel: "Rent",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
      scheduleRuleId: "rule-abc",
      schedulePostsTransaction: true,
    });

    expect(result.postsTransaction).toBe(true);
    expect(String(result.warnings[0])).toContain("auto-post");
  });

  it("includes warning when txCount > 0", () => {
    const result = buildEntityUsage({
      entityId: "s1",
      entityType: "schedule",
      entityLabel: "Rent",
      stagedRules: NO_RULES,
      txCounts: new Map([["s1", 12]]),
      txLoading: false,
    });

    expect(result.txCount).toBe(12);
    expect(String(result.warnings[0])).toContain("12 transaction");
  });
});

// ─── tag ──────────────────────────────────────────────────────────────────────

describe("buildEntityUsage — tag", () => {
  it("has ruleCount=0, txCount=undefined, no warnings", () => {
    const result = buildEntityUsage({
      entityId: "tag1",
      entityType: "tag",
      entityLabel: "vacation",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.ruleCount).toBe(0);
    expect(result.txCount).toBeUndefined();
    expect(result.warnings).toHaveLength(0);
  });

  it("has no tx count even when txCounts is provided (tags opt out)", () => {
    // The hook always passes txCounts=undefined for tags (enabled=false),
    // but even if something passed a map, the tag case should ignore it.
    const result = buildEntityUsage({
      entityId: "tag1",
      entityType: "tag",
      entityLabel: "vacation",
      stagedRules: NO_RULES,
      txCounts: new Map([["tag1", 999]]),
      txLoading: false,
    });

    // tag case always sets txCount = undefined regardless of txCounts input
    expect(result.txCount).toBeUndefined();
    expect(result.warnings).toHaveLength(0);
  });

  it("has balance=undefined, childCount=undefined, linkedRuleId=undefined", () => {
    const result = buildEntityUsage({
      entityId: "tag1",
      entityType: "tag",
      entityLabel: "vacation",
      stagedRules: NO_RULES,
      txCounts: undefined,
      txLoading: false,
    });

    expect(result.balance).toBeUndefined();
    expect(result.childCount).toBeUndefined();
    expect(result.linkedRuleId).toBeUndefined();
  });
});

// ─── Cross-cutting: return shape ──────────────────────────────────────────────

describe("buildEntityUsage — return shape", () => {
  it("always echoes back entityId, entityType, and entityLabel", () => {
    const result = buildEntityUsage({
      entityId: "x1",
      entityType: "payee",
      entityLabel: "Test Payee",
      stagedRules: NO_RULES,
      txCounts: NO_TX,
      txLoading: false,
    });

    expect(result.entityId).toBe("x1");
    expect(result.entityType).toBe("payee");
    expect(result.entityLabel).toBe("Test Payee");
  });

  it("does not set txCount when txCounts is undefined (loading / isNew)", () => {
    for (const type of ["account", "payee", "category", "schedule"] as const) {
      const result = buildEntityUsage({
        entityId: "e1",
        entityType: type,
        entityLabel: "Entity",
        stagedRules: NO_RULES,
        txCounts: undefined,
        txLoading: false,
      });
      expect(result.txCount).toBeUndefined();
    }
  });
});
