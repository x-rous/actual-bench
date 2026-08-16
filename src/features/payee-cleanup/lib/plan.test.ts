import { buildPlan, planIsEmpty, validatePlan, type CleanupPlan } from "./plan";
import type { CleanupSuggestion } from "./scan";
import type { PayeeCleanupCandidate } from "../types";

function payee(
  id: string,
  name = id.toUpperCase(),
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
      ...overrides,
    },
  };
}

function context(...payees: PayeeCleanupCandidate[]) {
  return { byId: new Map(payees.map((p) => [p.id, p])) };
}

function suggestion(
  members: PayeeCleanupCandidate[],
  targetId: string,
  canonicalName: string,
  decision: "accepted" | "undecided" | "rejected" = "accepted"
): CleanupSuggestion {
  return {
    cluster: {
      id: members.map((m) => m.id).join("+"),
      members,
      stem: "STEM",
      evidence: [],
      fuzzyOnly: false,
    },
    target: { targetId, scores: [], reasons: [] },
    canonicalName,
    membersToMerge: members.filter((m) => m.id !== targetId),
    confidence: { score: 95, band: "high", reasons: [] },
    correction: { decision, excludedIds: [], addedIds: [] },
  };
}

describe("buildPlan", () => {
  const members = [payee("p1", "WOOLWORTHS 0183"), payee("p2", "Woolworths")];

  it("stages a native merge with the target and its sources", () => {
    const plan = buildPlan([suggestion(members, "p2", "Woolworths")]);

    expect(plan.merges).toEqual([
      {
        kind: "merge-payees",
        targetId: "p2",
        mergeIds: ["p1"],
        targetName: "Woolworths",
        memberNames: ["WOOLWORTHS 0183"],
      },
    ]);
  });

  it("ignores proposals the user has not accepted", () => {
    expect(planIsEmpty(buildPlan([suggestion(members, "p2", "Woolworths", "undecided")]))).toBe(
      true
    );
    expect(planIsEmpty(buildPlan([suggestion(members, "p2", "Woolworths", "rejected")]))).toBe(
      true
    );
  });

  it("adds a rename only when the final name actually differs", () => {
    // Renaming a payee to what it is already called is a write with no effect,
    // and it would appear in the review screen as work the user never asked for.
    expect(buildPlan([suggestion(members, "p2", "Woolworths")]).renames).toEqual([]);

    const renamed = buildPlan([suggestion(members, "p1", "Woolworths")]);
    expect(renamed.renames).toEqual([
      { kind: "rename-payee", payeeId: "p1", from: "WOOLWORTHS 0183", to: "Woolworths" },
    ]);
  });

  it("emits no merge when the cluster is down to the target alone", () => {
    const single = suggestion([payee("p1")], "p1", "Renamed");
    expect(buildPlan([single]).merges).toEqual([]);
  });

  it("includes orphan deletions", () => {
    const plan = buildPlan([], [payee("p9", "Old Test Payee")]);
    expect(plan.deletions).toEqual([
      { kind: "delete-payee", payeeId: "p9", name: "Old Test Payee" },
    ]);
  });
});

