import { searchEntities } from "./searchEntities";
import type { SearchSlices } from "./searchEntities";
import type { StagedMap } from "@/types/staged";
import type {
  Account,
  Payee,
  Category,
  CategoryGroup,
  Rule,
  Schedule,
  Tag,
} from "@/types/entities";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePayee(id: string, name: string, extra?: Partial<Payee>): StagedMap<Payee> {
  return {
    [id]: {
      entity: { id, name, ...extra },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeAccount(id: string, name: string, offBudget = false): StagedMap<Account> {
  return {
    [id]: {
      entity: { id, name, offBudget, closed: false },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeCategory(
  id: string,
  name: string,
  groupId: string
): StagedMap<Category> {
  return {
    [id]: {
      entity: { id, name, groupId, isIncome: false, hidden: false },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeCategoryGroup(id: string, name: string): StagedMap<CategoryGroup> {
  return {
    [id]: {
      entity: { id, name, isIncome: false, hidden: false, categoryIds: [] },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeTag(id: string, name: string, description?: string): StagedMap<Tag> {
  return {
    [id]: {
      entity: { id, name, description },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeRule(id: string, stage: Rule["stage"] = "default"): StagedMap<Rule> {
  return {
    [id]: {
      entity: {
        id,
        stage,
        conditionsOp: "and",
        conditions: [{ field: "payee", op: "is", value: "amazon", type: "id" }],
        actions: [{ field: "category", op: "set", value: "shopping-id", type: "id" }],
      },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

function makeSchedule(id: string, name: string, payeeId?: string): StagedMap<Schedule> {
  return {
    [id]: {
      entity: {
        id,
        name,
        completed: false,
        postsTransaction: false,
        payeeId: payeeId ?? null,
      },
      original: null,
      isNew: false,
      isUpdated: false,
      isDeleted: false,
      validationErrors: {},
    },
  };
}

const emptySlices: SearchSlices = {
  accounts: {},
  payees: {},
  categoryGroups: {},
  categories: {},
  rules: {},
  schedules: {},
  tags: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("searchEntities", () => {
  test("empty query returns empty array", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "Amazon"),
    };
    expect(searchEntities("", slices)).toEqual([]);
  });

  test("whitespace-only query returns empty array", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "Amazon"),
    };
    expect(searchEntities("   ", slices)).toEqual([]);
  });

  test("exact match on payee name returns score 100", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "Amazon"),
    };
    const groups = searchEntities("Amazon", slices);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entityType).toBe("payee");
    expect(groups[0]!.results[0]!.score).toBe(100);
  });

  test("prefix match returns score 80", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "Amazon Prime"),
    };
    const groups = searchEntities("Amazon", slices);
    expect(groups[0]!.results[0]!.score).toBe(80);
  });

  test("substring match returns score 40", () => {
    // "Amazon" appears mid-word (not at a word boundary) → score 40
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "TheAmazonStore"),
    };
    const groups = searchEntities("Amazon", slices);
    expect(groups[0]!.results[0]!.score).toBe(40);
  });

  test("deleted entries are excluded", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: {
        p1: {
          entity: { id: "p1", name: "Amazon" },
          original: null,
          isNew: false,
          isUpdated: false,
          isDeleted: true,
          validationErrors: {},
        },
      },
    };
    expect(searchEntities("Amazon", slices)).toEqual([]);
  });

  test("results capped at 5 per group", () => {
    const payees: StagedMap<Payee> = {};
    for (let i = 1; i <= 10; i++) {
      payees[`p${i}`] = {
        entity: { id: `p${i}`, name: `Amazon ${i}` },
        original: null,
        isNew: false,
        isUpdated: false,
        isDeleted: false,
        validationErrors: {},
      };
    }
    const groups = searchEntities("Amazon", { ...emptySlices, payees });
    expect(groups[0]!.results).toHaveLength(5);
  });

  test("groups with no results are omitted", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "Groceries Store"),
    };
    const groups = searchEntities("Groceries", slices);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.entityType).toBe("payee");
  });

  test("category result includes group name as sublabel", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      categories: makeCategory("c1", "Groceries", "g1"),
      categoryGroups: makeCategoryGroup("g1", "Food & Dining"),
    };
    const groups = searchEntities("Groceries", slices);
    expect(groups[0]!.entityType).toBe("category");
    expect(groups[0]!.results[0]!.sublabel).toBe("Food & Dining");
  });

  test("all entity hrefs include ?highlight=<id>", () => {
    const slices: SearchSlices = {
      accounts: makeAccount("a1", "checking"),
      payees: makePayee("p1", "checking store"),
      categories: makeCategory("c1", "checking fees", "g1"),
      categoryGroups: makeCategoryGroup("g1", "Group"),
      rules: makeRule("rule-1"),
      schedules: makeSchedule("s1", "checking deposit"),
      tags: makeTag("t1", "checking"),
    };
    const groups = searchEntities("checking", slices);
    for (const group of groups) {
      for (const result of group.results) {
        expect(result.href).toContain(`?highlight=${result.id}`);
      }
    }
  });

  test("empty tags slice omits tags group", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: makePayee("p1", "food"),
      tags: {},
    };
    const groups = searchEntities("food", slices);
    expect(groups.find((g) => g.entityType === "tag")).toBeUndefined();
  });

  test("tags group present when tags slice is populated", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      tags: makeTag("t1", "food-expense", "weekly food budget"),
    };
    const groups = searchEntities("food", slices);
    expect(groups.find((g) => g.entityType === "tag")).toBeDefined();
  });

  test("new entities with placeholder names are excluded", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      payees: {
        p1: {
          entity: { id: "p1", name: "New Payee" },
          original: null,
          isNew: true,
          isUpdated: false,
          isDeleted: false,
          validationErrors: {},
        },
      },
      tags: {
        t1: {
          entity: { id: "t1", name: "NewTag" },
          original: null,
          isNew: true,
          isUpdated: false,
          isDeleted: false,
          validationErrors: {},
        },
      },
    };
    expect(searchEntities("New Payee", slices)).toEqual([]);
    expect(searchEntities("NewTag", slices)).toEqual([]);
  });

  test("groups are returned in fixed order: payee, category, account, rule, schedule, tag", () => {
    const slices: SearchSlices = {
      accounts: makeAccount("a1", "test account"),
      payees: makePayee("p1", "test payee"),
      categories: makeCategory("c1", "test category", "g1"),
      categoryGroups: makeCategoryGroup("g1", "Group"),
      rules: makeRule("r1"),
      schedules: makeSchedule("s1", "test schedule"),
      tags: makeTag("t1", "test tag"),
    };
    const groups = searchEntities("test", slices);
    const types = groups.map((g) => g.entityType);
    const expected = ["payee", "category", "account", "schedule", "tag"] as const;
    // rules may or may not match "test" — just verify relative order of what does match
    const nonRule = types.filter((t) => t !== "rule");
    expect(nonRule).toEqual(expected.filter((t) => nonRule.includes(t)));
  });

  test("schedule sublabel shows resolved payee name", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      schedules: makeSchedule("s1", "Monthly Rent", "p1"),
      payees: makePayee("p1", "Landlord Co"),
    };
    const groups = searchEntities("Rent", slices);
    const schedGroup = groups.find((g) => g.entityType === "schedule");
    expect(schedGroup?.results[0]?.sublabel).toBe("Landlord Co");
  });

  test("account sublabel shows budget type", () => {
    const slices: SearchSlices = {
      ...emptySlices,
      accounts: {
        a1: {
          entity: { id: "a1", name: "Savings", offBudget: true, closed: false },
          original: null,
          isNew: false,
          isUpdated: false,
          isDeleted: false,
          validationErrors: {},
        },
      },
    };
    const groups = searchEntities("Savings", slices);
    expect(groups[0]!.results[0]!.sublabel).toBe("Off budget");
  });
});
