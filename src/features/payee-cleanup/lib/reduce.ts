/**
 * Composable noise reduction for bank-generated payee names (RD-078 §5.2, §5.3).
 *
 * The single-pass detectors in `detectors.ts` each remove one class of noise
 * from the raw name. That is enough for `WOOLWORTHS 0183`, but real bank text
 * stacks several classes at once, and with one removal per name the stems never
 * converge. This module applies every reducer in sequence, repeatedly, until the
 * name stops changing, recording what each step removed so the result stays
 * explainable.
 *
 * **Everything here is shape-based.** A reducer recognizes noise by its
 * *structure* — a date looks like a date in any country, a reference number is a
 * long alphanumeric run at any bank — never by matching a list of merchants,
 * cities, processors or one institution's vocabulary. Text that can only be
 * identified by knowing the bank is handled by `corpusAffixes.ts`, which learns
 * it from the user's own payee set instead of from a hard-coded list.
 *
 * It runs on lightly-normalized text (whitespace collapsed, punctuation intact)
 * because the patterns that matter — `Value Date:`, `12/03/2024`, `SEQ:00001181`
 * — are made of the punctuation that full normalization would destroy.
 */

import {
  isMachinePrefixWord,
  LEGAL_SUFFIXES,
  STRONG_MACHINE_PREFIXES,
} from "./derivedForms";
import type { CorpusAffix } from "./corpusAffixes";

export type ReducerId =
  | "statement-tail"
  | "processor-prefix"
  | "machine-prefix"
  | "network-scaffold"
  | "domain-fragment"
  | "labelled-metadata"
  | "date-fragment"
  | "time-fragment"
  | "fx-fragment"
  | "currency-amount"
  | "card-number"
  | "reference-token"
  | "legal-suffix"
  | "terminal-suffix"
  | "corpus-prefix"
  | "corpus-suffix";

export type ReductionStep = {
  id: ReducerId;
  /** Human-readable, shown as cluster evidence. */
  label: string;
  /** The text this step removed. */
  removed: string;
  /** Contextual steps are interpretive and lower the cluster's confidence. */
  contextual: boolean;
};

export type ReductionResult = {
  /** The reduced name. Upper-cased and whitespace-collapsed, never empty. */
  stem: string;
  /**
   * The same reduction with the interpretive steps left out.
   *
   * This separates "these differ only in noise we are certain about" from "we
   * had to infer". Two payees that already agree here are a hard structural
   * match even if both also carry text only the corpus could identify.
   */
  structuralStem: string;
  steps: ReductionStep[];
};

/** Guard: never reduce a name below this, or unrelated merchants collapse together. */
const MIN_STEM_LENGTH = 3;

type Reducer = {
  id: ReducerId;
  label: string;
  contextual?: boolean;
  /** Returns the shortened text, or null when the reducer does not apply. */
  apply(text: string): { text: string; removed: string } | null;
};

// ─── Shape patterns ──────────────────────────────────────────────────────────

/**
 * Dates in the layouts banks actually emit: `12/03/2024`, `2023-09-02`,
 * `06MAR25`, `05MAR2025`, `Oct 2025`. Month names are the only words involved,
 * and those are calendar vocabulary rather than anything bank-specific.
 */
const DATE_PATTERN =
  /\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}[A-Z]{3}\d{2,4}|(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+\d{2,4})\b/i;

/** `19:40:27`, `13:55`. */
const TIME_PATTERN = /\b\d{1,2}:\d{2}(:\d{2})?\b/;

/**
 * Card numbers in their common maskings: `xx9166`, `****1234`, `x-1234`,
 * `Card Ending with 5070`. The `CARD` label is consumed along with the number —
 * removing only the digits leaves a stray word that blocks later reducers.
 */
const CARD_PATTERN =
  /(?:\bCARD\s*(?:NO\.?|NUMBER)?\s*:?\s*)?(?:ENDING\s+(?:WITH\s+)?)?(?:\bX{1,2}[\s-]?\d{3,4}\b|\*{2,}[\s-]?\d{3,4}\b)|\bCARD\s+ENDING\s+(?:WITH\s+)?\d{3,4}\b/i;

