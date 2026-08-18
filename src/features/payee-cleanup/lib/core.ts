/**
 * Finding the words that name a merchant inside a line of bank text.
 *
 * Shared by both halves of cleanup, and it has to be: the Payee Cleanup
 * suggestions and the "Needs a rule" tab both end up asking the same question —
 * given these imports, what condition catches this payee and nothing else? —
 * and answering it two different ways produced two differently shaped rules from
 * one budget.
 *
 * The hard part is that most of what a set of imports has in common is *not* the
 * merchant: a date, a city, a bank's boilerplate, an IBAN. Each rule here comes
 * from a case where the obvious answer was wrong; the tests in
 * `ruleGaps.cases.test.ts` are the payees that produced them.
 */

import type { ImportedTextRow } from "./ruleCandidates";

/**
 * How Actual's rule engine compares a condition's value to a transaction's text.
 *
 * One implementation, because three had already drifted apart. `condition.ts`
 * lower-cases the condition's value when the rule is parsed and the field's text
 * when it runs, then compares with a plain `indexOf` or a plain `RegExp`
 * carrying no flags — pinned in `nativeSemantics.test.ts`.
 *
 * A case-insensitive flag is *not* the same thing, and the difference is not
 * academic: Actual lower-cases the pattern *source*, so `\D` becomes `\d` and
 * inverts. Anything judging a rule by its own rules rather than by Actual's will
 * eventually tell the user something the rule does not do.
 */
export function compileRuleMatcher(
  op: "contains" | "matches",
  value: string
): (text: string) => boolean {
  const needle = value.toLowerCase();

  if (op === "contains") {
    return (text) => text.toLowerCase().includes(needle);
  }

  let regex: RegExp | null = null;
  try {
    regex = isTractablePattern(needle) ? new RegExp(needle) : null;
  } catch {
    // A pattern that will not compile can never match.
    regex = null;
  }
  return (text) => (regex !== null ? regex.test(text.toLowerCase()) : false);
}

/**
 * Whether a pattern is safe to run against every row of a budget's history.
 *
 * A `matches` value can be typed by the user, and it is then tested against
 * thousands of rows inside a `useMemo` on the render thread. A pattern like
 * `(a+)+$` compiles cleanly and backtracks for ever, so the tab freezes with
 * nothing on screen to say why. Compilation failure was already handled; this
 * is the case that looks like a hang rather than an error.
 *
 * Deliberately crude — a quantified group that is itself quantified, or an
 * unreasonably long pattern. It is a guard against wedging the page, not an
 * analysis of the language.
 */
export function isTractablePattern(value: string): boolean {
  if (value.length > 200) return false;
  return !/\([^)]*[+*]\)[+*]|\([^)]*[+*][^)]*\)\{\d/.test(value);
}

