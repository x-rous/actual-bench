import { AppDbValidationError } from "./errors";

/**
 * Value guards shared by the Assets & Debt repositories (RD-084 P1.3).
 *
 * The repositories store exactly what the configuration service has already
 * validated; these checks make a wrong type fail loudly at the boundary
 * instead of being coerced by SQLite. They hold no financial logic: a decimal
 * is only checked to be the canonical string the money kernel produces.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Canonical non-negative decimal: no sign, no exponent, no leading zeros, no trailing fractional zeros. */
const CANONICAL_DECIMAL = /^(0|[1-9]\d*)(\.\d*[1-9])?$/;

export function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new AppDbValidationError(`${field} is required`);
  return value;
}

export function optionalText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new AppDbValidationError(`${field} must be text`);
  return value === "" ? null : value;
}

export function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) throw new AppDbValidationError(`${field} must be a date (YYYY-MM-DD)`);
  return value;
}

export function optionalIsoDate(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : requireIsoDate(value, field);
}

export function requireInteger(value: unknown, field: string, min: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw new AppDbValidationError(`${field} must be a whole number of at least ${min}`);
  }
  return value;
}

export function optionalInteger(value: unknown, field: string, min: number): number | null {
  return value === null || value === undefined ? null : requireInteger(value, field, min);
}

/**
 * An exact decimal, as the canonical string. A JS number is refused outright:
 * it may already have lost precision, and SQLite would store it as text anyway.
 */
export function requireCanonicalDecimal(value: unknown, field: string): string {
  if (typeof value === "number") throw new AppDbValidationError(`${field} must be an exact decimal string, not a number`);
  if (typeof value !== "string" || !CANONICAL_DECIMAL.test(value)) {
    throw new AppDbValidationError(`${field} must be a canonical non-negative decimal string (for example "0.0612")`);
  }
  return value;
}

export function optionalCanonicalDecimal(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : requireCanonicalDecimal(value, field);
}

export function requireOneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    throw new AppDbValidationError(`${field} must be one of ${values.join(", ")}`);
  }
  return value as T;
}

/** A SQLite constraint failure, reported as a validation error with a readable reason. */
export function rethrowConstraint(error: unknown, messages: Record<string, string>): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/constraint failed/i.test(message)) {
    for (const [needle, readable] of Object.entries(messages)) {
      if (message.includes(needle)) throw new AppDbValidationError(readable);
    }
    throw new AppDbValidationError(`The configuration was refused by the database: ${message}`);
  }
  throw error;
}
