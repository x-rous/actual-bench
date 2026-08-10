import type { NeedleFloor, TextMatchConfig, TextTarget } from "../types";
import {
  buildTextCorpus,
  containmentSimilarity,
  evaluateTarget,
  normalizeForCompare,
  passesNeedleFloor,
  scoreText,
  symmetricSimilarity,
  tokenOverlap,
} from "./text";

const FLOOR: NeedleFloor = { minChars: 6, minTokens: 2, maxCorpusFrequency: 0.3 };

function target(overrides: Partial<TextTarget> & Pick<TextTarget, "field">): TextTarget {
  return {
    enabled: true,
    priority: 1,
    weight: 1,
    mode: overrides.field === "notes" ? "containment" : "symmetric",
    preprocess: overrides.field === "notes" ? ["strip-tags"] : [],
    ...overrides,
  };
}

function config(overrides: Partial<TextMatchConfig> = {}): TextMatchConfig {
  return {
    targets: [
      target({ field: "notes", priority: 1 }),
      target({ field: "importedPayee", priority: 2 }),
      target({ field: "payeeName", priority: 3 }),
    ],
    combine: "best-of",
    priorityFirstThreshold: 0.6,
    ignoreTagsInNotes: true,
    ...overrides,
  };
}

describe("normalizeForCompare", () => {
  it("upper-cases, strips punctuation to spaces, and collapses whitespace", () => {
    expect(normalizeForCompare("AMZN Mktp AE*2J8G4")).toBe("AMZN MKTP AE 2J8G4");
  });

  it("strips diacritics so Café and Cafe compare equal", () => {
    expect(normalizeForCompare("Café")).toBe(normalizeForCompare("Cafe"));
  });

  it("returns an empty string for nullish input", () => {
    expect(normalizeForCompare(null)).toBe("");
    expect(normalizeForCompare("   ")).toBe("");
  });
});

describe("symmetricSimilarity — payee-style fields", () => {
  it("scores identical text as 1", () => {
    expect(symmetricSimilarity("Starbucks", "STARBUCKS")).toBe(1);
  });

  it("scores a shared stem highly", () => {
    expect(symmetricSimilarity("CARREFOUR MARKET", "Carrefour")).toBeGreaterThan(0.6);
  });

  it("does not reward unrelated merchants", () => {
    expect(symmetricSimilarity("DUBAI TAXI", "Netflix")).toBeLessThan(0.3);
  });

  it("is zero when either side is empty", () => {
    expect(symmetricSimilarity("", "Amazon")).toBe(0);
  });

  it("documents the known alias limitation: AMZN does not reach Amazon on text alone", () => {
    // RD-071 §5.3 limitation 1. Such a pair still matches on exact amount + close
    // date; it simply carries no text evidence. Learned aliases are deferred.
    expect(symmetricSimilarity("AMZN Mktp AE*2J8G4", "Amazon")).toBeLessThan(0.5);
  });
});

describe("tokenOverlap", () => {
  it("uses the smaller set as the denominator, so an extra token does not halve the score", () => {
    expect(tokenOverlap(["AMAZON", "AE"], ["AMAZON"])).toBe(1);
  });

  it("is zero for disjoint token sets", () => {
    expect(tokenOverlap(["A"], ["B"])).toBe(0);
  });
});

describe("containmentSimilarity — the notes case", () => {
  it("scores a contiguous hit as 1 even when the note carries the user's own additions", () => {
    // The load-bearing case: notes hold the bank text verbatim plus user text.
    expect(
      containmentSimilarity("TALABAT AE 88721", "TALABAT AE 88721 #One | Dinner with family")
    ).toBe(1);
  });

  it("beats a symmetric comparison on that same pair", () => {
    const statement = "TALABAT AE 88721";
    const notes = "TALABAT AE 88721 #One | Dinner with family";
    expect(containmentSimilarity(statement, notes)).toBeGreaterThan(
      symmetricSimilarity(statement, notes)
    );
  });

  it("is token-aligned: FEE does not match inside COFFEE", () => {
    expect(containmentSimilarity("FEE", "COFFEE SHOP")).toBe(0);
  });

  it("falls back to the fraction of needle tokens present", () => {
    expect(containmentSimilarity("DUBAI TAXI CORP", "Paid DUBAI TAXI today")).toBeCloseTo(2 / 3);
  });

  it("is zero when either side is empty", () => {
    expect(containmentSimilarity("", "anything")).toBe(0);
    expect(containmentSimilarity("anything", "")).toBe(0);
  });
});

describe("passesNeedleFloor", () => {
  it("rejects a short single-token needle", () => {
    expect(passesNeedleFloor("FEE", FLOOR)).toBe(false);
  });

  it("accepts a short needle that carries enough tokens", () => {
    expect(passesNeedleFloor("UB ER", FLOOR)).toBe(true);
  });

  it("accepts a long single-token needle", () => {
    expect(passesNeedleFloor("CARREFOUR", FLOOR)).toBe(true);
  });

  it("rejects a needle whose every token is common across the corpus", () => {
    const corpus = buildTextCorpus(
      Array.from({ length: 12 }, (_, i) => `MONTHLY PAYMENT ref${i}`)
    );
    expect(passesNeedleFloor("MONTHLY PAYMENT", FLOOR, corpus)).toBe(false);
  });

  it("keeps a needle that carries at least one rare token", () => {
    const corpus = buildTextCorpus([
      ...Array.from({ length: 11 }, (_, i) => `MONTHLY PAYMENT ref${i}`),
      "MONTHLY PAYMENT CARREFOUR",
    ]);
    expect(passesNeedleFloor("PAYMENT CARREFOUR", FLOOR, corpus)).toBe(true);
  });

  it("ignores corpus frequency when the candidate window is too small to be meaningful", () => {
    // In a 3-document corpus the smallest non-zero frequency is 0.33, which
    // would exceed maxCorpusFrequency and reject every needle.
    const corpus = buildTextCorpus(["CARREFOUR one", "CARREFOUR two", "CARREFOUR three"]);
    expect(passesNeedleFloor("CARREFOUR", FLOOR, corpus)).toBe(true);
  });
});

