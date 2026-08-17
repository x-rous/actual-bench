import {
  annotateNoise,
  detectionSummary,
  findNameCollisions,
  isSafeForBulkAccept,
  triageBadges,
} from "./triage";
import type { CleanupSuggestion } from "./scan";
import type { PayeeCleanupCandidate } from "../types";

function payee(id: string, name = id): PayeeCleanupCandidate {
  return {
    id,
    name,
    metadata: {
      id,
      favorite: false,
      learnCategories: true,
      tombstone: false,
      transferAccountId: null,
    },
  };
}

function suggestion(overrides: Partial<CleanupSuggestion> = {}): CleanupSuggestion {
  const members = [payee("p1"), payee("p2")];
  return {
    cluster: {
      id: "c1",
      members,
      stem: "STEM",
      evidence: [
        {
          detectorId: "full-reduction",
          kind: "structural",
          label: "Removed the card number",
          detail: "STEM",
        },
      ],
      fuzzyOnly: false,
    },
    target: { targetId: "p1", scores: [], reasons: [] },
    canonicalName: "Result",
    membersToMerge: [members[1]],
    confidence: { score: 96, band: "high", reasons: [] },
    correction: { decision: "undecided", excludedIds: [], addedIds: [] },
    impact: {
      transactionTotal: 12,
      transactionsLoading: false,
      rules: { regular: 0, activeSchedule: 0, completedSchedule: 0 },
      behavior: {
        favoriteDiffers: false,
        learnCategoriesDiffers: false,
        survivingFavorite: false,
        survivingLearnCategories: true,
      },
      members: [],
    },
    ...overrides,
  };
}

describe("triageBadges", () => {
  it("keeps a clean result quiet", () => {
    const badges = triageBadges(suggestion());
    expect(badges.map((b) => b.label)).toEqual([
      "12 transactions",
      "No rules affected",
      "Settings match",
    ]);
    expect(badges.every((b) => b.tone !== "warning")).toBe(true);
  });

  it("says how many rules reference the payees, not that they conflict", () => {
    // Merging does not rewrite rules, so "1 rule conflict" would invent a
    // problem that does not exist.
    const badges = triageBadges(
      suggestion({
        impact: {
          ...suggestion().impact!,
          rules: { regular: 1, activeSchedule: 0, completedSchedule: 0 },
        },
      })
    );
    expect(badges.map((b) => b.label)).toContain("1 rule reference these");
  });

  it("raises a warning when payee settings differ", () => {
    const badges = triageBadges(
      suggestion({
        impact: {
          ...suggestion().impact!,
          behavior: {
            favoriteDiffers: true,
            learnCategoriesDiffers: false,
            survivingFavorite: false,
            survivingLearnCategories: true,
          },
        },
      })
    );
    const settings = badges.find((b) => b.id === "settings");
    expect(settings?.tone).toBe("warning");
  });

  it("does not say counting once the load has stopped without a number", () => {
    // A failed or disabled query leaves the total unknown and nothing running,
    // and "counting…" forever describes work that is not happening.
    const badges = triageBadges(
      suggestion({
        impact: {
          ...suggestion().impact!,
          transactionTotal: undefined,
          transactionsLoading: false,
        },
      })
    );
    expect(badges[0].label).toMatch(/unavailable/i);
    expect(badges[0].tone).toBe("warning");
  });

  it("does not claim a transaction count while it is loading", () => {
    const badges = triageBadges(
      suggestion({
        impact: { ...suggestion().impact!, transactionTotal: undefined, transactionsLoading: true },
      })
    );
    expect(badges[0].label).toMatch(/counting/i);
  });
});

