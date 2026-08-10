/**
 * Core reconciliation types (RD-071 / PR-034a).
 *
 * These are the app-level shapes shared by the statement, matching, transform,
 * session, and apply modules. They are deliberately transport-free: the
 * reconciliation engine never imports `@/lib/actual` directly, it receives
 * snapshots through `ports.ts`.
 *
 * All amounts are integer minor units, matching Actual's transaction amounts
 * and `SyncSourceTransaction.amount` (AGENTS.md §6).
 */

/** Integer minor units (e.g. -4250 for -42.50). Signs are preserved exactly. */
export type MinorUnitAmount = number;

// ---------------------------------------------------------------------------
// Statement side
// ---------------------------------------------------------------------------

/**
 * One normalized row parsed from a bank statement (feature spec §8).
 *
 * `raw` is retained for the lifetime of the session so the user can always
 * inspect exactly what the bank supplied; nothing downstream may destroy it.
 */
export type StatementRow = {
  id: string;
  /** 1-based index in the source file/paste, for "row 42 failed to parse". */
  sourceRowNumber: number;
  /** ISO `YYYY-MM-DD`. The date the bank says the transaction posted. */
  postedDate: string;
  /** ISO `YYYY-MM-DD`; some statements distinguish transaction from posting. */
  transactionDate?: string;
  amount: MinorUnitAmount;
  description: string;
  /** Bank reference / auth number when the statement provides one. */
  reference?: string;
  /** Original-currency amount when the statement reports an FX transaction. */
  originalAmount?: MinorUnitAmount;
  originalCurrency?: string;
  /** The untouched source row. Never overwritten. */
  raw: unknown;
  /**
   * Stable hash of the source row. Backs duplicate-statement detection and the
   * deterministic create marker (RD-071 D14), so it must not depend on parse
   * config that a user can change mid-session.
   */
  fingerprint: string;
};

// ---------------------------------------------------------------------------
// Actual side
// ---------------------------------------------------------------------------

/** A split child line, read-only in V1 (RD-071 D12). */
export type ActualSplitLine = {
  id: string | null;
  amount: MinorUnitAmount;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
};

/**
 * The snapshot of an Actual transaction taken when the session loaded its
 * candidate window. Compared against the live row before Apply to detect drift
 * (feature spec §41/§42).
 */
export type ActualTransactionSnapshot = {
  id: string;
  accountId: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  amount: MinorUnitAmount;
  payeeId: string | null;
  /** The user's curated payee name. */
  payeeName: string | null;
  /** The raw merchant text Actual stored at import, when present. */
  importedPayee: string | null;
  categoryId: string | null;
  categoryName: string | null;
  notes: string | null;
  cleared: boolean;
  reconciled: boolean;
  importedId: string | null;
  /** Non-null when this row is one leg of a transfer (RD-071 D13). */
  transferId: string | null;
  /** Non-null when this row is linked to a schedule. */
  scheduleId: string | null;
  isParent: boolean;
  isChild: boolean;
  parentId: string | null;
  splitLines: ActualSplitLine[];
};

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Which Actual field the statement description is compared against. */
export type TextTargetField = "payeeName" | "importedPayee" | "notes";

/**
 * How a target is compared.
 *
 * - `symmetric`: short-vs-short (curated/imported payee). Length mismatch is
 *   meaningful evidence.
 * - `containment`: asymmetric needle-in-haystack (notes). The statement text may
 *   sit inside a longer note alongside the user's own additions, so extra
 *   haystack text must not be penalised (RD-071 §5.3).
 */
export type TextCompareMode = "symmetric" | "containment";

export type TextTarget = {
  field: TextTargetField;
  enabled: boolean;
  /** 1 = highest. Breaks ties under `best-of`, orders the walk under `priority-first`. */
  priority: number;
  /** 0..1 scale applied to this target's similarity. */
  weight: number;
  mode: TextCompareMode;
  /** Minimal by design — see RD-071 §5.3. */
  preprocess: TextPreprocessStep[];
};

export type TextPreprocessStep = "strip-tags";

export type TextMatchConfig = {
  targets: TextTarget[];
  /**
   * `best-of`: score every enabled target, take the max (priority breaks ties).
   * `priority-first`: walk by priority, take the first target that clears
   * `priorityFirstThreshold`; fall through when it does not, or the field is empty.
   */
  combine: "best-of" | "priority-first";
  priorityFirstThreshold: number;
  /**
   * Ignore `#tags` in notes when comparing text.
   *
   * On by default. Users whose transactions are created by automation routinely
   * prefix notes with a workflow tag (`#API ADNOC AL CORNICHE 933`) that is not
   * part of the bank's text, and comparing it dilutes every score. Turning this
   * off compares notes verbatim, tags included.
   */
  ignoreTagsInNotes: boolean;
};

/**
 * Guard against containment false positives: a short or generic needle such as
 * `FEE` or `PAYMENT` otherwise matches a large fraction of an account's notes
 * (RD-071 §5.3, mandatory).
 */
