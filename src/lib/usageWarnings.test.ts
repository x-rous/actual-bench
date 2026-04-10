import {
  buildPayeeDeleteWarning,
  buildPayeeBulkDeleteWarning,
  buildCategoryDeleteWarning,
  buildCategoryGroupDeleteWarning,
  buildCategoryBulkDeleteWarning,
  buildAccountCloseWarning,
  buildAccountDeleteWarning,
  buildAccountBulkCloseWarning,
  buildAccountBulkDeleteWarning,
  buildScheduleDeleteWarning,
  buildScheduleBulkDeleteWarning,
  buildRuleDeleteWarning,
  buildRuleBulkDeleteWarning,
} from "./usageWarnings";

// ─── buildPayeeDeleteWarning ──────────────────────────────────────────────────

describe("buildPayeeDeleteWarning", () => {
  it("returns a generic delete message when there are no refs and not loading", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 0, 0, false);
    expect(msg).toContain("Delete");
    expect(msg).toContain("Amazon");
  });

  it("mentions rule count when rules > 0", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 2, 0, false);
    expect(msg).toContain("2 rule");
  });

  it("mentions transaction count when tx > 0", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 0, 5, false);
    expect(msg).toContain("5 transaction");
    expect(msg).toContain("unlinked");
  });

  it("includes both rules and transactions when both > 0", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 3, 10, false);
    expect(msg).toContain("3 rule");
    expect(msg).toContain("10 transaction");
  });

  it("shows loading message when loading=true", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });

  it("uses singular 'rule' for exactly 1", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 1, 0, false);
    expect(msg).toMatch(/\b1 rule\b/);
    expect(msg).not.toMatch(/\b1 rules\b/);
  });

  it("uses singular 'transaction' for exactly 1", () => {
    const msg = buildPayeeDeleteWarning("Amazon", 0, 1, false);
    expect(msg).toMatch(/\b1 transaction\b/);
    expect(msg).not.toMatch(/\b1 transactions\b/);
  });
});

// ─── buildPayeeBulkDeleteWarning ──────────────────────────────────────────────

describe("buildPayeeBulkDeleteWarning", () => {
  it("states staged-for-deletion count", () => {
    const msg = buildPayeeBulkDeleteWarning(3, 0, 0, 0, 0, false);
    expect(msg).toContain("3 payee");
    expect(msg).toContain("Save");
  });

  it("includes new row count when > 0", () => {
    const msg = buildPayeeBulkDeleteWarning(2, 1, 0, 0, 0, false);
    expect(msg).toContain("1 unsaved new row");
  });

  it("includes skipped transfer payee count when > 0", () => {
    const msg = buildPayeeBulkDeleteWarning(2, 0, 1, 0, 0, false);
    expect(msg).toContain("1 transfer payee");
    expect(msg).toContain("skipped");
  });

  it("includes rule reference warning when ruleCount > 0", () => {
    const msg = buildPayeeBulkDeleteWarning(2, 0, 0, 4, 0, false);
    expect(msg).toContain("4 rule reference");
  });

  it("includes tx count when > 0", () => {
    const msg = buildPayeeBulkDeleteWarning(2, 0, 0, 0, 7, false);
    expect(msg).toContain("7 transaction");
    expect(msg).toContain("unlinked");
  });

  it("shows loading message instead of tx count when loading=true", () => {
    const msg = buildPayeeBulkDeleteWarning(2, 0, 0, 0, undefined, true);
    expect(msg).toContain("Checking usage");
    expect(msg).not.toContain("transaction");
  });
});

// ─── buildCategoryDeleteWarning ───────────────────────────────────────────────

