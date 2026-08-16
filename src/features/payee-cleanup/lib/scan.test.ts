import { scanForCleanup } from "./scan";
import { partitionByEligibility } from "./eligibility";
import type { PayeeCleanupCandidate } from "../types";

function payee(
  name: string,
  overrides: Partial<PayeeCleanupCandidate["metadata"]> = {}
): PayeeCleanupCandidate {
  const id = `p-${name}`;
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

function scan(candidates: PayeeCleanupCandidate[]) {
  return scanForCleanup(partitionByEligibility(candidates));
}

describe("scanForCleanup", () => {
  it("reports what was analyzed and what was excluded", () => {
    const result = scan([
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("Transfer: Savings", { transferAccountId: "acct-1" }),
      payee("Deleted Payee", { tombstone: true }),
    ]);

    expect(result.analyzedCount).toBe(2);
    expect(result.excludedTransferCount).toBe(1);
    expect(result.excludedTombstonedCount).toBe(1);
  });

  it("produces a suggestion with evidence, confidence, target and final name", () => {
    const result = scan([
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("WOOLWORTHS 8442"),
      payee("Woolworths"),
    ]);

    expect(result.suggestions).toHaveLength(1);
    const suggestion = result.suggestions[0];

    expect(suggestion.cluster.members).toHaveLength(4);
    expect(suggestion.cluster.evidence.length).toBeGreaterThan(0);
    expect(suggestion.confidence.band).toBe("high");
    // The clean, human-readable payee should win the target score and supply
    // the final name — no invention needed.
    expect(
      suggestion.cluster.members.find((m) => m.id === suggestion.target.targetId)
        ?.name
    ).toBe("Woolworths");
    expect(suggestion.canonicalName).toBe("Woolworths");
    expect(suggestion.membersToMerge).toHaveLength(3);
  });

  it("excludes the target from the members to merge", () => {
    const result = scan([payee("AMAZON"), payee("Amazon"), payee("amazon")]);
    const suggestion = result.suggestions[0];

    expect(
      suggestion.membersToMerge.map((m) => m.id)
    ).not.toContain(suggestion.target.targetId);
  });

  it("prefers a favorite payee as the merge target", () => {
    // Merge does not transfer `favorite`; the target's own value survives, so
    // choosing the favorite is how the user keeps it.
    const result = scan([
      payee("AMAZON 1234"),
      payee("AMAZON 5678"),
      payee("AMAZON", { favorite: true }),
    ]);

    const suggestion = result.suggestions[0];
    const target = suggestion.cluster.members.find(
      (m) => m.id === suggestion.target.targetId
    );
    expect(target?.name).toBe("AMAZON");
    expect(suggestion.target.reasons.join(" ")).toContain("favorite");
  });

  it("counts suggestions by confidence band", () => {
    const result = scan([
      payee("WOOLWORTHS 0183"),
      payee("WOOLWORTHS 0291"),
      payee("Acme Ltd"),
      payee("Acme"),
    ]);

    expect(result.counts.high + result.counts.strong).toBeGreaterThanOrEqual(1);
    expect(result.suggestions.length).toBe(2);
  });

  it("scores a legal-suffix-only difference below a structural match", () => {
    const structural = scan([payee("TESCO 0001"), payee("TESCO 0002")])
      .suggestions[0];
    const legal = scan([payee("Acme Ltd"), payee("Acme")]).suggestions[0];

    expect(legal.confidence.score).toBeLessThan(structural.confidence.score);
    expect(legal.confidence.reasons.map((r) => r.reason).join(" ")).toContain(
      "interpreted change"
    );
  });

  it("orders suggestions strongest first", () => {
    const result = scan([
      payee("Acme Ltd"),
      payee("Acme"),
      payee("TESCO 0001"),
      payee("TESCO 0002"),
    ]);

    const scores = result.suggestions.map((s) => s.confidence.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
  });

  it("returns nothing for a budget with no variants", () => {
    const result = scan([
      payee("Woolworths"),
      payee("Tesco"),
      payee("Netflix"),
    ]);
    expect(result.suggestions).toEqual([]);
  });

  it("returns nothing for an empty budget", () => {
    const result = scan([]);
    expect(result.analyzedCount).toBe(0);
    expect(result.suggestions).toEqual([]);
  });
});

describe("a group the user has edited", () => {
  function scanWith(candidates: PayeeCleanupCandidate[], corrections: Record<string, unknown>) {
    return scanForCleanup(partitionByEligibility(candidates), {
      corrections: corrections as never,
    });
  }

  it("drops the detector's stem once members were added", () => {
    // The stem described the payees the detector grouped. Keeping it after the
    // user combined two groups builds the rule from text most of the group does
    // not contain — a pattern of `LEVEL 5 406 VI` for a payee named "Optus".
    const candidates = [
      payee("COLES 0559"),
      payee("COLES 0291"),
      payee("Optus"),
    ];

    const before = scanWith(candidates, {});
    const first = before.suggestions[0];
    expect(first.cluster.stem).toBe("COLES");

    const after = scanWith(candidates, {
      [first.cluster.id]: {
        decision: "undecided",
        excludedIds: [],
        addedIds: [candidates[2].id],
      },
    });
    const edited = after.suggestions.find((s) => s.cluster.id === first.cluster.id);

    expect(edited?.cluster.userEdited).toBe(true);
    expect(edited?.cluster.stem).toBeNull();
  });

  it("leaves an untouched group's stem alone", () => {
    const result = scanWith([payee("COLES 0559"), payee("COLES 0291")], {});
    expect(result.suggestions[0].cluster.userEdited).toBeUndefined();
    expect(result.suggestions[0].cluster.stem).not.toBeNull();
  });
});

describe("false-positive corpus", () => {
  /**
   * Names that must NEVER be clustered together. Each pair is a real-world
   * shape where an over-eager detector would merge two genuinely different
   * businesses — the failure mode that would make this feature untrustworthy.
   */
  const mustNotCluster: Array<[string, string, string]> = [
    ["EMIRATES", "EMIRATES NBD", "airline vs bank — one name contains the other"],
    ["WOOLWORTHS", "WOOLWORTHS MOBILE", "retailer vs its phone brand"],
    ["HSBC UAE", "HSBC UK", "same bank, deliberately separate countries"],
    ["Apple", "Apple Store", "extra word is a different entity"],
    ["CARD FACTORY", "FACTORY", "a real shop starting with a wrapper-ish word"],
    ["Uber", "Uber Eats", "ride-hailing vs food delivery"],
    ["Tesco", "Costa", "unrelated names of similar length"],
    ["Shell", "Shelter", "shared prefix, different merchants"],
  ];

  it.each(mustNotCluster)("keeps %s and %s apart (%s)", (left, right) => {
    const result = scan([payee(left), payee(right)]);

    for (const suggestion of result.suggestions) {
      const names = suggestion.cluster.members.map((m) => m.name);
      expect(names.includes(left) && names.includes(right)).toBe(false);
    }
  });

  it("does not merge a sub-brand into its parent even at high character similarity", () => {
    // `EMIRATES` vs `EMIRATES NBD` scores very highly on raw character overlap
    // precisely because one contains the other. The subset guard, not the
    // threshold, is what keeps them apart.
    const result = scan([payee("EMIRATES"), payee("EMIRATES NBD")]);
    expect(result.suggestions).toEqual([]);
  });
});
