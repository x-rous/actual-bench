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
  /** Candidate window either side of the statement period (feature spec §9). */
  dateToleranceDays: number;
  /** Below this score a pair is a candidate, not an automatic match. */
  autoMatchFloor: number;
  /**
   * When the runner-up is within this many points of the winner and also above
   * `autoMatchFloor`, do not auto-match — ask the user (feature spec §10 L3).
   */
  ambiguityDelta: number;
  text: TextMatchConfig;
  needleFloor: NeedleFloor;
  /** Locked `true` in V1 (RD-071 D9). Automatic matches require exact amounts. */
  requireExactAmount: true;
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
  | { kind: "reference"; where: "importedId" | "notes" };

export type ConfidenceLabel = "exact" | "high" | "medium" | "low";

/** Where the match came from. `native` is reserved for the deferred dry-run layer (RD-071 S1). */
export type MatchEvidenceSource = "bench" | "manual" | "native";

/** Tier of evidence that produced the pair (RD-071 §5.3). */
export type MatchTier =
  | "reference-imported-id"
  | "reference-in-notes"
  | "amount-date-text"
  | "amount-date";

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
  why: "close-runner-up" | "below-floor";
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

export type LikelyDuplicate = {
  statementRowId: string;
  /** The row that won the assignment. */
  keptActualTransactionId: string;
  /** Rows with near-identical evidence that lost. */
  duplicateActualTransactionIds: string[];
};
