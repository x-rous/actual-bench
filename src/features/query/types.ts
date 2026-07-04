// ─── ActualQL query model ─────────────────────────────────────────────────────
//
// Intentionally permissive so the workspace never blocks valid ActualQL patterns.
// Dotted paths, aggregate expressions, $oneof, $transform, options.splits, etc.
// all pass through as-is.

export type ActualQLExpression = string | Record<string, unknown>;

export type ActualQLQuery = {
  table: string;
  filter?: Record<string, unknown> | Array<Record<string, unknown>>;
  select?: "*" | ActualQLExpression | ActualQLExpression[];
  groupBy?: ActualQLExpression | ActualQLExpression[];
  calculate?: ActualQLExpression;
  orderBy?: ActualQLExpression | ActualQLExpression[];
  limit?: number;
  offset?: number;
  options?: Record<string, unknown>;
  unfilter?: string | string[];
  raw?: boolean;
  withDead?: boolean;
  withoutValidatedRefs?: boolean;
};

// ─── Saved query ──────────────────────────────────────────────────────────────

export type SavedQuery = {
  id: string;
  name: string;
  /** Raw JSON string as the user wrote it */
  query: string;
  createdAt: string;
  updatedAt: string;
  isFavorite?: boolean;
};

// ─── History entry ────────────────────────────────────────────────────────────

export type QueryHistoryEntry = {
  id: string;
  /** Raw JSON string as executed */
  query: string;
  executedAt: string;
  /** Execution time in milliseconds — only present for successful runs. */
  execTime?: number;
  /**
   * Number of rows returned. Set for array results; undefined for scalar
   * (calculate) results or entries written before this field was added.
   */
  rowCount?: number;
};

// ─── Result view ──────────────────────────────────────────────────────────────

export type QueryResultMode = "table" | "raw" | "scalar" | "tree";

// ─── Last executed request ───────────────────────────────────────────────────

export type LastExecutedRequest = {
  query: ActualQLQuery;
  /** Full editor string at execution time — preserved for copy/replay flows. */
  rawQuery: string;
  mode: "http-api" | "browser-api";
  baseUrl: string;
  budgetSyncId: string;
  encryptionPassword?: string;
} & (
  | { mode: "http-api"; apiKey: string }
  | { mode: "browser-api"; apiKey?: never }
);

// ─── Lint warning ─────────────────────────────────────────────────────────────

export type LintWarning = {
  id: string;
  message: string;
};