describe("validatePlan", () => {
  const target = payee("t1", "Woolworths");
  const source = payee("s1", "WOOLWORTHS 0183");

  function merge(overrides: Partial<CleanupPlan["merges"][number]> = {}) {
    return {
      merges: [
        {
          kind: "merge-payees" as const,
          targetId: "t1",
          mergeIds: ["s1"],
          targetName: "Woolworths",
          memberNames: ["WOOLWORTHS 0183"],
          ...overrides,
        },
      ],
      renames: [],
      deletions: [],
      rules: [],
    };
  }

  it("accepts a well-formed plan", () => {
    expect(validatePlan(merge(), context(target, source))).toEqual([]);
  });

  it("blocks a merge into a payee that no longer exists", () => {
    const problems = validatePlan(merge(), context(source));
    expect(problems[0].message).toMatch(/no longer exists/i);
  });

  it("blocks a transfer payee as the target", () => {
    // Actual returns early and silently here, so the merge would report success
    // and change nothing at all.
    const transferTarget = payee("t1", "Transfer", { transferAccountId: "a1" });
    const problems = validatePlan(merge(), context(transferTarget, source));
    expect(problems.some((p) => /Actual manages it/i.test(p.message))).toBe(true);
  });

  it("blocks a transfer payee as a source", () => {
    const transferSource = payee("s1", "Transfer", { transferAccountId: "a1" });
    const problems = validatePlan(merge(), context(target, transferSource));
    expect(problems.some((p) => /Actual manages it/i.test(p.message))).toBe(true);
  });

  it("blocks a payee merging into itself", () => {
    const problems = validatePlan(
      merge({ mergeIds: ["t1"] }),
      context(target, source)
    );
    expect(problems.some((p) => /into itself/i.test(p.message))).toBe(true);
  });

  it("blocks the same payee listed twice in one merge", () => {
    const problems = validatePlan(
      merge({ mergeIds: ["s1", "s1"] }),
      context(target, source)
    );
    expect(problems.some((p) => /same payee twice/i.test(p.message))).toBe(true);
  });

  it("blocks one payee merging into two different targets", () => {
    const other = payee("t2", "Woolies");
    const plan: CleanupPlan = {
      merges: [
        { kind: "merge-payees", targetId: "t1", mergeIds: ["s1"], targetName: "Woolworths", memberNames: ["x"] },
        { kind: "merge-payees", targetId: "t2", mergeIds: ["s1"], targetName: "Woolies", memberNames: ["x"] },
      ],
      renames: [],
      deletions: [],
      rules: [],
    };
    const problems = validatePlan(plan, context(target, other, source));
    expect(problems.some((p) => /more than one payee/i.test(p.message))).toBe(true);
  });

  it("blocks a target that another merge is taking away", () => {
    // The merge would point at a payee Actual is about to tombstone.
    const other = payee("t2", "Woolies");
    const plan: CleanupPlan = {
      merges: [
        { kind: "merge-payees", targetId: "t1", mergeIds: ["s1"], targetName: "Woolworths", memberNames: ["x"] },
        { kind: "merge-payees", targetId: "t2", mergeIds: ["t1"], targetName: "Woolies", memberNames: ["y"] },
      ],
      renames: [],
      deletions: [],
      rules: [],
    };
    const problems = validatePlan(plan, context(target, other, source));
    expect(problems.some((p) => /cannot also be the one kept/i.test(p.message))).toBe(true);
  });

  it("blocks a rename aimed at a payee being merged away", () => {
    // The save pipeline renames before it merges, so this rename would be lost.
    const plan: CleanupPlan = {
      ...merge(),
      renames: [{ kind: "rename-payee", payeeId: "s1", from: "WOOLWORTHS 0183", to: "Woolworths" }],
    };
    const problems = validatePlan(plan, context(target, source));
    expect(problems.some((p) => /being merged away/i.test(p.message))).toBe(true);
  });

  it("blocks a rename to an empty name", () => {
    const plan: CleanupPlan = {
      merges: [],
      renames: [{ kind: "rename-payee", payeeId: "t1", from: "Woolworths", to: "  " }],
      deletions: [],
      rules: [],
    };
    const problems = validatePlan(plan, context(target));
    expect(problems.some((p) => /empty name/i.test(p.message))).toBe(true);
  });

  it("blocks deleting a payee that a merge is keeping", () => {
    const plan: CleanupPlan = {
      ...merge(),
      deletions: [{ kind: "delete-payee", payeeId: "t1", name: "Woolworths" }],
    };
    const problems = validatePlan(plan, context(target, source));
    expect(problems.some((p) => /kept by a merge/i.test(p.message))).toBe(true);
  });

  it("blocks a payee set to be both merged and deleted", () => {
    const plan: CleanupPlan = {
      ...merge(),
      deletions: [{ kind: "delete-payee", payeeId: "s1", name: "WOOLWORTHS 0183" }],
    };
    const problems = validatePlan(plan, context(target, source));
    expect(problems.some((p) => /merged and deleted/i.test(p.message))).toBe(true);
  });

  it("blocks deleting a transfer payee", () => {
    const plan: CleanupPlan = {
      merges: [],
      renames: [],
      deletions: [{ kind: "delete-payee", payeeId: "x1", name: "Transfer" }],
      rules: [],
    };
    const problems = validatePlan(
      plan,
      context(payee("x1", "Transfer", { transferAccountId: "a1" }))
    );
    expect(problems.some((p) => /Actual manages it/i.test(p.message))).toBe(true);
  });

  it("reports every problem at once", () => {
    // Fixing them one at a time through repeated re-validation is a bad
    // afternoon, so the plan reports the whole graph's issues together.
    const plan: CleanupPlan = {
      merges: [
        { kind: "merge-payees", targetId: "gone", mergeIds: ["also-gone"], targetName: "Gone", memberNames: ["x"] },
      ],
      renames: [{ kind: "rename-payee", payeeId: "missing", from: "Missing", to: "New" }],
      deletions: [{ kind: "delete-payee", payeeId: "absent", name: "Absent" }],
      rules: [],
    };
    expect(validatePlan(plan, context()).length).toBeGreaterThanOrEqual(3);
  });

  it("blocks a rule pointing at a payee being merged away", () => {
    // RD-078 §21: rule creation must never target a payee scheduled to vanish.
    const plan: CleanupPlan = {
      ...merge(),
      rules: [
        {
          kind: "create-rule",
          targetPayeeId: "s1",
          targetName: "WOOLWORTHS 0183",
          field: "imported_payee",
          op: "matches",
          value: "^WOOLWORTHS\\b",
          description: 'starts with "WOOLWORTHS"',
          expectedMatches: 40,
        },
      ],
    };
    const problems = validatePlan(plan, context(target, source));
    expect(problems.some((p) => /being merged away/i.test(p.message))).toBe(true);
  });

  it("blocks a rule with no pattern", () => {
    const plan: CleanupPlan = {
      merges: [],
      renames: [],
      deletions: [],
      rules: [
        {
          kind: "create-rule",
          targetPayeeId: "t1",
          targetName: "Woolworths",
          field: "imported_payee",
          op: "contains",
          value: "  ",
          description: "empty",
          expectedMatches: 0,
        },
      ],
    };
    const problems = validatePlan(plan, context(target));
    expect(problems.some((p) => /no pattern/i.test(p.message))).toBe(true);
  });

  it("blocks two groups that would both end up with the same name", () => {
    // The defect this guard exists for: three "Optus" groups each merging
    // validly, then all renaming their survivor to "Optus" — leaving three
    // payees called Optus and reintroducing the duplication the user came here
    // to remove. Each merge is individually fine, so only a whole-plan check
    // catches it.
    const a = payee("a1", "OPTUS 636aeb98050");
    const b = payee("b1", "Optus PrePaid Melbourne");
    const plan: CleanupPlan = {
      merges: [
        { kind: "merge-payees", targetId: "a1", mergeIds: ["a2"], targetName: "OPTUS 636aeb98050", memberNames: ["x"] },
        { kind: "merge-payees", targetId: "b1", mergeIds: ["b2"], targetName: "Optus PrePaid Melbourne", memberNames: ["y"] },
      ],
      renames: [
        { kind: "rename-payee", payeeId: "a1", from: "OPTUS 636aeb98050", to: "Optus" },
        { kind: "rename-payee", payeeId: "b1", from: "Optus PrePaid Melbourne", to: "Optus" },
      ],
      deletions: [],
      rules: [],
    };

    const problems = validatePlan(
      plan,
      context(a, b, payee("a2"), payee("b2"))
    );
    expect(
      problems.some((p) => /would all end up named "OPTUS"/i.test(p.message))
    ).toBe(true);
  });

  it("compares final names ignoring case and spacing", () => {
    const plan: CleanupPlan = {
      merges: [],
      renames: [
        { kind: "rename-payee", payeeId: "t1", from: "Woolworths", to: "coles" },
        { kind: "rename-payee", payeeId: "s1", from: "WOOLWORTHS 0183", to: "COLES  " },
      ],
      deletions: [],
      rules: [],
    };
    const problems = validatePlan(plan, context(target, source));
    expect(problems.some((p) => /all end up named/i.test(p.message))).toBe(true);
  });

  it("blocks renaming onto a payee the cleanup is not touching", () => {
    const bystander = payee("x1", "Optus");
    const plan: CleanupPlan = {
      merges: [],
      renames: [{ kind: "rename-payee", payeeId: "t1", from: "Woolworths", to: "Optus" }],
      deletions: [],
      rules: [],
    };
    const problems = validatePlan(plan, context(target, bystander));
    expect(
      problems.some((p) => /already exists and is not part of this cleanup/i.test(p.message))
    ).toBe(true);
  });

  it("does not complain when the colliding payee is being merged away", () => {
    // Merging `Woolworths 0183` into `Woolworths` and renaming the survivor to
    // `Woolworths` is the normal case, not a collision.
    const plan: CleanupPlan = {
      ...merge(),
      renames: [{ kind: "rename-payee", payeeId: "t1", from: "Woolworths", to: "WOOLWORTHS 0183" }],
    };
    expect(validatePlan(plan, context(target, source))).toEqual([]);
  });

  it("marks everything it reports as blocking", () => {
    const problems = validatePlan(merge(), context(source));
    expect(problems.every((p) => p.severity === "blocking")).toBe(true);
  });
});
