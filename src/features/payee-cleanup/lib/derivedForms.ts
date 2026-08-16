/**
 * Non-destructive derived forms for payee analysis (RD-078 §5.1).
 *
 * These are *analysis-only*. Nothing here is ever written back to a payee — a
 * derived form is how detectors compare two names, not a proposed rename. The
 * canonical-name suggestion is a separate, editable decision (§9).
 *
 * Computed once per payee and cached, because every detector and every fuzzy
 * bucket reads them.
 */

import { normalizeForCompare, tokenize } from "@/lib/reconciliation/match/text";

export type PayeeDerivedForms = {
  /** Exactly as stored on the payee. */
  rawName: string;
  trimmed: string;
  /** Interior runs of whitespace collapsed to one space. */
  collapsedWhitespace: string;
  /** Upper-cased, for case-insensitive equality. */
  caseFolded: string;
  /**
   * Diacritics stripped, punctuation turned into spaces, whitespace collapsed,
   * upper-cased. Punctuation becomes a space rather than vanishing so
   * `AMZN Mktp AE*2J8G4` cannot glue two unrelated tokens together.
   */
  punctuationNormalized: string;
  tokenized: string[];
};

export function deriveForms(rawName: string): PayeeDerivedForms {
  const trimmed = rawName.trim();
  const collapsedWhitespace = trimmed.replace(/\s+/g, " ");
  // Reuses reconciliation's text primitives rather than adding a second
  // normalizer — RD-078 §5.4 is explicit that cleanup must not grow a parallel
  // fuzzy/normalization stack.
  const punctuationNormalized = normalizeForCompare(rawName);

  return {
    rawName,
    trimmed,
    collapsedWhitespace,
    caseFolded: collapsedWhitespace.toUpperCase(),
    punctuationNormalized,
    tokenized: tokenize(punctuationNormalized),
  };
}

/**
 * True when the name carries no machine-generated noise and reads like
 * something a person would type.
 *
 * Feeds two decisions: which member is the better merge target (§8.1 "clean
 * existing human-readable payee") and whether a canonical-name suggestion is
 * even needed. Intentionally conservative — a name is "clean" only if nothing
 * about it looks generated.
 */
export function looksHumanReadable(forms: PayeeDerivedForms): boolean {
  const name = forms.collapsedWhitespace;
  if (!name) return false;

  // ALL CAPS across multiple tokens reads as bank text, not a typed name.
  // A single all-caps token can be a legitimate brand (IKEA, HSBC).
  //
  // The test only means anything for a script that *has* case. Japanese, Arabic,
  // Chinese, Hebrew and Thai all return themselves from `toUpperCase()`, so this
  // rejected every multi-word name in those scripts — costing them the merge
  // target bonus and the canonical-name preference for no reason.
  const hasCase = name !== name.toLowerCase();
  if (hasCase && forms.tokenized.length > 1 && name === name.toUpperCase()) {
    return false;
  }

  // Any run of 3+ digits is a store, terminal, reference or date number.
  // Originally this required whitespace on both sides, which let
  // `... Value Date: 10/11/2025` pass as a clean human-readable name — the
  // digits are delimited by slashes, not spaces.
  if (/\d{3,}/.test(name)) return false;

  // Card-suffix and reference markers.
  if (/[*#]\s*\d+/.test(name)) return false;

  // An unambiguous bank wrapper word at the front. Only the strong set — a
  // name starting with "Card" or "Credit" is very often a real merchant.
  if (STRONG_MACHINE_PREFIXES.has(forms.tokenized[0] ?? "")) return false;

  return true;
}

/**
 * Wrapper words banks prepend to the real merchant name, split by how safely
 * they can be stripped. Kept in one place so the prefix detector and the
 * readability heuristic cannot drift apart.
 *
 * **Strong** words are never the start of a real merchant name, so a leading
 * one is proof of a wrapper.
 */
export const STRONG_MACHINE_PREFIXES = new Set([
  "POS",
  "VISA",
  "MASTERCARD",
  "PURCHASE",
  "TXN",
  "TRANSACTION",
  "COMPRA",
  "ACH",
  "SEPA",
  "IDEAL",
  "PMT",
]);

/**
 * **Weak** words appear in bank wrappers *and* in genuine merchant names —
 * `Card Factory`, `Credit Union`, `Payment Plan`, `Debit Order Services`.
 *
 * Stripping one on its own produced exactly that false positive in testing
 * (`CARD FACTORY` → `FACTORY`), so a weak word is only treated as a wrapper
 * when it sits in a leading run that also contains a strong word — e.g.
 * `CARD PURCHASE STARBUCKS`.
 */
export const WEAK_MACHINE_PREFIXES = new Set([
  "CARD",
  "DEBIT",
  "CREDIT",
  "PAYMENT",
]);

export function isMachinePrefixWord(token: string): boolean {
  return STRONG_MACHINE_PREFIXES.has(token) || WEAK_MACHINE_PREFIXES.has(token);
}

/**
 * Legal-entity suffixes. A difference that is *only* one of these is weak
 * evidence — `Acme Ltd` and `Acme Inc` can be genuinely different entities —
 * so the detector that uses this list scores low and lands in Needs Review.
 */
export const LEGAL_SUFFIXES = new Set([
  "LTD",
  "LIMITED",
  "LLC",
  "INC",
  "INCORPORATED",
  "PLC",
  "GMBH",
  "BV",
  "NV",
  "SA",
  "SARL",
  "SRL",
  "PTY",
  "CO",
  "CORP",
  "CORPORATION",
  "LLP",
  "AG",
  "AS",
  "OY",
  "AB",
]);