/**
 * Currency conversion fragments: `AUD/AED .430449172`, `FX SAR 36147.46 AT 0.98`.
 * A three-letter ISO code is a shape, not a list of the user's currencies.
 */
/**
 * A currency code with its amount: `AUD 14.95`, `SAR 1,234.56`, `USD 20`.
 *
 * Real statements print the charged amount into the payee field, and it varies
 * per transaction — so it both survives into the payee name and stops variants
 * from converging. A three-letter code beside a number is a shape, not a list of
 * anyone's currencies.
 */
const CURRENCY_AMOUNT_PATTERN = /\b[A-Z]{3}\s*[\d,]+(\.\d{1,2})?\b/;

const FX_PATTERN =
  /\b([A-Z]{3}\/[A-Z]{3}\s*\.?[\d.]+|FX\s+[A-Z]{3}\s+[\d,.]+\s+AT\s+[\d.]+)\b/i;

/**
 * `LABEL: value` metadata where the value looks machine-generated.
 *
 * Generic by construction: a one- or two-word label followed by a colon and a
 * run of digits or reference characters. It finds `Value Date: 12/03/2024`,
 * `SEQ:00001181` and `Ref: 8837/22` without being told those labels exist, and
 * leaves `Joe's Diner: The Best Burgers` alone because the value is prose.
 *
 * The label is a single word on purpose. Allowing two let it reach back across a
 * real one — `ACME STORE SEQ:00001181` matched `STORE SEQ:` and the merchant
 * lost half its name. Multi-word labels are recognized only where a second
 * signal disambiguates them: see `statementTail`.
 */
const LABELLED_PATTERN =
  /\b([A-Z][A-Z.]*)\s*:\s*[*#]*[\dA-Z]{2,}(?:[-/][\dA-Z]+)*\b/i;

/**
 * Card networks and terminal identifiers appearing as standalone scaffolding.
 * Card-industry terms, not one bank's wording.
 */
const NETWORK_TOKEN =
  /^(VISA|MASTERCARD|MAESTRO|AMEX|DISCOVER|EFTPOS|CIRRUS|ATM[A-Z0-9]{2,6}|POS[A-Z0-9]{2,6})$/i;

// ─── Reducers ────────────────────────────────────────────────────────────────

/**
 * Everything from the first date token onwards, when a merchant name precedes it.
 *
 * Banks that print a whole transaction record into one field almost always put
 * the merchant first and the machine detail after the date, so one rule collapses
 * an entire family of formats without knowing any of them.
 *
 * Requires real content before the date, so a record that *starts* with the date
 * is left to the narrower reducers rather than erased.
 */
const statementTail: Reducer = {
  id: "statement-tail",
  label: "Statement details after the date",
  apply: (text) => {
    const match = DATE_PATTERN.exec(text);
    if (!match || match.index === undefined) return null;
    const head = text.slice(0, match.index).trim();
    const tail = text.slice(match.index).trim();
    if (tail.length < 6) return null;

    // A colon-terminated label immediately before the date belongs to the date,
    // not to the merchant: `MARKET BOYS Value Date: 12/03/2024`. The colon is
    // what makes this unambiguous — up to two words are taken with it, which is
    // safe here in a way a bare two-word label never is.
    const labelled = /\s*(?:\S+\s+)?\S+:\s*$/.exec(head);
    const merchant = labelled ? head.slice(0, labelled.index).trim() : head;
    if (merchant.length < 6) return null;

    return {
      text: merchant,
      removed: (labelled ? head.slice(labelled.index).trim() + " " : "") + tail,
    };
  },
};

/**
 * Payment-processor tags: `SQ *BANGKOKSQUARE`, `ZLR*Schnitz`, `PP*STORE`.
 *
 * Identified by shape — a short abbreviation before a star — capped at three
 * characters. A general "anything before a star" rule ate the merchant in
 * `UBER *TRIP`; real processor tags are terse, merchant names are not.
 */
const processorPrefix: Reducer = {
  id: "processor-prefix",
  label: "Payment processor prefix",
  apply: (text) => {
    const match = /^\s*([A-Za-z0-9]{2,3})\s*\*\s*/.exec(text);
    if (!match) return null;
    const rest = text.slice(match[0].length).trim();
    if (rest.length < MIN_STEM_LENGTH) return null;
    return { text: rest, removed: match[0].trim() };
  },
};

/** `POS `, `VISA POS `, `CARD PURCHASE ` — see `derivedForms` for the vocabulary split. */
const machinePrefix: Reducer = {
  id: "machine-prefix",
  label: "Bank prefix",
  apply: (text) => {
    const tokens = text.split(/\s+/);
    const removed: string[] = [];
    while (tokens.length > 1 && isMachinePrefixWord(tokens[0].toUpperCase())) {
      removed.push(tokens.shift() as string);
    }
    if (removed.length === 0) return null;
    if (!removed.some((t) => STRONG_MACHINE_PREFIXES.has(t.toUpperCase()))) return null;
    return { text: tokens.join(" "), removed: removed.join(" ") };
  },
};

/** Standalone card-network / terminal tokens anywhere in the name. */
const networkScaffold: Reducer = {
  id: "network-scaffold",
  label: "Card network and terminal codes",
  apply: (text) => {
    const tokens = text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      if (!NETWORK_TOKEN.test(tokens[i])) continue;
      const next = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(" ").trim();
      if (next.length < MIN_STEM_LENGTH) continue;
      return { text: next, removed: tokens[i] };
    }
    return null;
  },
};

