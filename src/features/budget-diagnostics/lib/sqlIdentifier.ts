const SIMPLE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function quoteIdentifier(identifier: string): string {
  if (!SIMPLE_IDENTIFIER.test(identifier)) {
    throw new Error(`Invalid SQL identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

export function assertKnownIdentifier(
  identifier: string,
  knownIdentifiers: Iterable<string>,
  label: string
): string {
  const known = new Set(knownIdentifiers);
  if (!known.has(identifier)) {
    throw new Error(`Unknown ${label}: ${identifier}`);
  }
  return identifier;
}

export function assertDirection(direction: unknown): "asc" | "desc" {
  if (direction === undefined || direction === null) return "asc";
  if (direction === "asc" || direction === "desc") return direction;
  throw new Error(`Invalid sort direction: ${String(direction)}`);
}
