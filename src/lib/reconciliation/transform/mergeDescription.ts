/**
 * Bringing a note's merchant text up to what the bank actually printed.
 *
 * Automation frequently captures a shortened merchant name — `ROYAL CATERING
 * SERVICE` where the statement says `ROYAL CATERING SERVICE ABU DHABI UAE` — and
 * a user may reasonably want the fuller text.
 *
 * The obvious implementation, overwriting the note with the description, is the
 * wrong one: notes also carry workflow tags and the user's own words, and those
 * are the part worth keeping. Feature spec §26 excludes wholesale note
 * replacement from bulk actions for exactly this reason.
 *
 * So this replaces **only the run of words that already came from the bank**,
 * leaving everything around it untouched:
 *
 *   "#API ROYAL CATERING SERVICE"
 *   → "#API ROYAL CATERING SERVICE ABU DHABI UAE"
 *
 * When no such run can be identified the note is left alone and the caller is
 * told why, rather than guessing where the merchant text ends.
 */

import { normalizeForCompare } from "../match/text";

export type MergeOutcome =
  | { changed: true; notes: string }
  | { changed: false; reason: "already-matches" | "no-shared-text" | "nothing-to-add" };

/** Shortest run of characters worth treating as merchant text rather than noise. */
const MIN_SHARED_CHARS = 4;

/**
 * A single shared word is not evidence of a captured merchant name.
 *
 * "ROYAL something SERVICE" shares `SERVICE` with a catering merchant and means
 * nothing by it; swapping that one word in would produce a sentence the user
 * never wrote. Two consecutive words is the point at which the overlap is
 * plausibly the name itself.
 */
const MIN_SHARED_WORDS = 2;

function tokensOf(value: string): string[] {
  return value.split(/\s+/).filter(Boolean);
}

/**
 * Extend the note's bank-derived text to the statement's full description.
 *
 * Finds the longest contiguous run of words in the note that also appears, in
 * order, in the description, and swaps that run for the whole description. The
 * run is what the automation captured; everything else is the user's.
 */
export function mergeDescriptionIntoNotes(
  notes: string | null | undefined,
  description: string
): MergeOutcome {
  const fullDescription = description.trim();
  if (!fullDescription) return { changed: false, reason: "nothing-to-add" };

  const original = (notes ?? "").trim();
  if (!original) return { changed: true, notes: fullDescription };

  // Already carries the bank's text verbatim: nothing to do, and re-running the
  // rule must not append it a second time.
  if (
    ` ${normalizeForCompare(original)} `.includes(` ${normalizeForCompare(fullDescription)} `)
  ) {
    return { changed: false, reason: "already-matches" };
  }

  const noteTokens = tokensOf(original);
  const normalizedNote = noteTokens.map((token) => normalizeForCompare(token));
  const normalizedDescription = ` ${normalizeForCompare(fullDescription)} `;

  let bestStart = -1;
  let bestEnd = -1;
  let bestLength = 0;

  for (let start = 0; start < noteTokens.length; start++) {
    for (let end = start; end < noteTokens.length; end++) {
      const run = normalizedNote.slice(start, end + 1).filter(Boolean);
      if (run.length === 0) break;
      // The run must appear in the description as consecutive words, so a note
      // that merely shares scattered words is not treated as bank text.
      if (!normalizedDescription.includes(` ${run.join(" ")} `)) break;

      const length = run.join("").length;
      if (run.length >= MIN_SHARED_WORDS && length > bestLength) {
        bestLength = length;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  if (bestStart === -1 || bestLength < MIN_SHARED_CHARS) {
    return { changed: false, reason: "no-shared-text" };
  }

  const before = noteTokens.slice(0, bestStart);
  const after = noteTokens.slice(bestEnd + 1);
  const merged = [...before, fullDescription, ...after].join(" ").replace(/\s{2,}/g, " ").trim();

  return merged === original
    ? { changed: false, reason: "already-matches" }
    : { changed: true, notes: merged };
}