describe("isSafeForBulkAccept", () => {
  it("accepts a structural match with no conflicts", () => {
    expect(isSafeForBulkAccept(suggestion())).toBe(true);
  });

  it("refuses anything below the confident bands", () => {
    expect(
      isSafeForBulkAccept(
        suggestion({ confidence: { score: 70, band: "review", reasons: [] } })
      )
    ).toBe(false);
  });

  it("refuses a fuzzy-only match however it scored", () => {
    const base = suggestion();
    expect(
      isSafeForBulkAccept({
        ...base,
        cluster: { ...base.cluster, fuzzyOnly: true },
      })
    ).toBe(false);
  });

  it("refuses a match that needed an interpreted step", () => {
    // Corpus-learned boilerplate and company suffixes are guesses. "Accept
    // everything above 90%" would sweep up exactly the cases this feature
    // exists to catch.
    const base = suggestion();
    expect(
      isSafeForBulkAccept({
        ...base,
        cluster: {
          ...base.cluster,
          evidence: [
            ...base.cluster.evidence,
            {
              detectorId: "full-reduction",
              kind: "contextual",
              label: 'Shared trailing text ("au aus", on 29 payees)',
              detail: "STEM",
            },
          ],
        },
      })
    ).toBe(false);
  });

  it("refuses when payee settings differ", () => {
    expect(
      isSafeForBulkAccept(
        suggestion({
          impact: {
            ...suggestion().impact!,
            behavior: {
              favoriteDiffers: true,
              learnCategoriesDiffers: false,
              survivingFavorite: false,
              survivingLearnCategories: true,
            },
          },
        })
      )
    ).toBe(false);
  });

  it("refuses while the blast radius is still unknown", () => {
    expect(
      isSafeForBulkAccept(
        suggestion({
          impact: {
            ...suggestion().impact!,
            transactionTotal: undefined,
            transactionsLoading: true,
          },
        })
      )
    ).toBe(false);
  });

  it("refuses when a proposed rule would catch other payees", () => {
    expect(
      isSafeForBulkAccept(
        suggestion({
          futureResolution: {
            exactName: { covered: 0, transactionCount: 0 },
            relatedRules: [],
            candidates: [],
            recommended: {
              candidate: {
                field: "imported_payee",
                op: "matches",
                value: "^X",
                description: "",
              },
              expectedMatches: 10,
              unexpectedMatches: 2,
              unexpectedExamples: [],
              matchedTexts: 3,
            },
            skipReason: null,
            safeToPreselect: false,
            matchText: "X",
            historyTruncated: false,
          },
        })
      )
    ).toBe(false);
  });

  it("refuses when the backtest ran over a truncated history", () => {
    // "Catches nothing else" from a partial read is not a basis for accepting
    // without looking.
    expect(
      isSafeForBulkAccept(
        suggestion({
          futureResolution: {
            exactName: { covered: 0, transactionCount: 0 },
            relatedRules: [],
            candidates: [],
            recommended: {
              candidate: {
                field: "imported_payee",
                op: "matches",
                value: "^X",
                description: "",
              },
              expectedMatches: 10,
              unexpectedMatches: 0,
              unexpectedExamples: [],
              matchedTexts: 3,
            },
            skipReason: null,
            safeToPreselect: false,
            matchText: "X",
            historyTruncated: true,
          },
        })
      )
    ).toBe(false);
  });

  it("refuses when an existing rule might conflict", () => {
    expect(
      isSafeForBulkAccept(
        suggestion({
          futureResolution: {
            exactName: { covered: 0, transactionCount: 0 },
            relatedRules: [
              {
                rule: {
                  id: "r1",
                  stage: "default",
                  conditionsOp: "and",
                  conditions: [],
                  actions: [],
                },
                kind: "payee-resolution",
                interaction: "potential-conflict",
              },
            ],
            candidates: [],
            recommended: null,
            skipReason: null,
            safeToPreselect: false,
            matchText: "X",
            historyTruncated: false,
          },
        })
      )
    ).toBe(false);
  });
});

describe("detectionSummary", () => {
  it("does not describe a grouping the user has since changed", () => {
    const base = suggestion();
    expect(
      detectionSummary({
        ...base,
        cluster: { ...base.cluster, userEdited: true },
      })
    ).toBe("Grouped by you");
  });

  it("summarises the detector's findings for an untouched group", () => {
    expect(detectionSummary(suggestion())).toMatch(/^Detected /);
  });
});

describe("findNameCollisions", () => {
  function accepted(name: string, id: string): CleanupSuggestion {
    const base = suggestion();
    return {
      ...base,
      cluster: { ...base.cluster, id },
      canonicalName: name,
      correction: { ...base.correction, decision: "accepted" },
    };
  }

  it("finds accepted groups that would share a payee name", () => {
    const collisions = findNameCollisions([
      accepted("Optus", "a"),
      accepted("Optus", "b"),
      accepted("Woolworths", "c"),
    ]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].finalName).toBe("Optus");
    expect(collisions[0].suggestions).toHaveLength(2);
  });

  it("ignores groups the user has not accepted", () => {
    // An un-accepted group is not going to be staged, so it cannot collide.
    const base = suggestion();
    expect(
      findNameCollisions([
        accepted("Optus", "a"),
        { ...base, cluster: { ...base.cluster, id: "b" }, canonicalName: "Optus" },
      ])
    ).toEqual([]);
  });

  it("compares names ignoring case and spacing", () => {
    expect(
      findNameCollisions([accepted("Optus", "a"), accepted("OPTUS  ", "b")])
    ).toHaveLength(1);
  });
});

describe("annotateNoise", () => {
  it("marks the removed spans so the user can see why", () => {
    const parts = annotateNoise("COLES 0559 02MAR25", ["0559 02MAR25"]);
    expect(parts.map((p) => p.text).join("")).toBe("COLES 0559 02MAR25");
    expect(parts.some((p) => p.noise)).toBe(true);
  });

  it("handles a removal recorded as several pieces", () => {
    const parts = annotateNoise("ACME Card xx1234 12/03/2024", [
      "Card xx1234 · 12/03/2024",
    ]);
    const noise = parts.filter((p) => p.noise).map((p) => p.text);
    expect(noise).toContain("Card xx1234");
    expect(noise).toContain("12/03/2024");
  });

  it("leaves the name intact when a removal cannot be located", () => {
    // An earlier step may already have rewritten that span; approximating it
    // would strike through the wrong characters.
    expect(annotateNoise("ACME", ["something else"])).toEqual([
      { text: "ACME", noise: false },
    ]);
  });

  it("keeps the offsets aligned when upper-casing would change length", () => {
    // `ß` upper-cases to `SS`, so searching an upper-cased copy and slicing the
    // original shifted every later index and struck through the wrong letters.
    const parts = annotateNoise("STRAßE 12 Card xx4534", ["Card xx4534"]);
    expect(parts.map((p) => p.text).join("")).toBe("STRAßE 12 Card xx4534");
    expect(parts.filter((p) => p.noise).map((p) => p.text)).toEqual([
      "Card xx4534",
    ]);
  });

  it("never loses or duplicates a character", () => {
    const raw = "TARGET 5121 PRESTON AU AUS Card xx9166 Value Date: 07/01/2025";
    const parts = annotateNoise(raw, ["AU AUS", "Card xx9166", "Value Date: 07/01/2025"]);
    expect(parts.map((p) => p.text).join("")).toBe(raw);
  });
});
