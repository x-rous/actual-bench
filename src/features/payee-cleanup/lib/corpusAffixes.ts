/**
 * Learns a budget's own boilerplate from its payee set (RD-078 §8.3).
 *
 * Some noise cannot be recognized by shape. `DUBAI UAE`, `INTERNET BANKING` and
 * `NFC - (AP-PAY)-` are ordinary words in ordinary positions; only knowing the
 * institution tells you they are wrapping rather than naming. Hard-coding them
 * would make the feature work for one user's bank and no one else's.
 *
 * The generic signal is repetition. A fragment that opens or closes *many
 * otherwise unrelated* payees is structural — it cannot be what distinguishes a
 * merchant, because it is on all of them. That reasoning holds for any bank in
 * any country and needs no vocabulary at all: a French user's `CARTE 12/03
 * RETRAIT DAB` is found by exactly the same rule as a UAE user's channel prefix.
 *
 * This is deliberately a *suggestion* engine. Repetition proves a fragment is
 * shared, not that removing it is safe — `TRANSFER FROM` also leads many payees
 * and does carry meaning. So everything found here is applied as a **contextual**
 * reduction, which lands the resulting clusters in review with the evidence
 * shown, rather than being treated as certain.
 */

import { normalizeToken } from "./reduce";

export type CorpusAffix = {
  kind: "prefix" | "suffix";
  /** Normalized tokens, outermost first for a prefix, in reading order for a suffix. */
  tokens: string[];
  /** How many payees carry this affix. */
  payeeCount: number;
  /** How many distinct remainders it leaves — the evidence that it is wrapping. */
  distinctRemainders: number;
};

export type CorpusAffixOptions = {
  /** Longest affix considered, in tokens. */
  maxTokens?: number;
  /** Smallest number of payees an affix must appear on. */
  minPayees?: number;
  /** Share of the corpus an affix must appear on. */
  minShare?: number;
  /** Distinct remainders required, so a repeated *merchant* is never stripped. */
  minDistinctRemainders?: number;
};

const DEFAULTS = {
  maxTokens: 4,
  minPayees: 3,
  minShare: 0.02,
  minDistinctRemainders: 3,
} satisfies Required<CorpusAffixOptions>;

type Candidate = {
  tokens: string[];
  /** Indices into the input, so payees sharing a reduced stem still count separately. */
  payees: Set<number>;
  remainders: Set<string>;
};

/**
 * Finds the repeated opening and closing fragments in a set of payee names.
 *
 * Two conditions must both hold, and the second is what makes this safe:
 *
 * 1. **It repeats** — on at least `minPayees` payees and `minShare` of the set.
 * 2. **It does not discriminate** — the payees carrying it are otherwise
 *    different from each other (`minDistinctRemainders`). Three payees that
 *    share the opening `WOOLWORTHS` are not evidence that `WOOLWORTHS` is
 *    boilerplate; they are the same merchant, and stripping it would destroy
 *    the only real word in the name.
 */
export function findCorpusAffixes(
  names: string[],
  options: CorpusAffixOptions = {}
): CorpusAffix[] {
  const { maxTokens, minPayees, minShare, minDistinctRemainders } = {
    ...DEFAULTS,
    ...options,
  };

  if (names.length === 0) return [];
  const threshold = Math.max(minPayees, Math.ceil(names.length * minShare));

  // Indexed, because the caller passes reduced stems and several payees can
  // reduce to the same one. Keying the payee set by name collapsed those into a
  // single entry, which both raised the frequency bar and understated the
  // payee count shown as evidence.
  const tokenized = names.map((name, index) => ({
    name,
    index,
    tokens: name.trim().split(/\s+/).filter(Boolean).map(normalizeToken).filter(Boolean),
  }));

  const found: CorpusAffix[] = [];

  for (const kind of ["prefix", "suffix"] as const) {
    const candidates = new Map<string, Candidate>();

    for (const entry of tokenized) {
      // Never consider an affix that would consume the whole name — there has
      // to be something left to be the payee.
      const limit = Math.min(maxTokens, entry.tokens.length - 1);
      for (let k = 1; k <= limit; k++) {
        const slice =
          kind === "prefix"
            ? entry.tokens.slice(0, k)
            : entry.tokens.slice(entry.tokens.length - k);
        const remainder =
          kind === "prefix"
            ? entry.tokens.slice(k).join(" ")
            : entry.tokens.slice(0, entry.tokens.length - k).join(" ");
        if (!remainder) continue;

        const key = slice.join(" ");
        const candidate = candidates.get(key);
        if (candidate) {
          candidate.payees.add(entry.index);
          candidate.remainders.add(remainder);
        } else {
          candidates.set(key, {
            tokens: slice,
            payees: new Set([entry.index]),
            remainders: new Set([remainder]),
          });
        }
      }
    }

    const qualifying = [...candidates.values()].filter(
      (c) =>
        c.payees.size >= threshold &&
        c.remainders.size >= minDistinctRemainders &&
        // A fragment shared by payees that are nearly all identical afterwards
        // is a merchant name, not boilerplate.
        c.remainders.size >= Math.min(3, Math.ceil(c.payees.size * 0.3)) &&
        // Remainders that are mostly bare numbers mean the shared text is the
        // merchant and the numbers are its branches — `WOOLWORTHS 0183 / 0291 /
        // 8442`. Stripping the shared part there would delete the only real
        // word in every one of those names.
        !mostlyNumeric(c.remainders)
    );

    // Keep the longest affix of each family. `NFC` qualifies, but `NFC - (AP-PAY)-`
    // removes more and is equally well evidenced, so the shorter one is redundant.
    const longestFirst = [...qualifying].sort(
      (a, b) => b.tokens.length - a.tokens.length
    );
    const kept: Candidate[] = [];
    for (const candidate of longestFirst) {
      const covered = kept.some((k) => isExtensionOf(k.tokens, candidate.tokens, kind));
      if (!covered) kept.push(candidate);
    }

    for (const candidate of kept) {
      found.push({
        kind,
        tokens: candidate.tokens,
        payeeCount: candidate.payees.size,
        distinctRemainders: candidate.remainders.size,
      });
    }
  }

  // Longest first so the most specific affix is applied before a shorter one
  // that overlaps it.
  return found.sort(
    (a, b) => b.tokens.length - a.tokens.length || b.payeeCount - a.payeeCount
  );
}

/** True when most of these remainders carry no word — i.e. they are branch numbers. */
function mostlyNumeric(remainders: Set<string>): boolean {
  let numeric = 0;
  for (const remainder of remainders) {
    // Any Unicode letter counts as a word. An ASCII-only test called every
    // non-Latin merchant name "numeric", so a shared wrapper around Arabic or
    // Cyrillic remainders was rejected as a run of branch numbers.
    if (!/\p{L}/u.test(remainder)) numeric += 1;
  }
  return numeric / remainders.size > 0.5;
}

/** True when `shorter` is the outer part of `longer` — i.e. already covered by it. */
function isExtensionOf(
  longer: string[],
  shorter: string[],
  kind: "prefix" | "suffix"
): boolean {
  if (shorter.length >= longer.length) return false;
  const slice =
    kind === "prefix"
      ? longer.slice(0, shorter.length)
      : longer.slice(longer.length - shorter.length);
  return slice.every((t, i) => t === shorter[i]);
}
