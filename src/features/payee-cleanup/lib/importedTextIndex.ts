/**
 * The budget's own import history, as a backtest corpus (RD-078 §17).
 *
 * Grouped rather than per-transaction. A budget can hold tens of thousands of
 * transactions but only hundreds of distinct import strings, and it is the
 * distinct strings a pattern is tested against — grouping turns an unbounded
 * read into a bounded one and costs nothing in accuracy, since the transaction
 * count comes back with each group.
 *
 * Both source fields are read. Where a bank puts the merchant in the memo, the
 * discriminating text is in `notes`, and a rule that can only look at
 * `imported_payee` would have nothing to match on.
 */

import { runQuery } from "@/lib/api/query";
import type { ConnectionInstance } from "@/store/connection";
import type { ImportedTextRow, SourceField } from "./ruleCandidates";

/** Guard against a pathological budget; well above any realistic distinct-string count. */
const ROW_LIMIT = 5000;

type QueryRow = Record<string, unknown> & { transactionCount?: number };

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readField(
  connection: ConnectionInstance,
  field: SourceField
): Promise<{ rows: ImportedTextRow[]; hitLimit: boolean }> {
  const response = await runQuery<{ data: QueryRow[] }>(connection, {
    ActualQLquery: {
      table: "transactions",
      filter: { [field]: { $ne: null } },
      groupBy: [field, "payee", "payee.name"],
      select: [
        field,
        "payee",
        "payee.name",
        { transactionCount: { $count: "$id" } },
      ],
      limit: ROW_LIMIT,
    },
  });

  const returned = response.data ?? [];
  // Recorded before filtering. Blank and unusable rows are dropped below, so a
  // limit-sized response containing one of them would otherwise come back
  // *under* the limit and be reported as a complete read.
  const hitLimit = returned.length >= ROW_LIMIT;

  const rows: ImportedTextRow[] = [];
  for (const row of returned) {
    const text = toText(row[field]);
    if (!text) continue;
    rows.push({
      field,
      text,
      payeeId: toText(row.payee),
      // The name comes back alongside the id so a row can be attributed even if
      // the id serialization differs, and so the UI can say *which* payee an
      // unexpected match belongs to instead of showing a bare id.
      payeeName: toText(row["payee.name"]),
      transactionCount:
        typeof row.transactionCount === "number" ? row.transactionCount : 0,
    });
  }
  return { rows, hitLimit };
}

/**
 * Reads both source fields.
 *
 * Sequential rather than parallel: the Direct runtime serializes work against
 * one budget anyway, and a failure on one field should not be masked by the
 * other.
 */
export type ImportedTextIndex = {
  rows: ImportedTextRow[];
  /**
   * True when either read hit `ROW_LIMIT`.
   *
   * It matters because a backtest over a truncated sample can report "and
   * nothing else" about a rule that would in fact catch transactions the query
   * never returned. Silently basing a safety claim on a partial read is worse
   * than admitting the limit.
   */
  truncated: boolean;
};

export async function getImportedTextIndex(
  connection: ConnectionInstance
): Promise<ImportedTextIndex> {
  const importedPayee = await readField(connection, "imported_payee");
  const notes = await readField(connection, "notes");

  return {
    rows: [...importedPayee.rows, ...notes.rows],
    truncated: importedPayee.hitLimit || notes.hitLimit,
  };
}
