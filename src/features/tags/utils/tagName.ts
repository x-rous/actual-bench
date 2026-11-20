/**
 * A tag name as notes can use it: Actual finds tags in notes as `#name`, ending
 * at whitespace or the next `#`, so a name containing a space or a `#` could
 * never match (`#food#rent` reads as two tags). Both are removed.
 */
export function normalizeTagName(value: string): string {
  return value.replace(/[\s#]+/g, "");
}