/** The comparison form for text a pattern is built from. */
export function normalizePatternText(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The shortest a merchant core may be once the ladder starts shortening it.
 * `GYM GO` and `FITNESS` are too little to hang a rule on; `ATLANTIS` and
 * `SPRINT SET` are enough. It does not apply to the run itself — see `coreLadder`.
 */
export const MIN_CORE_LENGTH = 8;

/**
 * The longest a merchant core may be.
 *
 * Bank transfer records are mostly rigid boilerplate — an IBAN, a reference, a
 * branch code — and all of it is constant across transfers to the same payee, so
 * the longest shared run is nearly the whole record. Four words names any
 * merchant, and the backtest still has to agree the result is safe.
 */
export const MAX_CORE_TOKENS = 4;

/**
 * How much better one run's coverage must be to outweigh a worse-looking core.
 * Below this the two count as equally well supported, and the one that reads
 * more like the merchant's name wins.
 */
export const COVERAGE_MARGIN = 0.15;

/**
 * Hashtags are markers, never merchant text: `#2026-05` is a date and `#API` is
 * a channel. Left in, they corrupt the core — two payees whose imports happen to
 * fall in the same month share `05`, which is how `Verde Garden` became
 * `05 VERDE GARDEN`. Stripped before the core is derived, never from the text the
 * rule is matched against.
 */
function withoutMarkers(text: string): string {
  return text.replace(/#\S+/g, " ");
}

/** True when a marker was removed, i.e. this text carries something that dates it. */
export function hasMarker(text: string): boolean {
  return withoutMarkers(text) !== text;
}

export function coreTokens(text: string): string[] {
  return normalizePatternText(withoutMarkers(text)).split(" ").filter(Boolean);
}

/**
 * How many payees each word turns up for.
 *
 * The budget's own answer to "is this word a merchant, or is it scenery?" —
 * `NOVARA` belongs to one payee, `ASHDOWN` to dozens. No list of cities is needed,
 * and it works for any country: the same reasoning the cleanup scan uses to
 * learn a bank's boilerplate, applied a word at a time.
 */
export type TokenSpread = { payeesFor: Map<string, number>; payeeCount: number };

/**
 * Memoized on the row set, which is one query result shared by the whole scan.
 *
 * Both callers need the same answer, but one of them — the future-rule analysis
 * — runs once per cluster, so recomputing it there walked every row in the
 * budget dozens of times per scan. Forty clusters over a full history cost
 * around two seconds before this, on the main thread, in a memo that re-runs
 * whenever a correction changes.
 */
const spreadCache = new WeakMap<ImportedTextRow[], TokenSpread>();

export function measureTokenSpread(rows: ImportedTextRow[]): TokenSpread {
  const cached = spreadCache.get(rows);
  if (cached) return cached;

  const measured = computeTokenSpread(rows);
  spreadCache.set(rows, measured);
  return measured;
}

function computeTokenSpread(rows: ImportedTextRow[]): TokenSpread {
  const seen = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.payeeId) continue;
    for (const token of new Set(coreTokens(row.text))) {
      const payees = seen.get(token) ?? new Set<string>();
      payees.add(row.payeeId);
      seen.set(token, payees);
    }
  }

  const payeesFor = new Map<string, number>();
  for (const [token, payees] of seen) payeesFor.set(token, payees.size);
  return {
    payeesFor,
    payeeCount: new Set(rows.map((r) => r.payeeId).filter(Boolean)).size,
  };
}

/**
 * How much a run looks like this payee's name rather than scenery.
 *
 * A word counts for it, a word shared with many other payees counts against, and
 * anything carrying a digit counts against. Without the first two, the longest
 * shared run wins on length alone: Wordcraft got a rule keyed on the phone
 * number in its statement line, and a builder got `OAK RIDGE` — the street its
 * invoices mention — instead of its own name.
 */
function runQuality(tokens: string[], spread: TokenSpread | undefined): number {
  const generic = Math.max(2, Math.ceil((spread?.payeeCount ?? 0) * 0.05));

  let score = 0;
  for (const token of tokens) {
    if (/\d/.test(token)) {
      score -= 1;
    } else if (/^\p{L}{2,}$/u.test(token)) {
      // The same class the tokenizer keeps. An ASCII-only test scored `CAFÉ`,
      // `ÖRESUND` and `МАГАЗИН` as neither word nor number, so nothing read as
      // name-like and the ranking fell back to coverage alone — which is how a
      // city beats a merchant.
      score += (spread?.payeesFor.get(token) ?? 1) > generic ? -1 : 1;
    }
  }
  return score;
}

/** The rarest word in a run, for choosing between two equally good ones. */
function rarestToken(tokens: string[], spread: TokenSpread | undefined): number {
  let rarest = Number.MAX_SAFE_INTEGER;
  for (const token of tokens) {
    rarest = Math.min(rarest, spread?.payeesFor.get(token) ?? 1);
  }
  return rarest;
}

