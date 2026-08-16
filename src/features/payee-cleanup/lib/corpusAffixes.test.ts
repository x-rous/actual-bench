import { findCorpusAffixes } from "./corpusAffixes";
import { reduceFully } from "./reduce";

/**
 * The corpus learner replaces every vocabulary the engine used to carry —
 * cities, countries, channel prefixes, one bank's tag words.
 *
 * These tests use payee sets from three unrelated banks, plus an invented
 * fourth, precisely to show the mechanism is not tuned to any of them: the same
 * rule finds a UAE channel wrapper, an Australian source tag and a French one it
 * has never seen.
 */

function phrases(names: string[], kind: "prefix" | "suffix"): string[] {
  return findCorpusAffixes(names)
    .filter((a) => a.kind === kind)
    .map((a) => a.tokens.join(" "));
}

describe("learning a bank's boilerplate", () => {
  const uae = [
    "NFC - (AP-PAY)- DESCO COPY CENTRE DUBAI ARE",
    "NFC - (SM-PAY)- MATALAN DUBAI UAE",
    "NFC - (AP-PAY)- SUBWAY DUBAI UAE",
    "NFC - (SM-PAY)- TIM HORTONS DUBAI 784",
    "NFC - (SM-PAY)- PK MART DUBAI ARE",
    "NFC - (AP-PAY)- MINI BOUNCE DUBAI 784",
    "IAP - (AP-PAY)- talabat.com DUBAI DXB",
    "NFC - (AP-PAY)- LC WAIKIKI DUBAI 784",
  ];

  it("finds the channel wrapper without being told it exists", () => {
    // Punctuation drops out of the learned form, so the wrapper is recorded as
    // its meaningful tokens.
    expect(phrases(uae, "prefix")).toContain("NFC APPAY");
  });

  it("finds the trailing city and country as shared text", () => {
    expect(phrases(uae, "suffix").some((p) => p.startsWith("DUBAI"))).toBe(true);
  });

  it("strips what it learned, so the same merchant converges", () => {
    const affixes = findCorpusAffixes(uae);
    const a = reduceFully("NFC - (AP-PAY)- DESCO COPY CENTRE DUBAI ARE", affixes).stem;
    const b = reduceFully("NFC - (SM-PAY)- DESCO COPY CENTRE DUBAI ARE", affixes).stem;

    // The point of the whole mechanism: two payees that differ only by a
    // learned wrapper reduce to the same thing. Both channel variants have to
    // clear the repetition threshold on their own — a wrapper seen twice is not
    // yet house style.
    expect(a).toBe(b);
    expect(a).not.toContain("PAY");
    expect(a).toContain("DESCO COPY CENTRE");
  });

  it("only learns a trailing fragment that repeats often enough", () => {
    // `DUBAI 784` closes three of these seven and is learned; `DUBAI ARE`
    // closes one and is not. A sample of one is not house style — which is why
    // reduction improves as a budget grows rather than guessing early.
    const affixes = findCorpusAffixes(uae);
    const suffixes = affixes.filter((a) => a.kind === "suffix").map((a) => a.tokens.join(" "));
    expect(suffixes).toContain("DUBAI 784");
    expect(suffixes).not.toContain("DUBAI ARE");
  });
});

describe("the same mechanism on a bank it has never seen", () => {
  // Invented French-style records. Nothing in the engine knows these words.
  const french = [
    "CARTE 12/03 RETRAIT DAB BOULANGERIE MARTIN PARIS FR",
    "CARTE 14/03 RETRAIT DAB PHARMACIE CENTRALE LYON FR",
    "CARTE 19/03 RETRAIT DAB LIBRAIRIE DUPONT NANTES FR",
    "CARTE 21/03 RETRAIT DAB FROMAGERIE BERNARD LILLE FR",
    "CARTE 02/04 RETRAIT DAB QUINCAILLERIE ROUX NICE FR",
  ];

  it("learns the opening wrapper", () => {
    // `CARTE` leads all five with five different continuations, so it is
    // wrapping. No French vocabulary was needed to work that out.
    expect(phrases(french, "prefix").some((p) => p.startsWith("CARTE"))).toBe(true);
  });

  it("learns the trailing country marker", () => {
    expect(phrases(french, "suffix")).toContain("FR");
  });
});

