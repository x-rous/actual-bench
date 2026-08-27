import { AppDbValidationError } from "./errors";
import type { JsonEnvelope, JsonObject, JsonValue } from "./types";

/**
 * Versioned JSON envelope handling, shared by every app-DB repository that
 * stores free-form `*_json` columns.
 *
 * Extracted from `syncFlowRepository` / `syncRunRepository` when the automation
 * repositories (RD-079 / PR-043a) became the third and fourth copy. The two
 * original callers differ in exactly one way — flow metadata rejects
 * credential-looking fields, run payloads do not — so that difference is an
 * explicit option here rather than two near-identical implementations.
 */

export const EMPTY_ENVELOPE: JsonEnvelope = { version: 1, data: {} };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonValue);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Names that mean "this is a secret", whatever the feature calls it.
 *
 * Widened when verified backups arrived with a vocabulary the original list did
 * not cover — `secretAccessKey` and `passphrase` both walked straight through.
 * The guard is only worth having if it knows the words people actually use, so
 * it is kept deliberately broad: a false positive costs someone a rename, a
 * false negative puts a live credential in a metadata column.
 */
function isSecretLikeKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    normalized.includes("password") ||
    normalized.includes("passphrase") ||
    normalized.includes("credential") ||
    normalized.includes("secret") ||
    normalized.endsWith("apikey") ||
    normalized.endsWith("accesskey") ||
    normalized.endsWith("privatekey") ||
    normalized.endsWith("token")
  );
}

/** Path of the first credential-looking field, or null. Depth-first, so the
 * message names the outermost offender a caller is most likely to recognize. */
export function findSecretField(value: JsonValue, path: string): string | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findSecretField(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, item] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (isSecretLikeKey(key)) return nextPath;
    const found = findSecretField(item as JsonValue, nextPath);
    if (found) return found;
  }

  return null;
}

export function normalizeJsonObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value) || !isJsonValue(value)) {
    throw new AppDbValidationError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

export type NormalizeEnvelopeOptions = {
  /**
   * Reject envelopes containing credential-looking keys. On for configuration
   * and reference metadata (a secret belongs in the vault, keyed by reference);
   * off for result payloads, which are engine/job output rather than user input.
   */
  rejectSecrets?: boolean;
};

export function normalizeEnvelope(
  value: unknown,
  label: string,
  options: NormalizeEnvelopeOptions = {}
): JsonEnvelope {
  if (!isRecord(value)) {
    throw new AppDbValidationError(`${label} must be a versioned JSON envelope`);
  }

  const version = value.version;
  if (!Number.isInteger(version) || Number(version) < 1) {
    throw new AppDbValidationError(`${label}.version must be a positive integer`);
  }

  const data = normalizeJsonObject(value.data, `${label}.data`);

  if (options.rejectSecrets) {
    const secretPath = findSecretField(data, `${label}.data`);
    if (secretPath) {
      throw new AppDbValidationError(`Metadata cannot store credential field ${secretPath}`);
    }
  }

  return { version: Number(version), data };
}

/** As `normalizeEnvelope`, but an absent value defaults to the empty envelope
 * (for columns declared `NOT NULL` whose input is optional). */
export function normalizeEnvelopeOrEmpty(
  value: unknown,
  label: string,
  options: NormalizeEnvelopeOptions = {}
): JsonEnvelope {
  if (value === undefined) return EMPTY_ENVELOPE;
  return normalizeEnvelope(value, label, options);
}

export function normalizeOptionalEnvelope(
  value: unknown,
  label: string,
  options: NormalizeEnvelopeOptions = {}
): JsonEnvelope | null {
  if (value === undefined || value === null) return null;
  return normalizeEnvelope(value, label, options);
}

export function parseEnvelope(
  raw: string,
  label: string,
  options: NormalizeEnvelopeOptions = {}
): JsonEnvelope {
  try {
    return normalizeEnvelope(JSON.parse(raw) as unknown, label, options);
  } catch (error) {
    // Shape errors carry their own precise message; only a JSON.parse failure
    // should be reported as "invalid JSON".
    if (error instanceof AppDbValidationError) throw error;
    throw new AppDbValidationError(`${label} contains invalid JSON`);
  }
}

export function parseOptionalEnvelope(
  raw: string | null | undefined,
  label: string,
  options: NormalizeEnvelopeOptions = {}
): JsonEnvelope | null {
  return raw ? parseEnvelope(raw, label, options) : null;
}

export function stringifyEnvelope(envelope: JsonEnvelope | null): string | null {
  return envelope ? JSON.stringify(envelope) : null;
}