/**
 * A trailing web address appended to the merchant name:
 * `UBER *TRIP HELP.UBER.COM` → `UBER *TRIP`.
 *
 * Only when something else remains — `Amazon.ae` and `talabat.com` *are* the
 * merchant, so a name that is nothing but a domain is left alone.
 */
const domainFragment: Reducer = {
  id: "domain-fragment",
  label: "Web address",
  apply: (text) => {
    const tokens = text.split(/\s+/);
    if (tokens.length < 2) return null;
    const last = tokens[tokens.length - 1];
    if (!/^[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,4}$/i.test(last)) return null;
    const next = tokens.slice(0, -1).join(" ").trim();
    if (next.length < MIN_STEM_LENGTH) return null;
    return { text: next, removed: last };
  },
};

function stripPattern(id: ReducerId, label: string, pattern: RegExp): Reducer {
  return {
    id,
    label,
    apply: (text) => {
      const match = pattern.exec(text);
      if (!match || match.index === undefined) return null;
      const next = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
        .replace(/\s+/g, " ")
        .trim();
      if (next.length < MIN_STEM_LENGTH) return null;
      return { text: next, removed: match[0].trim() };
    },
  };
}

const labelledMetadata = stripPattern(
  "labelled-metadata",
  "Reference details",
  LABELLED_PATTERN
);
const dateFragment = stripPattern("date-fragment", "Transaction date", DATE_PATTERN);
const timeFragment = stripPattern("time-fragment", "Transaction time", TIME_PATTERN);
const fxFragment = stripPattern("fx-fragment", "Exchange rate", FX_PATTERN);
const cardNumber = stripPattern("card-number", "Card number", CARD_PATTERN);
const currencyAmount = stripPattern(
  "currency-amount",
  "Charged amount",
  CURRENCY_AMOUNT_PATTERN
);

/**
 * Long machine tokens: mixed alphanumeric references (`A88898560`, `IBAG41116`)
 * and long pure-digit runs (`393160543`).
 *
 * Bounded so an account number like `030-176408-001` survives — it identifies
 * the counterparty, and no individual part of it is long enough to qualify.
 */