describe("non-Latin merchant names", () => {
  it("learns a wrapper around remainders written in another script", () => {
    // The numeric-remainder guard used to ask whether a remainder held an ASCII
    // letter, so every Arabic merchant name counted as "just a branch number"
    // and the shared wrapper was thrown away.
    const names = [
      "POS PURCHASE \u0643\u0627\u0631\u0641\u0648\u0631",
      "POS PURCHASE \u0644\u0648\u0644\u0648",
      "POS PURCHASE \u0633\u0628\u064a\u0646\u064a\u0632",
      "POS PURCHASE \u0627\u0644\u0645\u0632\u0631\u0639\u0629",
      "POS PURCHASE \u0646\u0648\u0646",
      "POS PURCHASE \u0637\u0644\u0628\u0627\u062a",
    ];
    expect(phrases(names, "prefix")).toContain("POS PURCHASE");
  });
});

describe("what it must refuse to learn", () => {
  it("does not treat a repeated merchant name as boilerplate", () => {
    // Three payees opening with WOOLWORTHS are the same shop, not a wrapper.
    // The remainders are too few and too similar for it to be structural.
    const names = [
      "WOOLWORTHS 0183",
      "WOOLWORTHS 0291",
      "WOOLWORTHS 8442",
      "COLES 0559",
      "ALDI 1102",
    ];
    expect(phrases(names, "prefix")).not.toContain("WOOLWORTHS");
  });

  it("never proposes an affix that would consume a whole name", () => {
    const names = ["ACME PARIS", "ACME LYON", "ACME NICE", "ACME NANTES"];
    for (const affix of findCorpusAffixes(names)) {
      expect(affix.tokens.length).toBeLessThan(2);
    }
  });

  it("ignores a fragment that is not repeated often enough", () => {
    const names = [
      "SHARED PREFIX ONE",
      "SHARED PREFIX TWO",
      "ALPHA",
      "BRAVO",
      "CHARLIE",
      "DELTA",
      "ECHO",
      "FOXTROT",
      "GOLF",
      "HOTEL",
      "INDIA",
      "JULIET",
    ];
    // Two payees out of twelve is not evidence of house style.
    expect(phrases(names, "prefix")).not.toContain("SHARED PREFIX");
  });

  it("returns nothing for an empty or tiny payee set", () => {
    expect(findCorpusAffixes([])).toEqual([]);
    expect(findCorpusAffixes(["ACME"])).toEqual([]);
  });

  it("prefers the longest affix and drops its redundant prefixes", () => {
    const names = [
      "BANK TRANSFER OUT ALPHA",
      "BANK TRANSFER OUT BRAVO",
      "BANK TRANSFER OUT CHARLIE",
      "BANK TRANSFER OUT DELTA",
    ];
    const found = phrases(names, "prefix");
    expect(found).toContain("BANK TRANSFER OUT");
    expect(found).not.toContain("BANK");
    expect(found).not.toContain("BANK TRANSFER");
  });
});

describe("everything learned is contextual", () => {
  it("marks corpus reductions as interpretive, so clusters land in review", () => {
    // Repetition proves a fragment is shared, not that removing it is safe:
    // `TRANSFER FROM` leads many payees and does carry meaning. The user sees
    // the evidence and decides.
    const names = [
      "WRAPPER ALPHA CO",
      "WRAPPER BRAVO CO",
      "WRAPPER CHARLIE CO",
      "WRAPPER DELTA CO",
    ];
    const affixes = findCorpusAffixes(names);
    const result = reduceFully("WRAPPER ALPHA CO", affixes);

    const corpusSteps = result.steps.filter(
      (s) => s.id === "corpus-prefix" || s.id === "corpus-suffix"
    );
    expect(corpusSteps.length).toBeGreaterThan(0);
    expect(corpusSteps.every((s) => s.contextual)).toBe(true);
  });

  it("keeps a structural stem that excludes the guesses", () => {
    const names = [
      "WRAPPER ALPHA 12/03/2024",
      "WRAPPER BRAVO 13/03/2024",
      "WRAPPER CHARLIE 14/03/2024",
      "WRAPPER DELTA 15/03/2024",
    ];
    const affixes = findCorpusAffixes(names);
    const result = reduceFully("WRAPPER ALPHA 12/03/2024", affixes);

    // The date is certain, the wrapper is inferred — so the structural stem
    // keeps the wrapper and the full stem does not.
    expect(result.structuralStem).toContain("WRAPPER");
    expect(result.stem).not.toContain("WRAPPER");
  });

  it("names the evidence in the step it took", () => {
    const names = [
      "WRAPPER ALPHA CO",
      "WRAPPER BRAVO CO",
      "WRAPPER CHARLIE CO",
      "WRAPPER DELTA CO",
    ];
    const affixes = findCorpusAffixes(names);
    const step = reduceFully("WRAPPER ALPHA CO", affixes).steps.find(
      (s) => s.id === "corpus-prefix"
    );
    expect(step?.label).toMatch(/on \d+ payees/);
  });
});