describe("evaluateTarget", () => {
  const values = {
    payeeName: "Talabat",
    importedPayee: null,
    notes: "TALABAT AE 88721 #One | Dinner with family",
  };

  it("strips tags from notes before comparing", () => {
    const result = evaluateTarget("TALABAT AE 88721", values, target({ field: "notes" }), FLOOR);
    expect(result.similarity).toBe(1);
  });

  it("emits a reason naming the field and mode", () => {
    const result = evaluateTarget("TALABAT AE 88721", values, target({ field: "notes" }), FLOOR);
    expect(result.reasons).toEqual([
      { kind: "text", field: "notes", mode: "containment", similarity: 1 },
    ]);
  });

  it("skips an empty field with an explanatory reason rather than scoring zero", () => {
    const result = evaluateTarget(
      "TALABAT AE 88721",
      values,
      target({ field: "importedPayee" }),
      FLOOR
    );
    expect(result.similarity).toBeNull();
    expect(result.reasons).toEqual([
      { kind: "text-skipped", field: "importedPayee", why: "empty" },
    ]);
  });

  it("skips a below-floor needle under containment", () => {
    const result = evaluateTarget("FEE", values, target({ field: "notes" }), FLOOR);
    expect(result.similarity).toBeNull();
    expect(result.reasons).toEqual([
      { kind: "text-skipped", field: "notes", why: "below-needle-floor" },
    ]);
  });

  it("does not apply the needle floor to symmetric targets", () => {
    // Both sides constrain each other under `symmetric`, so a short string is
    // not dangerous there.
    const result = evaluateTarget("FEE", { ...values, payeeName: "Fee" }, target({ field: "payeeName" }), FLOOR);
    expect(result.similarity).toBe(1);
  });

  it("scales by the target weight", () => {
    const result = evaluateTarget(
      "TALABAT AE 88721",
      values,
      target({ field: "notes", weight: 0.5 }),
      FLOOR
    );
    expect(result.similarity).toBe(0.5);
  });

  it("skips everything when the statement has no usable text", () => {
    const result = evaluateTarget("", values, target({ field: "notes" }), FLOOR);
    expect(result.reasons).toEqual([
      { kind: "text-skipped", field: "notes", why: "no-statement-text" },
    ]);
  });
});

describe("scoreText — combination modes", () => {
  it("best-of takes the max, so an empty field does not dilute the score", () => {
    const result = scoreText(
      "TALABAT AE 88721",
      { payeeName: "Talabat", importedPayee: null, notes: "TALABAT AE 88721 #One" },
      config(),
      FLOOR
    );
    expect(result.similarity).toBe(1);
    expect(result.field).toBe("notes");
  });

  it("best-of picks the payee when only the payee carries the evidence", () => {
    const result = scoreText(
      "STARBUCKS MALL OF EMIRATES",
      { payeeName: "Starbucks", importedPayee: null, notes: "Coffee with Sara" },
      config(),
      FLOOR
    );
    expect(result.field).toBe("payeeName");
  });

  it("priority-first takes the highest-priority target that clears the threshold", () => {
    const result = scoreText(
      "TALABAT AE 88721",
      { payeeName: "Talabat", importedPayee: null, notes: "TALABAT AE 88721" },
      config({ combine: "priority-first" }),
      FLOOR
    );
    expect(result.field).toBe("notes");
  });

  it("priority-first falls through when the top target is empty", () => {
    const result = scoreText(
      "STARBUCKS",
      { payeeName: "Starbucks", importedPayee: null, notes: null },
      config({ combine: "priority-first" }),
      FLOOR
    );
    expect(result.field).toBe("payeeName");
    expect(result.similarity).toBe(1);
  });

  it("returns null when no target could be scored", () => {
    const result = scoreText(
      "STARBUCKS",
      { payeeName: null, importedPayee: null, notes: null },
      config(),
      FLOOR
    );
    expect(result.similarity).toBeNull();
    expect(result.field).toBeNull();
    expect(result.reasons.every((r) => r.kind === "text-skipped")).toBe(true);
  });

  it("ignores disabled targets", () => {
    const result = scoreText(
      "TALABAT AE 88721",
      { payeeName: "Talabat", importedPayee: null, notes: "TALABAT AE 88721" },
      config({
        targets: [
          target({ field: "notes", enabled: false }),
          target({ field: "payeeName", priority: 2 }),
        ],
      }),
      FLOOR
    );
    expect(result.field).toBe("payeeName");
  });

  it("reports every target's outcome, scored or skipped, for the inspector", () => {
    const result = scoreText(
      "TALABAT AE 88721",
      { payeeName: "Talabat", importedPayee: null, notes: "TALABAT AE 88721" },
      config(),
      FLOOR
    );
    const fields = result.reasons.map((r) => (r.kind === "text" || r.kind === "text-skipped" ? r.field : null));
    expect(fields).toEqual(["notes", "importedPayee", "payeeName"]);
  });
});