const referenceToken: Reducer = {
  id: "reference-token",
  label: "Reference number",
  apply: (text) => {
    const tokens = text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      if (!isReferenceToken(tokens[i])) continue;

      // Take the label sitting immediately before the value with it — `REF
      // A896-13013`, `HIB- 97340X909334`. Otherwise the value goes and a
      // meaningless `REF` stays behind, which then differs between payees for
      // no reason.
      //
      // Shape-based rather than a list of label words: a label here is either
      // very short, or punctuated as a label. That keeps `ACME STORE A88898560`
      // intact, where the preceding word is part of the merchant name.
      const start =
        i > 0 && isAdjacentLabel(tokens[i - 1]) && i - 1 > 0 ? i - 1 : i;

      const next = [...tokens.slice(0, start), ...tokens.slice(i + 1)]
        .join(" ")
        .trim();
      if (next.length < MIN_STEM_LENGTH) continue;
      return { text: next, removed: tokens.slice(start, i + 1).join(" ") };
    }
    return null;
  },
};

function isAdjacentLabel(token: string): boolean {
  if (/[-:.]$/.test(token) && /^[A-Za-z]{2,6}[-:.]$/.test(token)) return true;
  return /^[A-Za-z]{2,3}$/.test(token);
}

function isReferenceToken(raw: string): boolean {
  // A structured account number — digit groups joined by dashes or slashes —
  // is the counterparty's identity, not a per-transaction reference. It is the
  // only thing telling two transfers apart, so it must survive.
  if (isStructuredNumber(raw)) return false;

  const token = raw.toUpperCase().replace(/[^A-Z0-9@]/g, "");
  if (token.length < 6) return false;
  const digits = (token.match(/\d/g) ?? []).length;
  const letters = (token.match(/[A-Z]/g) ?? []).length;
  if (digits === 0) return false;
  if (letters === 0) return token.length >= 7;
  return digits / token.length >= 0.3;
}

/** `PTY LTD`, `LLC`, `GmbH`, `PTY. LTD.` — trailing company suffixes. */
const legalSuffix: Reducer = {
  id: "legal-suffix",
  label: "Company suffix",
  contextual: true,
  apply: (text) => {
    const tokens = text.split(/\s+/);
    const removed: string[] = [];
    while (tokens.length > 1) {
      const bare = tokens[tokens.length - 1].toUpperCase().replace(/[^A-Z]/g, "");
      if (!LEGAL_SUFFIXES.has(bare)) break;
      removed.unshift(tokens.pop() as string);
    }
    if (removed.length === 0) return null;
    const next = tokens.join(" ").trim();
    if (next.length < MIN_STEM_LENGTH) return null;
    return { text: next, removed: removed.join(" ") };
  },
};

