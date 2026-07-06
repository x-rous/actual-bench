/**
 * Normalize a payee/category name for match-by-name lookups.
 *
 * Case-insensitive, whitespace-collapsed, and trimmed so that "Acme  Corp "
 * and "acme corp" resolve to the same target entity. Returns an empty string
 * for nullish/blank input so callers can treat "no usable name" uniformly.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}
