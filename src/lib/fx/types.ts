/**
 * FX / multi-currency consolidation types (RD-056 / PR-025a).
 *
 * The database is the authoritative FX registry; a provider (Frankfurter) only
 * populates it. `transaction_fx` is the immutable record of the rate actually
 * applied to a transaction. Rates are decimal strings (high precision); amounts
 * are integer minor units (Actual-compatible).
 */

export type FxRateSource = "frankfurter" | "user-upload" | "manual" | "derived";
export type FxRateStatus = "active" | "superseded" | "invalid";
export type FxRateImportStatus = "pending" | "completed" | "completed-with-errors" | "failed";

/** A row in the reusable daily-rate registry (`fx_rates`). */
export type FxRateRecord = {
  id: string;
  baseCurrency: string;
  quoteCurrency: string;
  requestedDate: string;
  effectiveDate: string;
  rate: string;
  source: FxRateSource;
  provider: string | null;
  status: FxRateStatus;
  isUserOverride: boolean;
  importBatchId: string | null;
  derivedFromFxRateId: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  notes: string | null;
};

/** Fields required to insert a registry rate; the rest are defaulted. */
export type FxRateInput = {
  id?: string;
  baseCurrency: string;
  quoteCurrency: string;
  requestedDate: string;
  effectiveDate: string;
  rate: string;
  source: FxRateSource;
  provider?: string | null;
  status?: FxRateStatus;
  isUserOverride?: boolean;
  importBatchId?: string | null;
  derivedFromFxRateId?: string | null;
  createdBy?: string | null;
  notes?: string | null;
};

/** Tracks an uploaded rate file and its outcome (`fx_rate_import_batches`). */
export type FxRateImportBatch = {
  id: string;
  filename: string;
  importedAt: string;
  insertedCount: number;
  replacedCount: number;
  rejectedCount: number;
  status: FxRateImportStatus;
  createdBy: string | null;
  notes: string | null;
};

/** Immutable per-transaction FX snapshot (`transaction_fx`). */
export type TransactionFxRecord = {
  id: string;
  transactionId: string;
  fxRateId: string | null;
  sourceCurrency: string;
  targetCurrency: string;
  sourceAmount: number;
  convertedAmount: number;
  appliedRate: string;
  requestedDate: string;
  effectiveDate: string;
  source: FxRateSource;
  provider: string | null;
  isManual: boolean;
  appliedAt: string;
  updatedAt: string;
};

export type TransactionFxInput = Omit<TransactionFxRecord, "id" | "appliedAt" | "updatedAt"> & {
  id?: string;
};

/** A resolved rate for a pair+date, independent of how it was sourced. */
export type FxRateResult = {
  provider: string | null;
  baseCurrency: string;
  quoteCurrency: string;
  requestedDate: string;
  effectiveDate: string;
  rate: string;
  source: FxRateSource;
  isManual: boolean;
  /** Registry row id, when the rate came from / was stored in `fx_rates`. */
  fxRateId: string | null;
};

/** The outcome of converting an amount, carrying full provenance. */
export type FxConversionResult = {
  sourceAmount: number;
  convertedAmount: number;
  sourceCurrency: string;
  targetCurrency: string;
  requestedDate: string;
  effectiveDate: string;
  rate: string;
  rateSource: FxRateSource;
  provider: string | null;
  fxRateId: string | null;
  isManual: boolean;
};