/** A trailing store or terminal number: `COLES 0559` → `COLES`. */
const terminalSuffix: Reducer = {
  id: "terminal-suffix",
  label: "Store or terminal number",
  apply: (text) => {
    const tokens = text.split(/\s+/);
    const last = tokens[tokens.length - 1];
    if (tokens.length < 2) return null;

    // `030-176408-001` is one identifier, not a name followed by a number.
    // Peeling `001` off the end of it silently destroys the counterparty.
    if (isStructuredNumber(last)) return null;

    const bare = /^(\d{2,6})$/.exec(last);
    const attached = /^(.*[A-Za-z].*?)[#-](\d{2,6})$/.exec(last);
    if (!bare && !attached) return null;

    const head = bare
      ? tokens.slice(0, -1).join(" ")
      : [...tokens.slice(0, -1), attached![1]].join(" ");
    if (!/[A-Za-z]/.test(head)) return null;

    const next = head.trim();
    if (next.length < MIN_STEM_LENGTH) return null;
    return { text: next, removed: bare ? bare[1] : attached![2] };
  },
};

/** Digit groups joined by dashes or slashes: an account or contract number. */
function isStructuredNumber(token: string): boolean {
  return /^\d{2,}([-/]\d{2,})+$/.test(token);
}

/**
 * Order matters. The statement tail goes first because it removes the largest
 * span, and running a prefix reducer ahead of it can shorten the head below the
 * length this one requires.
 */
const SHAPE_REDUCERS: Reducer[] = [
  statementTail,
  processorPrefix,
  // Card numbers before generic labelled metadata: `CARD NO: ***132` is one
  // phrase, and letting the generic rule take `NO: ***132` first strands `CARD`.
  cardNumber,
  labelledMetadata,
  fxFragment,
  // After the FX fragment, which is the richer form of the same thing.
  currencyAmount,
  dateFragment,
  timeFragment,
  networkScaffold,
  machinePrefix,
  domainFragment,
  referenceToken,
  legalSuffix,
  terminalSuffix,
];

/** Enough passes for the deepest stacking seen in real statements. */
const MAX_PASSES = 8;

export function normalizeToken(token: string): string {
  return token.toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Turns a corpus-learned affix into a reducer.
 *
 * Always contextual. The corpus can show that a fragment repeats; it cannot show
 * that removing it is safe. A channel wrapper and a meaningful word like
 * `TRANSFER` are structurally indistinguishable — both lead many payees — so
 * these clusters are proposed for review with the evidence attached rather than
 * treated as certain.
 */
function affixReducer(affix: CorpusAffix): Reducer {
  const phrase = affix.tokens.join(" ");
  return {
    id: affix.kind === "prefix" ? "corpus-prefix" : "corpus-suffix",
    label:
      affix.kind === "prefix"
        ? `Shared opening text ("${phrase}", on ${affix.payeeCount} payees)`
        : `Shared trailing text ("${phrase}", on ${affix.payeeCount} payees)`,
    contextual: true,
    apply: (text) => {
      const tokens = text.split(/\s+/).filter(Boolean);

      // Affixes are learned from normalized text, so match through the same
      // view: tokens that normalize to nothing (a lone `-`, say) are invisible
      // for comparison but must still be consumed, or `NFC - (AP-PAY)-` would
      // never line up with the learned `NFC APPAY`.
      const meaningful = tokens
        .map((raw, index) => ({ index, norm: normalizeToken(raw) }))
        .filter((t) => t.norm.length > 0);
      if (meaningful.length <= affix.tokens.length) return null;

      const slice =
        affix.kind === "prefix"
          ? meaningful.slice(0, affix.tokens.length)
          : meaningful.slice(-affix.tokens.length);
      if (!slice.every((t, i) => t.norm === affix.tokens[i])) return null;

      const kept =
        affix.kind === "prefix"
          ? tokens.slice(slice[slice.length - 1].index + 1)
          : tokens.slice(0, slice[0].index);
      const removed =
        affix.kind === "prefix"
          ? tokens.slice(0, slice[slice.length - 1].index + 1)
          : tokens.slice(slice[0].index);

      const next = kept.join(" ").trim();
      if (next.length < MIN_STEM_LENGTH) return null;
      return { text: next, removed: removed.join(" ") };
    },
  };
}

export function reduceFully(
  rawName: string,
  affixes: CorpusAffix[] = []
): ReductionResult {
  let text = rawName.trim().replace(/\s+/g, " ");
  const steps: ReductionStep[] = [];
  let structuralText: string | null = null;

  const reducers = [...SHAPE_REDUCERS, ...affixes.map(affixReducer)];

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;
    for (const reducer of reducers) {
      const result = reducer.apply(text);
      if (!result || result.text === text) continue;
      const next = result.text.trim().replace(/\s+/g, " ");
      if (next.length < MIN_STEM_LENGTH) continue;

      // Snapshot the text just before the first interpretive step, so the
      // structural-only stem is available without a second pass.
      if ((reducer.contextual ?? false) && structuralText === null) {
        structuralText = text;
      }
      text = next;
      steps.push({
        id: reducer.id,
        label: reducer.label,
        removed: result.removed,
        contextual: reducer.contextual ?? false,
      });
      changed = true;
    }
    if (!changed) break;
  }

  return {
    stem: normalizeStem(text),
    structuralStem: normalizeStem(structuralText ?? text),
    steps,
  };
}

/**
 * Final comparison form: upper-cased, punctuation to spaces, collapsed. Applied
 * only at the end, because the reducers need the punctuation to find their
 * patterns.
 */
function normalizeStem(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
