/**
 * Parity contract for the rule field/operator model.
 *
 * These tables are transcribed from Actual Budget's own `TYPE_INFO` / `FIELD_INFO`
 * (`loot-core/src/shared/rules.ts`, bundled at `@actual-app/api/dist/index.js`). This test is the
 * thing that fails when Actual moves — do not "fix" it by editing the expectation to match the
 * implementation. Re-derive both from the bundle.
 */

import {
  ACTION_FIELDS,
  ACTION_OPS,
  ACTION_OP_OPTIONS,
  ALLOCATION_METHODS,
  CONDITION_FIELDS,
  DEFAULT_ACTION_FIELD,
  DEFAULT_CONDITION_FIELD,
  PARENT_ONLY_ACTION_FIELDS,
  conditionDisplayField,
  conditionValueKind,
  friendlyOp,
  getConditionOps,
  getSplitActionFields,
  getValidOps,
  isValidOp,
} from "./ruleFields";

// ─── getValidOps ──────────────────────────────────────────────────────────────

describe("getValidOps", () => {
  const expected: Record<string, string[]> = {
    imported_payee: ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
    payee_name:     ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf", "hasTags", "hasAnyTag"],
    notes:          ["is", "contains", "matches", "isNot", "doesNotContain", "hasTags", "hasAnyTag"],
    payee:          ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
    category:       ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
    category_group: ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf"],
    account:        ["is", "contains", "matches", "oneOf", "isNot", "doesNotContain", "notOneOf", "onBudget", "offBudget"],
    date:           ["is", "isapprox", "gt", "gte", "lt", "lte"],
    amount:         ["is", "isapprox", "isbetween", "gt", "gte", "lt", "lte"],
    cleared:        ["is"],
    reconciled:     ["is"],
    transfer:       ["is"],
    parent:         ["is"],
  };

  it.each(Object.entries(expected))("%s", (field, ops) => {
    expect(getValidOps(field)).toEqual(ops);
  });

  it("returns nothing for an unknown field", () => {
    expect(getValidOps("nope")).toEqual([]);
  });

  it("rejects the three date operators Bench used to invent (F-111)", () => {
    for (const op of ["isNot", "isAfter", "isBefore"]) {
      expect(getValidOps("date")).not.toContain(op);
      expect(isValidOp("date", op)).toBe(false);
    }
  });

  it("accepts the date operators Actual actually has", () => {
    for (const op of ["gt", "gte", "lt", "lte"]) {
      expect(isValidOp("date", op)).toBe(true);
    }
  });

  it("disallows oneOf/notOneOf on notes (F-112)", () => {
    expect(isValidOp("notes", "oneOf")).toBe(false);
    expect(isValidOp("notes", "notOneOf")).toBe(false);
    expect(isValidOp("imported_payee", "oneOf")).toBe(true);
  });

  it("disallows tag operators on imported_payee", () => {
    expect(isValidOp("imported_payee", "hasTags")).toBe(false);
    expect(isValidOp("notes", "hasTags")).toBe(true);
  });

  it("allows budget operators only on account", () => {
    expect(isValidOp("account", "onBudget")).toBe(true);
    for (const field of ["payee", "category", "category_group"]) {
      expect(isValidOp(field, "onBudget")).toBe(false);
      expect(isValidOp(field, "offBudget")).toBe(false);
    }
  });

  it("accepts the internal `and` op on category fields without offering it", () => {
    expect(isValidOp("category", "and")).toBe(true);
    expect(isValidOp("category_group", "and")).toBe(true);
    expect(getValidOps("category")).not.toContain("and");
    expect(isValidOp("payee", "and")).toBe(false);
  });
});

// ─── Condition fields ─────────────────────────────────────────────────────────

describe("CONDITION_FIELDS", () => {
  it("offers exactly the fields Actual's rule editor offers, in its order", () => {
    expect(Object.keys(CONDITION_FIELDS)).toEqual([
      "imported_payee",
      "account",
      "category",
      "category_group",
      "date",
      "payee",
      "notes",
      "amount",
      "amount-inflow",
      "amount-outflow",
      "cleared",
    ]);
  });

  it("does not offer the engine fields Actual keeps out of the rules UI", () => {
    for (const field of ["payee_name", "reconciled", "transfer", "parent", "saved"]) {
      expect(CONDITION_FIELDS[field]).toBeUndefined();
    }
  });

  it("has a default that does not depend on key order", () => {
    expect(CONDITION_FIELDS[DEFAULT_CONDITION_FIELD]).toBeDefined();
  });

  it("maps the inflow/outflow pseudo-fields onto amount", () => {
    expect(CONDITION_FIELDS["amount-inflow"].pseudoFor).toEqual({
      field: "amount",
      options: { inflow: true },
    });
    expect(CONDITION_FIELDS["amount-outflow"].pseudoFor).toEqual({
      field: "amount",
      options: { outflow: true },
    });
  });

  it("gives the pseudo-fields the same operators as amount", () => {
    expect(Object.keys(getConditionOps("amount-inflow"))).toEqual(Object.keys(getConditionOps("amount")));
  });
});