describe("buildCategoryDeleteWarning", () => {
  it("returns a generic delete message when there are no refs", () => {
    const msg = buildCategoryDeleteWarning("Groceries", 0, 0, false);
    expect(msg).toContain("Delete");
    expect(msg).toContain("Groceries");
  });

  it("mentions rules when ruleCount > 0", () => {
    const msg = buildCategoryDeleteWarning("Groceries", 2, 0, false);
    expect(msg).toContain("2 rule");
  });

  it("mentions transactions and that they will be uncategorized", () => {
    const msg = buildCategoryDeleteWarning("Groceries", 0, 3, false);
    expect(msg).toContain("3 transaction");
    expect(msg).toContain("uncategorized");
  });

  it("includes both refs when both > 0", () => {
    const msg = buildCategoryDeleteWarning("Groceries", 1, 5, false);
    expect(msg).toContain("1 rule");
    expect(msg).toContain("5 transaction");
  });

  it("shows loading message when loading=true", () => {
    const msg = buildCategoryDeleteWarning("Groceries", 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildCategoryGroupDeleteWarning ─────────────────────────────────────────

describe("buildCategoryGroupDeleteWarning", () => {
  it("includes group name and child count", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 3, 0, 0, false);
    expect(msg).toContain("Food");
    expect(msg).toContain("3 categor");
  });

  it("uses 'category' singular for exactly 1 child", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 1, 0, 0, false);
    expect(msg).toMatch(/\b1 category\b/);
  });

  it("uses 'categories' plural for more than 1", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 2, 0, 0, false);
    expect(msg).toContain("2 categories");
  });

  it("includes rule count when > 0", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 2, 4, 0, false);
    expect(msg).toContain("4 rule");
  });

  it("includes tx count when > 0", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 2, 0, 6, false);
    expect(msg).toContain("6 transaction");
    expect(msg).toContain("uncategorized");
  });

  it("shows loading message when loading=true", () => {
    const msg = buildCategoryGroupDeleteWarning("Food", 2, 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildCategoryBulkDeleteWarning ──────────────────────────────────────────

describe("buildCategoryBulkDeleteWarning", () => {
  it("states staged-for-deletion item count", () => {
    const msg = buildCategoryBulkDeleteWarning(4, 0, 0, 0, false);
    expect(msg).toContain("4 item");
    expect(msg).toContain("Save");
  });

  it("includes new row count when > 0", () => {
    const msg = buildCategoryBulkDeleteWarning(3, 2, 0, 0, false);
    expect(msg).toContain("2 unsaved new row");
  });

  it("always mentions group-child deletion cascade", () => {
    const msg = buildCategoryBulkDeleteWarning(1, 0, 0, 0, false);
    expect(msg).toContain("group");
  });

  it("includes rule count when > 0", () => {
    const msg = buildCategoryBulkDeleteWarning(2, 0, 5, 0, false);
    expect(msg).toContain("5 rule");
  });

  it("includes tx count when > 0", () => {
    const msg = buildCategoryBulkDeleteWarning(2, 0, 0, 8, false);
    expect(msg).toContain("8 transaction");
    expect(msg).toContain("uncategorized");
  });

  it("shows loading when loading=true", () => {
    const msg = buildCategoryBulkDeleteWarning(2, 0, 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildAccountCloseWarning ─────────────────────────────────────────────────

describe("buildAccountCloseWarning", () => {
  it("warns about outstanding balance when balance !== 0", () => {
    const msg = buildAccountCloseWarning("Checking", 100.50, 0, false);
    expect(msg).toContain("100.50");
    expect(msg).toContain("balance");
  });

  it("uses negative balance sign correctly", () => {
    const msg = buildAccountCloseWarning("Checking", -50.25, 0, false);
    expect(msg).toContain("-50.25");
  });

  it("mentions transaction count when balance is 0 and tx > 0", () => {
    const msg = buildAccountCloseWarning("Checking", 0, 5, false);
    expect(msg).toContain("5 transaction");
    expect(msg).toContain("hide");
  });

  it("returns generic close message when balance=0 and no tx", () => {
    const msg = buildAccountCloseWarning("Checking", 0, 0, false);
    expect(msg).toContain("Close");
    expect(msg).toContain("Checking");
    expect(msg).toContain("hidden");
  });

  it("shows loading message when loading=true and balance=0", () => {
    const msg = buildAccountCloseWarning("Checking", 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });

  it("balance warning takes priority over loading state", () => {
    // Non-zero balance always shown regardless of loading
    const msg = buildAccountCloseWarning("Checking", 50, undefined, true);
    expect(msg).toContain("50");
    expect(msg).toContain("balance");
  });
});

// ─── buildAccountDeleteWarning ────────────────────────────────────────────────

describe("buildAccountDeleteWarning", () => {
  it("returns generic delete message when all zero", () => {
    const msg = buildAccountDeleteWarning("Savings", 0, 0, 0, false);
    expect(msg).toContain("Delete");
    expect(msg).toContain("Savings");
  });

  it("warns about non-zero balance", () => {
    const msg = buildAccountDeleteWarning("Savings", 250, 0, 0, false);
    expect(msg).toContain("250");
    expect(msg).toContain("balance");
  });

  it("mentions rule count when > 0", () => {
    const msg = buildAccountDeleteWarning("Savings", 0, 2, 0, false);
    expect(msg).toContain("2 rule");
  });

  it("warns transactions will be permanently lost", () => {
    const msg = buildAccountDeleteWarning("Savings", 0, 0, 10, false);
    expect(msg).toContain("10 transaction");
    expect(msg).toContain("lost");
  });

  it("combines all warnings when all are present", () => {
    const msg = buildAccountDeleteWarning("Savings", 100, 3, 15, false);
    expect(msg).toContain("100");
    expect(msg).toContain("3 rule");
    expect(msg).toContain("15 transaction");
  });

  it("shows loading message when loading=true", () => {
    const msg = buildAccountDeleteWarning("Savings", 0, 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildAccountBulkCloseWarning ─────────────────────────────────────────────

describe("buildAccountBulkCloseWarning", () => {
  it("includes account count", () => {
    const msg = buildAccountBulkCloseWarning(3, 0);
    expect(msg).toContain("3 account");
  });

  it("warns when some accounts have non-zero balance", () => {
    const msg = buildAccountBulkCloseWarning(3, 2);
    expect(msg).toContain("2 account");
    expect(msg).toContain("non-zero balance");
  });

  it("returns simple message when no accounts have non-zero balance", () => {
    const msg = buildAccountBulkCloseWarning(3, 0);
    expect(msg).toContain("hidden");
    expect(msg).not.toContain("non-zero");
  });

  it("uses singular 'has' for exactly 1 non-zero account", () => {
    const msg = buildAccountBulkCloseWarning(3, 1);
    expect(msg).toContain("1 account");
    expect(msg).toMatch(/\bhas\b/);
  });

  it("uses plural 'have' for 2+ non-zero accounts", () => {
    const msg = buildAccountBulkCloseWarning(3, 2);
    expect(msg).toMatch(/\bhave\b/);
  });
});

// ─── buildAccountBulkDeleteWarning ───────────────────────────────────────────

describe("buildAccountBulkDeleteWarning", () => {
  it("includes server account count", () => {
    const msg = buildAccountBulkDeleteWarning(4, 0, 0, 0, 0, false);
    expect(msg).toContain("4 account");
    expect(msg).toContain("Save");
  });

  it("includes new row count when > 0", () => {
    const msg = buildAccountBulkDeleteWarning(3, 1, 0, 0, 0, false);
    expect(msg).toContain("1 unsaved new row");
  });

  it("warns about non-zero balance accounts", () => {
    const msg = buildAccountBulkDeleteWarning(3, 0, 2, 0, 0, false);
    expect(msg).toContain("2 account");
    expect(msg).toContain("non-zero balance");
  });

  it("includes rule count when > 0", () => {
    const msg = buildAccountBulkDeleteWarning(2, 0, 0, 5, 0, false);
    expect(msg).toContain("5 rule");
  });

  it("warns transactions will be permanently lost", () => {
    const msg = buildAccountBulkDeleteWarning(2, 0, 0, 0, 20, false);
    expect(msg).toContain("20 transaction");
    expect(msg).toContain("lost");
  });

  it("shows loading when loading=true", () => {
    const msg = buildAccountBulkDeleteWarning(2, 0, 0, 0, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildScheduleDeleteWarning ───────────────────────────────────────────────

describe("buildScheduleDeleteWarning", () => {
  it("returns simple delete message when no rule and no tx", () => {
    const msg = buildScheduleDeleteWarning("Rent", undefined, false, 0, false);
    expect(msg).toContain("Rent");
    expect(msg).toContain("Delete");
  });

  it("mentions linked rule when ruleId is present (not postsTransaction)", () => {
    const msg = buildScheduleDeleteWarning("Rent", "rule-1", false, 0, false);
    expect(msg).toContain("linked to a rule");
    expect(msg).toContain("unlinked");
  });

  it("warns about auto-post when ruleId + postsTransaction=true", () => {
    const msg = buildScheduleDeleteWarning("Rent", "rule-1", true, 0, false);
    expect(msg).toContain("auto-post");
  });

  it("mentions transactions that will be unlinked when tx > 0", () => {
    const msg = buildScheduleDeleteWarning("Rent", undefined, false, 5, false);
    expect(msg).toContain("5 transaction");
    expect(msg).toContain("unlinked");
  });

  it("shows loading when loading=true", () => {
    const msg = buildScheduleDeleteWarning("Rent", undefined, false, undefined, true);
    expect(msg).toContain("Checking usage");
  });

  it("falls back to 'This schedule' when name is empty", () => {
    const msg = buildScheduleDeleteWarning("", "rule-1", false, 0, false);
    expect(msg).toContain("This schedule");
  });
});

// ─── buildScheduleBulkDeleteWarning ──────────────────────────────────────────

describe("buildScheduleBulkDeleteWarning", () => {
  it("includes schedule count", () => {
    const msg = buildScheduleBulkDeleteWarning(3, 0, false);
    expect(msg).toContain("3 schedule");
  });

  it("mentions linked rules becoming unlinked", () => {
    const msg = buildScheduleBulkDeleteWarning(3, 0, false);
    expect(msg).toContain("unlinked");
  });

  it("includes tx count when > 0", () => {
    const msg = buildScheduleBulkDeleteWarning(3, 4, false);
    expect(msg).toContain("4 transaction");
  });

  it("shows loading when loading=true", () => {
    const msg = buildScheduleBulkDeleteWarning(3, undefined, true);
    expect(msg).toContain("Checking usage");
  });
});

// ─── buildRuleDeleteWarning / buildRuleBulkDeleteWarning ─────────────────────

describe("buildRuleDeleteWarning", () => {
  it("returns a non-empty delete message", () => {
    const msg = buildRuleDeleteWarning();
    expect(msg.length).toBeGreaterThan(0);
    expect(msg.toLowerCase()).toContain("delete");
  });
});

describe("buildRuleBulkDeleteWarning", () => {
  it("includes the rule count", () => {
    const msg = buildRuleBulkDeleteWarning(5);
    expect(msg).toContain("5 rule");
  });

  it("uses singular for exactly 1", () => {
    const msg = buildRuleBulkDeleteWarning(1);
    expect(msg).toMatch(/\b1 rule\b/);
    expect(msg).not.toMatch(/\b1 rules\b/);
  });
});
