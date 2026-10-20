export class AppDbUnavailableError extends Error {
  readonly code = "APP_DB_UNAVAILABLE";

  constructor(message: string) {
    super(message);
    this.name = "AppDbUnavailableError";
  }
}

export class AppDbValidationError extends Error {
  readonly code = "APP_DB_VALIDATION_ERROR";

  constructor(message: string) {
    super(message);
    this.name = "AppDbValidationError";
  }
}

/** A stale revision or expected value: someone else changed the row first (HTTP 409). */
export class AppDbConflictError extends Error {
  readonly code = "APP_DB_CONFLICT";

  constructor(message: string) {
    super(message);
    this.name = "AppDbConflictError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
