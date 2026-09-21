import { dateCandidates, looksLikeMoney, moneyCandidates } from "./candidates";
import type { PdfVisualRow } from "./model";

/**
 * Row-level questions answered cell by cell.
 *
 * A row's `text` is our own join of its cells with spaces, so reading it as one
 * string can invent values that the statement never printed: a reference ending
 * `…/2019-06-` followed by an amount cell `1,035.49` reads as the date
 * `2019-06-1`. A printed value lives inside one cell, so that is where these
 * predicates look.
 */
export function rowDateCandidates(row: PdfVisualRow): string[] {
  return row.cells.flatMap((cell) => dateCandidates(cell.text));
}

export function rowLooksLikeDate(row: PdfVisualRow): boolean {
  return row.cells.some((cell) => dateCandidates(cell.text).length > 0);
}

export function rowLooksLikeMoney(row: PdfVisualRow): boolean {
  return row.cells.some((cell) => looksLikeMoney(cell.text));
}

export function rowHasMoney(row: PdfVisualRow): boolean {
  return row.cells.some((cell) => moneyCandidates(cell.text).length > 0);
}
