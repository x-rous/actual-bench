/**
 * Deterministic, dependency-free 32-bit FNV-1a hash rendered as 8 hex chars.
 *
 * Used for source fingerprints where we only need stable change-detection, not
 * cryptographic strength. The same input always yields the same output across
 * server restarts, which is what mapping freshness checks rely on.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned and pad to a fixed width.
  return (hash >>> 0).toString(16).padStart(8, "0");
}
