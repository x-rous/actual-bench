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

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
