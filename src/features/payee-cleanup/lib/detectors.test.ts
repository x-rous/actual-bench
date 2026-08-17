import { deriveForms, looksHumanReadable } from "./derivedForms";
import { detectAll, runDetectors } from "./detectors";
import type { PayeeCleanupCandidate } from "../types";

/**
 * Only the identity detectors live here now — case, whitespace and punctuation.
 *
 * Every detector that *removes* noise moved into the composable pipeline
 * (`reduce.ts`, tested in `reduce.test.ts`). Their single-pass versions used to
 * run alongside it and were actively harmful: each member of a cluster reduced
 * to a slightly different stem, so a three-member cluster reported seven pieces
 * of evidence and confidence claimed "17 independent detectors agree".
 */

function payee(name: string): PayeeCleanupCandidate {
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
    },
  };
}

function stems(name: string): string[] {
  return runDetectors(deriveForms(name)).map((h) => h.stem);
}

describe("deriveForms", () => {
  it("produces analysis forms without altering the raw name", () => {
    const forms = deriveForms("  WOOLWORTHS   0183 ");
    expect(forms.rawName).toBe("  WOOLWORTHS   0183 ");
    expect(forms.trimmed).toBe("WOOLWORTHS   0183");
    expect(forms.collapsedWhitespace).toBe("WOOLWORTHS 0183");
    expect(forms.punctuationNormalized).toBe("WOOLWORTHS 0183");
    expect(forms.tokenized).toEqual(["WOOLWORTHS", "0183"]);
  });

  it("strips diacritics and turns punctuation into separators", () => {
    expect(deriveForms("Café AMZN*2J8").punctuationNormalized).toBe("CAFE AMZN 2J8");
  });
});

describe("looksHumanReadable", () => {
  it.each([
    ["Woolworths", true],
    ["McDonald's", true],
    ["IKEA", true],
    ["WOOLWORTHS 0183", false],
    ["AMAZON MARKETPLACE", false],
    ["NETFLIX *4821", false],
    ["MARKET BOYS PTY LTD Sydney Value Date: 10/11/2025", false],
  ])("%s → %s", (name, expected) => {
    expect(looksHumanReadable(deriveForms(name))).toBe(expected);
  });

  it("accepts a multi-word name in a script with no case distinction", () => {
    // `toUpperCase()` returns these unchanged, so the all-caps test was always
    // true and every such name lost the merge-target bonus and the
    // canonical-name preference.
    expect(looksHumanReadable(deriveForms("\u6771\u4eac \u30b9\u30fc\u30d1\u30fc"))).toBe(true);
    expect(looksHumanReadable(deriveForms("\u0645\u0637\u0639\u0645 \u0627\u0644\u0628\u064a\u062a"))).toBe(true);
  });

  it("rejects a date even though its digits are punctuation-delimited", () => {
    // An earlier version required whitespace around a digit run, so a name
    // ending `Value Date: 10/11/2025` read as clean and was suggested verbatim
    // as the canonical name.
    expect(looksHumanReadable(deriveForms("ACME 10/11/2025"))).toBe(false);
  });
});

describe("identity detectors", () => {
  it("gives case variants the same stem", () => {
    expect(stems("AMAZON")).toContain("AMAZON");
    expect(stems("Amazon")).toContain("AMAZON");
    expect(stems("amazon")).toContain("AMAZON");
  });

  it("gives whitespace variants the same stem", () => {
    expect(stems("WOOLWORTHS   ")).toContain("WOOLWORTHS");
    expect(stems("WOOLWORTHS")).toContain("WOOLWORTHS");
  });

  it("gives punctuation variants the same stem", () => {
    expect(stems("AMAZON.COM")).toContain("AMAZON COM");
    expect(stems("AMAZON COM")).toContain("AMAZON COM");
  });

  it("does not remove anything", () => {
    // Identity detectors normalize; they never take content away. That is what
    // makes them safe to run on every payee.
    for (const hit of runDetectors(deriveForms("WOOLWORTHS 0183"))) {
      expect(hit.removed).toBe("");
      expect(hit.stem).toContain("WOOLWORTHS");
    }
  });
});

describe("detectAll", () => {
  it("adds the pipeline's stem as a reduction hit", () => {
    const [detected] = detectAll([payee("COLES 0559")]);
    const reduction = detected.hits.find((h) => h.detectorId === "full-reduction");

    expect(reduction?.stem).toBe("COLES");
    expect(reduction?.label).toMatch(/store or terminal number/i);
  });

  it("emits no reduction hit for an already-clean payee", () => {
    // Nothing was removed, so there is nothing to explain — the identity
    // detectors carry that payee into its cluster instead.
    const [detected] = detectAll([payee("Woolworths")]);
    expect(detected.hits.some((h) => h.detectorId === "full-reduction")).toBe(false);
  });

  it("reports an interpreted reduction as contextual", () => {
    const [detected] = detectAll([payee("Acme Pty Ltd 0559")]);
    const hits = detected.hits.filter((h) => h.detectorId === "full-reduction");
    expect(hits.some((h) => h.kind === "contextual")).toBe(true);
  });

  it("also exposes a structural-only stem when a guess was involved", () => {
    // Two payees agreeing on the structural stem are a hard match even if both
    // also carry text that only interpretation could remove.
    const [detected] = detectAll([payee("Acme Pty Ltd 0559")]);
    const structural = detected.hits.filter(
      (h) => h.detectorId === "full-reduction" && h.kind === "structural"
    );
    expect(structural.length).toBeGreaterThan(0);
  });

  it("does not emit a reduction hit whose stem is below the length floor", () => {
    // The resolver groups on the stem alone, so a one-character stem would
    // collect every unrelated payee that reduced to the same letter.
    const [detected] = detectAll([payee("A-- 1234")]);
    expect(detected.hits.some((h) => h.detectorId === "full-reduction")).toBe(false);
  });

  it("still emits a reduction hit when the stem clears the floor", () => {
    // The positive control for the guard above: it must drop short stems
    // without quietly dropping every reduction.
    const [detected] = detectAll([payee("COLES 1234")]);
    const hit = detected.hits.find((h) => h.detectorId === "full-reduction");
    expect(hit?.stem).toBe("COLES");
  });

  it("never emits a structural hit with nothing structural to report", () => {
    // When every step was interpretive the structural hit was still built, with
    // an empty label ("Removed ") and nothing recorded as removed.
    for (const [detected] of [
      detectAll([payee("Acme Pty Ltd")]),
      detectAll([payee("Acme Pty Ltd 0559")]),
    ].map((d) => d)) {
      for (const hit of detected.hits.filter(
        (h) => h.detectorId === "full-reduction" && h.kind === "structural"
      )) {
        expect(hit.label).not.toBe("Removed ");
        expect(hit.removed).not.toBe("");
      }
    }
  });

  it("carries the reduction result for later slices", () => {
    const [detected] = detectAll([payee("COLES 0559")]);
    expect(detected.reduction.stem).toBe("COLES");
    expect(detected.reduction.steps.length).toBeGreaterThan(0);
  });
});
