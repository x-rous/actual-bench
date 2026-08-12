/**
 * What a statement row *says*, as one string (RD-072 §2.1).
 *
 * A row has two text channels and either may be the empty one: most statements
 * fill the merchant channel, but a file whose single text column is genuinely a
 * memo maps it to the notes and leaves the merchant channel unset.
 *
 * One definition, used by both the matcher and every screen that shows a
 * statement row. That is the point of putting it here rather than inlining the
 * fallback twice: the text a user reads in the grid is the text the score was
 * computed from, so an unexpected match is explainable from what is on screen.
 *
 * Note this is deliberately *not* the same as the write-side fallback in
 * `structured.ts`. That one decides what gets stored as `imported_payee`, and
 * only promotes a memo when the profile says to; this one only decides what to
 * compare and display, so a row never ends up silently textless.
 */

import type { StatementRow } from "../types";

export function statementText(
  row: Pick<StatementRow, "importedPayee" | "bankNotes"> | undefined | null
): string {
  if (!row) return "";
  return row.importedPayee.trim() || row.bankNotes?.trim() || "";
}