/**
 * The longest run of words that *most* of the import text contains.
 *
 * This is what makes a rule catch text it has never seen. Requiring the texts to
 * *reduce* to the same stem was too strict — the reducer is tuned for payee
 * names and leaves different leading noise on each one — but so was requiring
 * the run in every single text. One outlier is enough to ruin it: nine imports
 * reading `GYM GO FITNESS CTR ASHDOWN UAE` and one reading `GYMGO FITNESS` share
 * only `FITNESS`, and a stray `ATLANTIS71234567890` means the payee's other
 * fifteen `ATLANTIS` imports share nothing at all.
 *
 * So the run has to cover a **majority of the transactions**, not every distinct
 * string — weighted by transaction count, because a one-off oddity should not
 * outvote text that arrives every month.
 *
 * Contiguous by design: the pattern built from it joins the words with "anything
 * at all", which only means something if they were adjacent to begin with.
 */
export function commonTokenRun(
  texts: string[],
  weights?: number[],
  minShare = 0.5,
  spread?: TokenSpread
): string | null {
  const entries = texts
    .map((text, i) => ({ tokens: coreTokens(text), weight: weights?.[i] ?? 1 }))
    .filter((entry) => entry.tokens.length > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total === 0) return null;

  const containsRun = (tokens: string[], run: string[]) => {
    for (let i = 0; i + run.length <= tokens.length; i++) {
      if (run.every((word, k) => tokens[i + k] === word)) return true;
    }
    return false;
  };

  // Seeded from the text carrying the most transactions, since that is the one
  // most likely to be representative. Ties go to the longer text: only runs
  // *within* the seed are considered, so seeding on a one-word import — `#API
  // MAX`, as heavy as anything else that payee had — leaves nothing to find.
  const seed = [...entries].sort(
    (a, b) => b.weight - a.weight || b.tokens.length - a.tokens.length
  )[0].tokens;

  type Candidate = {
    run: string[];
    coverage: number;
    quality: number;
    rarest: number;
  };
  let best: Candidate | null = null;
  let fallback: Candidate | null = null;

  for (let length = Math.min(seed.length, MAX_CORE_TOKENS); length >= 1; length--) {
    for (let start = 0; start + length <= seed.length; start++) {
      const run = seed.slice(start, start + length);
      const matching = entries.filter((entry) => containsRun(entry.tokens, run));
      // Shared by at least two texts when there is more than one, or a single
      // dominant string defines the run all by itself.
      if (entries.length > 1 && matching.length < 2) continue;

      const coverage =
        matching.reduce((sum, entry) => sum + entry.weight, 0) / total;

      // Applied here rather than to the winner. A run too short to hang a rule
      // on used to win on coverage and then be rejected at the end, taking every
      // runner-up with it: `MAX` appears in all of TOP Fashion's imports, so it
      // beat `TOP ASHDOWN`, failed the floor, and left the payee with nothing.
      if (run.length < 2 && run[0].length < 4) continue;

      const quality = runQuality(run, spread);
      const rarest = rarestToken(run, spread);

      // Coverage first, but only when it is *materially* better. A run catching
      // every import beats one catching half — `MEDIX 29 PHY` over
      // `MEDIX 29 PHY 1264 ASHDOWN`. A run catching every import does not beat one
      // catching nine in ten if that costs the merchant's name: one payee
      // writing `GYMGO` once must not reduce `GYM GO FITNESS` to `FITNESS`.
      const candidate = { run, coverage, quality, rarest };

      // Below the share gate a run is a fallback, not a choice. Kept because the
      // alternative is listing raw text: `ATLANTIS` covers only two in five of
      // that payee's imports once `ATLANTIS71234567890` variants are counted
      // separately, and it is still a far better rule than one dated string.
      if (coverage < minShare) {
        if (quality > 0 && (fallback === null || quality > fallback.quality)) {
          fallback = candidate;
        }
        continue;
      }

      // Anything that reads like a name beats anything that reads like scenery,
      // whatever the coverage. Generic words have high coverage *because* they
      // are generic — `ASHDOWN` closes more of this payee's imports than
      // `ATLANTIS` does, and a rule built on it would catch half the budget.
      const namelike = quality > 0;
      const bestNamelike = best !== null && best.quality > 0;

      const better =
        best === null ||
        (namelike !== bestNamelike
          ? namelike
          : // Then coverage, but only when materially better: a run catching
            // every import must not beat one catching nine in ten if that costs
            // the merchant's name.
            coverage > best.coverage + COVERAGE_MARGIN ||
            (coverage > best.coverage - COVERAGE_MARGIN &&
              (quality > best.quality ||
                (quality === best.quality &&
                  (rarest < best.rarest ||
                    (rarest === best.rarest && run.length > best.run.length))))));

      if (better) best = candidate;
    }
  }

  const chosen = best ?? fallback;
  return chosen ? chosen.run.join(" ") : null;
}