export type NeedleFloor = {
  /** Needles shorter than this (alphanumeric chars) are rejected... */
  minChars: number;
  /** ...unless they carry at least this many tokens. */
  minTokens: number;
  /**
   * Reject a needle whose every token appears in more than this fraction of the
   * candidate corpus — i.e. the needle carries no distinguishing information.
   */
  maxCorpusFrequency: number;
};

export type MatchConfig = {
  /**
   * How many days apart a statement row and a transaction may be and still
   * match (feature spec §9). Actual's own fuzzy matcher uses 7.
   */
  dateToleranceDays: number;
  /**
   * How far outside the statement period to *load* transactions.
   *
   * Deliberately separate from `dateToleranceDays`. Loading must reach at least
   * as far as matching or a legitimate pair would be invisible — but everything
   * loaded beyond the statement period that does not match becomes "Actual
   * only" noise, because the statement makes no claim about those dates at all.
   * Kept small by default and clamped to at least the match tolerance.
   */
  candidatePaddingDays: number;
  /** Below this score a pair is a candidate, not an automatic match. */
  autoMatchFloor: number;
  /**
   * When the runner-up is within this many points of the winner and also above
   * `autoMatchFloor`, do not auto-match — ask the user (feature spec §10 L3).
   */
  ambiguityDelta: number;
  /**
   * How much better the winner's text must agree for the pair to count as
   * separated, even when the scores are close.
   *
   * Text is a quarter of the score budget, so an exact textual identity against
   * a merely similar one can land inside `ambiguityDelta` and be reported as
   * indistinguishable. Two fee rows differing only in the amount they quote
   * score 100 and 95 while their text scores 1.0 and 0.79 — the evidence plainly
   * separates them, and asking the user to choose wastes a decision the data
   * has already made.
   */
  textSeparationMargin: number;
  text: TextMatchConfig;
  needleFloor: NeedleFloor;
  /** Locked `true` in V1 (RD-071 D9). Automatic matches require exact amounts. */
  requireExactAmount: true;
  /**
   * Also match against the original-currency amount printed in a foreign
   * transaction's description. Still an exact-amount match, just against the
   * other amount the bank stated; requires text corroboration to be accepted.
   */
  matchOriginalCurrencyAmount: boolean;
  /**
   * Surface a transaction whose text clearly matches but whose amount does not,
   * as a review item.
   *
   * Never an automatic match — feature spec §11 is explicit that a differing
   * amount is a conflict for the user, not a fuzzy match. But saying nothing at
   * all is worse: the pair is obvious to a human, and finding it by hand across
   * a few hundred rows is exactly the work this feature exists to remove.
   */
  reviewAmountMismatch: boolean;
  /** Text similarity a mismatched-amount pair must reach to be worth showing. */
  amountMismatchTextFloor: number;
  /** Largest relative amount gap worth showing, as a fraction of the larger amount. */
  amountMismatchMaxRatio: number;
  /**
   * Pair the last remaining statement row and transaction for a merchant on a
   * date, however far apart their amounts are.
   *
   * Justified by where the error lives: when transactions are created by an
   * automation that extracts and converts amounts, the amount is the *least*
   * reliable field, while merchant text and date are the most reliable. Refusing
   * to relate them because the amounts disagree would be trusting the wrong
   * signal. Still review-only, and only when nothing else could be meant.
   */
  pairLeftoversByMerchantAndDate: boolean;
  /** How close the dates must be for that pairing. Deliberately tight. */
  clusterDateToleranceDays: number;
  /** Text similarity required to consider two rows the same merchant. */
  clusterTextFloor: number;
};

/**
 * Structured match evidence. Never prose: the UI renders these, and tests
 * assert them. A text reason always names the field it matched so a
 * mis-configured profile is visible rather than mysterious.
 */
export type MatchReason =
  | { kind: "amount"; verdict: "exact" }
  | { kind: "date"; deltaDays: number }
  | {
      kind: "text";
      field: TextTargetField;
      mode: TextCompareMode;
      similarity: number;
    }
  | {
      kind: "text-skipped";
      field: TextTargetField;
      why: "empty" | "below-needle-floor" | "no-statement-text";
    }
  | { kind: "reference"; where: "importedId" | "notes" }
  | {
      kind: "amount-mismatch";
      statementAmount: MinorUnitAmount;
      actualAmount: MinorUnitAmount;
      /** `actual - statement`, in integer minor units. */
      difference: MinorUnitAmount;
    }
  | {
      kind: "original-amount";
      currency: string;
      /** The original-currency amount, in integer minor units. */
      amount: MinorUnitAmount;
      /** The converted amount the statement actually posted. */
      postedAmount: MinorUnitAmount;
    };

export type ConfidenceLabel = "exact" | "high" | "medium" | "low";

/** Where the match came from. `native` is reserved for the deferred dry-run layer (RD-071 S1). */
export type MatchEvidenceSource = "bench" | "manual" | "native";

