/**
 * Query parsing and lint rules for the ActualQL workspace.
 *
 * parseQuery: validates the full wrapped JSON string `{ "ActualQLquery": { ... } }`
 * and returns { body, inner } or an Error describing why the input is invalid.
 * Called before every network request and displayed inline in the editor.
 *
 * lintQuery: runs non-blocking heuristic checks against a valid inner query and
 * returns a list of warnings. Warnings are informative — they never block
 * execution. The proxy has a 15-second request timeout, so the unbounded
 * transaction scan warning is particularly important for user experience.
 */

import type { ActualQLQuery, LintWarning } from "../types";

// ─── ParsedQuery ──────────────────────────────────────────────────────────────

export type ParsedQuery = {
  /** Full wrapped body ready to pass to runQuery. */
  body: { ActualQLquery: ActualQLQuery };
  /** Inner query — used for linting, explaining, and cURL generation. */
  inner: ActualQLQuery;
};

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseQuery(input: string): ParsedQuery | Error {
  if (!input.trim()) {
    return new Error("Query is empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return new Error("Invalid JSON — check syntax.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return new Error(
      'Query must be a JSON object with an "ActualQLquery" key.'
    );
  }

  const obj = parsed as Record<string, unknown>;

  // Accept both the wrapped format { "ActualQLquery": { ... } } and a bare
  // ActualQL body { "table": "...", ... } typed directly.
  let inner: Record<string, unknown>;
  if (
    "ActualQLquery" in obj &&
    typeof obj.ActualQLquery === "object" &&
    obj.ActualQLquery !== null &&
    !Array.isArray(obj.ActualQLquery)
  ) {
    inner = obj.ActualQLquery as Record<string, unknown>;
  } else if (typeof obj.table === "string") {
    inner = obj;
  } else {
    return new Error(
      'Wrap your query: { "ActualQLquery": { "table": "..." } } or provide a bare object with a "table" field.'
    );
  }

  if (typeof inner.table !== "string" || !inner.table.trim()) {
    return new Error(
      'The query must have a "table" string field.'
    );
  }

  const innerQuery = inner as unknown as ActualQLQuery;

  return { body: { ActualQLquery: innerQuery }, inner: innerQuery };
}

// ─── Lint ─────────────────────────────────────────────────────────────────────

export function lintQuery(query: ActualQLQuery): LintWarning[] {
  const warnings: LintWarning[] = [];

  // Unbounded transaction scan — the proxy enforces a 15-second timeout.
  // A full transactions table can have thousands of rows. A query with any
  // filter is considered scoped and does not trigger this warning.
  if (
    query.table === "transactions" &&
    !query.limit &&
    !query.groupBy?.length &&
    !query.calculate &&
    (!query.filter || Object.keys(query.filter).length === 0)
  ) {
    warnings.push({
      id: "unbounded-transactions",
      message:
        'Unbounded transaction scan — may return thousands of rows and time out (15s proxy limit). Add "limit", "groupBy", or "calculate" to narrow the scope.',
    });
  }

  // Empty $oneof — will silently match nothing
  if (query.filter && hasEmptyOneof(query.filter)) {
    warnings.push({
      id: "empty-oneof",
      message:
        'Empty "$oneof" array — this filter matches nothing and will return no results.',
    });
  }

  // groupBy without an aggregate in select — every group will return its
  // raw rows, which is rarely what the user intends
  if (
    query.groupBy?.length &&
    !query.calculate &&
    Array.isArray(query.select)
  ) {
    const hasAggregate = (query.select as Array<unknown>).some(
      (s) =>
        typeof s === "object" &&
        s !== null &&
        Object.values(s as Record<string, unknown>).some(
          (v) =>
            typeof v === "object" &&
            v !== null &&
            ("$count" in (v as object) ||
              "$sum" in (v as object) ||
              "$avg" in (v as object) ||
              "$min" in (v as object) ||
              "$max" in (v as object))
        )
    );
    if (!hasAggregate) {
      warnings.push({
        id: "groupby-no-aggregate",
        message:
          '"groupBy" without an aggregate — grouped queries typically need a "$count" or "$sum" in "select".',
      });
    }
  }

  return warnings;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasEmptyOneof(filter: unknown): boolean {
  if (!filter || typeof filter !== "object") return false;
  const obj = filter as Record<string, unknown>;

  // Handle $and / $or compound operators at this level
  if ("$and" in obj && Array.isArray(obj["$and"])) {
    return (obj["$and"] as unknown[]).some((clause) => hasEmptyOneof(clause));
  }
  if ("$or" in obj && Array.isArray(obj["$or"])) {
    return (obj["$or"] as unknown[]).some((clause) => hasEmptyOneof(clause));
  }

  // Check each field's operator object for an empty $oneof
  for (const val of Object.values(obj)) {
    if (
      typeof val === "object" &&
      val !== null &&
      "$oneof" in (val as object) &&
      Array.isArray((val as Record<string, unknown>)["$oneof"]) &&
      ((val as Record<string, unknown>)["$oneof"] as unknown[]).length === 0
    ) {
      return true;
    }

    // Recurse into nested filter objects (e.g. dotted-path sub-objects)
    if (typeof val === "object" && val !== null && !Array.isArray(val)) {
      if (hasEmptyOneof(val)) return true;
    }
  }

  return false;
}