/** Whether any text carries more words after this run. */
export function followedInSomeText(run: string[], texts: string[]): boolean {
  return texts.some((text) => {
    const tokens = coreTokens(text);
    for (let i = 0; i + run.length <= tokens.length; i++) {
      if (run.every((word, k) => tokens[i + k] === word)) {
        return i + run.length < tokens.length;
      }
    }
    return false;
  });
}

/**
 * The longest run these texts share, with no cap and no judgement about how it
 * reads. Used only to ask where the shared text stops.
 */
export function maximalCommonRun(texts: string[], weights: number[]): string[] | null {
  const entries = texts
    .map((text, i) => ({ tokens: coreTokens(text), weight: weights[i] ?? 1 }))
    .filter((entry) => entry.tokens.length > 0);
  if (entries.length === 0) return null;

  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  // The same guard `commonTokenRun` carries. Without it every share is NaN, no
  // run ever clears the threshold, and the boundary reads as "nothing shared" —
  // which licenses shortening a core the imports never licensed.
  if (total === 0) return null;

  // The same comparator `commonTokenRun` uses, and for the same reason: only
  // runs inside the seed are considered, so a heavy one-word import leaves
  // nothing to find — and here that makes the boundary read as unshown, which
  // licenses shortening a core the imports did in fact bound.
  const seed = [...entries].sort(
    (a, b) => b.weight - a.weight || b.tokens.length - a.tokens.length
  )[0].tokens;

  for (let length = seed.length; length >= 1; length--) {
    for (let start = 0; start + length <= seed.length; start++) {
      const run = seed.slice(start, start + length);
      const matching = entries.filter((entry) => {
        for (let i = 0; i + run.length <= entry.tokens.length; i++) {
          if (run.every((word, k) => entry.tokens[i + k] === word)) return true;
        }
        return false;
      });
      // Shared, not merely present in the heaviest string. Without this a
      // dominant text is its own longest run, so nothing follows it and every
      // core looked safe to shorten.
      if (entries.length > 1 && matching.length < 2) continue;

      const covered = matching.reduce((sum, entry) => sum + entry.weight, 0);
      if (covered / total >= 0.5) return run;
    }
  }
  return null;
}

/**
 * Shorter and shorter leading parts of the run, longest first.
 *
 * The run is the longest core the history *permits*, not the shortest that
 * *works*. Three identical `Nimbus Storage Spring Valley CA USD10.99` imports
 * make the price look like part of the merchant, and a rule carrying it breaks
 * the day the price changes.
 */
export function coreLadder(run: string): string[] {
  const tokens = run.split(" ");
  // The full run is always allowed however short it is — it is what the imports
  // actually share. Only the shortened forms have to clear the floor.
  const ladder: string[] = [run];
  for (let length = tokens.length - 1; length >= 1; length--) {
    const core = tokens.slice(0, length).join(" ");
    if (core.length >= MIN_CORE_LENGTH) ladder.push(core);
  }
  return ladder;
}