describe("conditionDisplayField", () => {
  it("resolves stored amount options back to the pseudo-field", () => {
    expect(conditionDisplayField("amount", { inflow: true })).toBe("amount-inflow");
    expect(conditionDisplayField("amount", { outflow: true })).toBe("amount-outflow");
  });

  it("leaves a plain amount alone", () => {
    expect(conditionDisplayField("amount", undefined)).toBe("amount");
    expect(conditionDisplayField("amount", {})).toBe("amount");
  });

  it("never rewrites another field", () => {
    expect(conditionDisplayField("notes", { inflow: true })).toBe("notes");
    expect(conditionDisplayField(undefined)).toBe("");
  });
});

// ─── Labels ───────────────────────────────────────────────────────────────────

describe("friendlyOp", () => {
  it("reads date comparisons as before/after, matching Actual (F-121)", () => {
    expect(friendlyOp("gt", "date")).toBe("is after");
    expect(friendlyOp("gte", "date")).toBe("is after or equals");
    expect(friendlyOp("lt", "date")).toBe("is before");
    expect(friendlyOp("lte", "date")).toBe("is before or equals");
  });

  it("reads number comparisons as greater/less", () => {
    expect(friendlyOp("gt", "number")).toBe("is greater than");
    expect(friendlyOp("lt", "number")).toBe("is less than");
  });

  it("labels the tag operators", () => {
    expect(friendlyOp("hasTags", "string")).toBe("has all tags");
    expect(friendlyOp("hasAnyTag", "string")).toBe("has any tag");
  });

  it("falls back to the op key", () => {
    expect(friendlyOp("mystery")).toBe("mystery");
  });
});

describe("getConditionOps", () => {
  it("marks the budget operators as taking no value", () => {
    const ops = getConditionOps("account");
    expect(ops.onBudget.hasValue).toBe(false);
    expect(ops.offBudget.hasValue).toBe(false);
    expect(ops.is.hasValue).toBe(true);
  });

  it("labels date operators by type", () => {
    expect(getConditionOps("date").gt.label).toBe("is after");
    expect(getConditionOps("amount").gt.label).toBe("is greater than");
  });

  it("returns nothing for an unknown field", () => {
    expect(getConditionOps("nope")).toEqual({});
  });
});

// ─── Value editors ────────────────────────────────────────────────────────────

describe("conditionValueKind", () => {
  it.each([
    ["account", "onBudget", "none"],
    ["amount", "isbetween", "range"],
    ["notes", "hasTags", "tags"],
    ["notes", "hasAnyTag", "tags"],
    ["payee", "oneOf", "multi-entity"],
    ["imported_payee", "oneOf", "multi-text"],
    ["payee", "is", "entity"],
    ["category", "is", "entity"],
    ["payee", "contains", "text"],
    ["payee", "matches", "text"],
    ["category", "doesNotContain", "text"],
    ["amount", "gt", "number"],
    ["amount-inflow", "gt", "number"],
    ["date", "is", "date"],
    ["cleared", "is", "boolean"],
    ["notes", "contains", "text"],
  ])("%s %s → %s", (field, op, kind) => {
    expect(conditionValueKind(field, op)).toBe(kind);
  });
});

// ─── Action fields and ops ────────────────────────────────────────────────────

describe("ACTION_FIELDS", () => {
  it("offers exactly the fields Actual offers, in its order", () => {
    expect(Object.keys(ACTION_FIELDS)).toEqual([
      "category",
      "payee",
      "payee_name",
      "notes",
      "cleared",
      "account",
      "date",
      "amount",
    ]);
  });

  it("has a default that does not depend on key order", () => {
    expect(ACTION_FIELDS[DEFAULT_ACTION_FIELD]).toBeDefined();
  });

  it("allows templates and formulas on every field except the id-valued three (F-122)", () => {
    for (const field of ["payee", "category", "account"]) {
      expect(ACTION_FIELDS[field].supportsTemplate).toBeUndefined();
      expect(ACTION_FIELDS[field].supportsFormula).toBeUndefined();
    }
    for (const field of ["payee_name", "notes", "cleared", "date", "amount"]) {
      expect(ACTION_FIELDS[field].supportsTemplate).toBe(true);
      expect(ACTION_FIELDS[field].supportsFormula).toBe(true);
    }
  });

  it("marks the parent-only fields", () => {
    expect([...PARENT_ONLY_ACTION_FIELDS].sort()).toEqual(["account", "amount", "cleared", "date"]);
    expect(Object.keys(getSplitActionFields())).toEqual([
      "category",
      "payee",
      "payee_name",
      "notes",
    ]);
  });
});

describe("ACTION_OPS", () => {
  it("knows every op the engine accepts", () => {
    expect(Object.keys(ACTION_OPS).sort()).toEqual([
      "append-notes",
      "delete-transaction",
      "link-schedule",
      "prepend-notes",
      "set",
      "set-split-amount",
    ]);
  });

  it("offers only the four Actual puts in its dropdown", () => {
    expect([...ACTION_OP_OPTIONS]).toEqual([
      "set",
      "prepend-notes",
      "append-notes",
      "delete-transaction",
    ]);
  });

  it("marks delete-transaction as valueless", () => {
    expect(ACTION_OPS["delete-transaction"].hasValue).toBe(false);
  });
});

describe("ALLOCATION_METHODS", () => {
  it("matches Actual's four methods", () => {
    expect(Object.keys(ALLOCATION_METHODS)).toEqual([
      "fixed-amount",
      "fixed-percent",
      "formula",
      "remainder",
    ]);
  });
});
