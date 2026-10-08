import { createHash } from "node:crypto";

/**
 * Canonical JSON for hashed snapshots (RD-084 model revisions).
 *
 * The same content always serializes to the same bytes: object keys sorted by
 * code point, no whitespace, arrays kept in the order given (callers sort
 * child lists before they get here). Only exact values are accepted: numbers
 * must be safe integers (amounts in minor units), so a floating-point value
 * cannot slip into a hash; decimals travel as strings. `undefined` is refused
 * rather than dropped, so a missing field is always an explicit `null`.
 */

export type CanonicalValue = null | boolean | string | number | CanonicalValue[] | { [key: string]: CanonicalValue };

export class CanonicalJsonError extends Error {
  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "CanonicalJsonError";
  }
}

function write(value: unknown, path: string): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isSafeInteger(value)) throw new CanonicalJsonError(path, `only safe integers are allowed, got ${value}`);
      return String(value);
    case "object": {
      if (Array.isArray(value)) return `[${value.map((v, i) => write(v, `${path}[${i}]`)).join(",")}]`;
      // Plain objects from any realm (structuredClone may return another realm's): the prototype is null or a root prototype.
      const proto = Object.getPrototypeOf(value);
      if (proto !== null && Object.getPrototypeOf(proto) !== null) throw new CanonicalJsonError(path, "only plain objects are allowed");
      const keys = Object.keys(value).sort();
      return `{${keys.map((k) => `${JSON.stringify(k)}:${write((value as Record<string, unknown>)[k], `${path}.${k}`)}`).join(",")}}`;
    }
    default:
      throw new CanonicalJsonError(path, `${typeof value} is not allowed (use null for an absent value)`);
  }
}

/** The canonical serialization of `value`. Throws on anything that is not exact JSON. */
export function canonicalJson(value: unknown): string {
  return write(value, "$");
}

/** SHA-256 of the canonical serialization, as 64 lowercase hex characters (UTF-8 bytes). */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
