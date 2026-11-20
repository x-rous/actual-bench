/**
 * A tag name as notes can use it: Actual finds tags in notes as `#name`, ending
 * at whitespace or the next `#`, so a name with spaces or a leading `#` could
 * never match. Whitespace is removed and leading `#` signs are dropped.
 */
export function normalizeTagName(value: string): string {
  return value.replace(/\s+/g, "").replace(/^#+/, "");
}