/** Tier of evidence that produced the pair (RD-071 §5.3). */
export type MatchTier =
  | "reference-imported-id"
  | "reference-in-notes"
  | "amount-date-text"
  | "amount-date"
  /** Exact match on the original-currency amount the bank printed (FX purchase). */
  | "original-amount-text"
  /** Text is convincing but no amount agrees — for review only, never automatic. */
  | "amount-mismatch-review"
  /**
   * Same merchant, same date, and the only rows left on either side — but the
   * amounts disagree beyond any plausible tolerance. Review only.
   */
  | "same-merchant-date-review";

export type ScoredCandidate = {
  statementRowId: string;
  actualTransactionId: string;
  /** 0-100. */
  score: number;
  label: ConfidenceLabel;
  tier: MatchTier;
  reasons: MatchReason[];
};

export type MatchOutcome = {
  statementRowId: string;
  actualTransactionId: string;
  score: number;
  label: ConfidenceLabel;
  tier: MatchTier;
  reasons: MatchReason[];
  evidenceSource: MatchEvidenceSource;
};

/**
 * A statement row the matcher declined to resolve automatically, with the
 * competing candidates so the user can choose (feature spec §10 Level 3).
 */
export type AmbiguousMatch = {
  statementRowId: string;
  candidates: ScoredCandidate[];
  why:
    | "close-runner-up"
    | "below-floor"
    | "amount-mismatch"
    /** Near-identical transactions: the same thing recorded more than once. */
    | "duplicate-candidates"
    /** One row left on each side for this merchant and date. */
    | "same-merchant-date"
    /** Several rows left on both sides; the tool will not guess the pairing. */
    | "merchant-cluster";
};

export type MatchGraph = {
  matched: MatchOutcome[];
  ambiguous: AmbiguousMatch[];
  /** Statement rows with no candidate at all → Create or leave unresolved. */
  unmatchedStatementRowIds: string[];
  /** In-window Actual rows no statement row claimed → Keep / Delete / duplicate. */
  unmatchedActualTransactionIds: string[];
  /**
   * Actual rows that lost only because another row won the same statement row
   * on near-identical evidence — the likely-duplicate signal (feature spec §19).
   */
  likelyDuplicates: LikelyDuplicate[];
};

// ---------------------------------------------------------------------------
// Session items
// ---------------------------------------------------------------------------

/**
 * Where a staged field value came from. Ordered by precedence, highest first
 * (feature spec §33): a bulk transformation must not clobber a value the user
 * edited by hand unless they explicitly opt into overriding manual edits.
 */
export type StagedValueSource =
  | "manual"
  | "transform"
  | "suggestion"
  | "actual"
  | "statement";

/**
 * One staged field, retaining what it was and why it changed (feature spec §36).
 * This is what powers preview, in-session undo, drift detection, and audit.
 */
export type StagedValue<T> = {
  original: T;
  staged: T;
  source: StagedValueSource;
};

/** The fields V1 can stage on a transaction. */
export type StagedPatch = {
  /**
   * Correcting an amount that is wrong in Actual.
   *
   * Held here rather than as a separate mechanism, so it inherits provenance and
   * precedence like any other field. But it is never staged by a bulk action and
   * never pre-selected: an amount change moves money in the budget, and only the
   * user can say which figure is right.
   */
  amount?: StagedValue<MinorUnitAmount>;
  date?: StagedValue<string>;
  payeeId?: StagedValue<string | null>;
  notes?: StagedValue<string | null>;
};

/** What the user is being asked to decide, or has decided (feature spec §16). */
export type ReconciliationDisposition =
  | "matched"
  | "create"
  | "keep"
  | "delete"
  /** The transaction is right, its amount is not — update it in place. */
  | "correct-amount"
  | "unresolved"
  | "ignored";

/**
 * Read-only facts about the Actual side that constrain what may be staged
 * (RD-071 A1-A3). Derived from the snapshot; never user-editable.
 */
export type ReconciliationGuards = {
  /** Actual's own reconciliation skips reconciled rows; so does ours. */
  protectedReconciled: boolean;
  /** A split parent has no meaningful own category — it lives on the children. */
  splitParent: boolean;
  /**
   * `unknown` when the transport does not report transfer membership at all, in
   * which case the delete guardrail must take its conservative branch.
   */
  transfer: "yes" | "no" | "unknown";
};

/**
 * One reconciliation relationship.
 *
 * The id arrays hold at most one entry each in V1, but are arrays so a grouped
 * N:M relationship (several statement rows against several transactions) needs
 * no schema migration later (RD-071 S2).
 */
export type ReconciliationItem = {
  id: string;
  statementRowIds: string[];
  actualTransactionIds: string[];
  match?: {
    type: "exact" | "suggested" | "manual";
    evidenceSource: MatchEvidenceSource;
    confidence?: number;
    label: ConfidenceLabel;
    reasons: MatchReason[];
  };
  disposition: ReconciliationDisposition;
  /** Why it is in this disposition — drives the workbench's explanatory text. */
  reasonCode?: string;
  guards: ReconciliationGuards;
  stagedChanges?: StagedPatch;
};

export type LikelyDuplicate = {
  statementRowId: string;
  /** The row that won the assignment. */
  keptActualTransactionId: string;
  /** Rows with near-identical evidence that lost. */
  duplicateActualTransactionIds: string[];
};
