/** Structured FX error codes (RD-056 / PR-025a, FX doc §20). */
export type FxRateErrorCode =
  | "INVALID_CURRENCY"
  | "INVALID_DATE"
  | "FUTURE_DATE"
  | "INVALID_AMOUNT"
  | "INVALID_RATE"
  | "RATE_NOT_FOUND"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_TIMEOUT"
  | "INVALID_PROVIDER_RESPONSE"
  | "DATABASE_ERROR"
  | "RATE_CONFLICT"
  | "IMPORT_VALIDATION_FAILED";

/**
 * A typed FX failure. Carries a machine code and a user-safe message; callers
 * map "pending"-class codes (RATE_NOT_FOUND / FUTURE_DATE / PROVIDER_*) to the
 * review queue rather than failing a whole sync run.
 */
export class FxError extends Error {
  constructor(
    public readonly code: FxRateErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FxError";
  }
}

/** Codes that mean "no usable rate right now" → route the item to review, don't fail the run. */
const PENDING_CODES: ReadonlySet<FxRateErrorCode> = new Set([
  "RATE_NOT_FOUND",
  "FUTURE_DATE",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "INVALID_PROVIDER_RESPONSE",
]);

export function isFxPending(error: unknown): error is FxError {
  return error instanceof FxError && PENDING_CODES.has(error.code);
}
