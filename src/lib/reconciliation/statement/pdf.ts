/**
 * Public boundary for the deterministic PDF statement parser.
 *
 * The implementation is split by stage under `./pdf/`: positioned extraction,
 * layout reconstruction, regions/schema, transaction blocks, interpretation,
 * validation, corrections, and profiles. Keep callers on this boundary so the
 * reconciliation import contract does not depend on parser internals.
 */

import { parseExactDecimal } from "./pdf/candidates";
import type { PdfParseOptions } from "./pdf/pipeline";
import { parsePdfStatementDocumentV2 } from "./pdf/pipeline";
import type { PdfStatementDocument, PdfStatementPage } from "./pdf/model";

export * from "./pdf/model";
export * from "./pdf/corrections";
export * from "./pdf/profiles";
export type { PdfParseOptions } from "./pdf/pipeline";
export { diagnosticsArePrivacySafe } from "./pdf/diagnostics";
export { normalizePdfText } from "./pdf/text";
export { reconstructPdfLayout } from "./pdf/layout";
export { columnExamplesForRegions } from "./pdf/columns";

export function parsePdfStatementDocument(
  document: PdfStatementDocument,
  options: PdfParseOptions = {}
) {
  return parsePdfStatementDocumentV2(document, options);
}

export function parsePdfStatementPages(pages: PdfStatementPage[], options: PdfParseOptions = {}) {
  return parsePdfStatementDocumentV2({ version: 2, pages }, options);
}

/**
 * Convert a reviewed decimal to Actual's integer 2-decimal amount boundary.
 * Values with meaningful precision beyond two places are rejected rather than
 * rounded silently; the parser model itself retains their exact scale.
 */
export function parsePdfMoneyToMinorUnits(text: string): number | null {
  const parsed = parseExactDecimal(text, "auto");
  if (!parsed) return null;
  let coefficient = parsed.coefficient;
  if (parsed.scale < 2) coefficient *= BigInt(10) ** BigInt(2 - parsed.scale);
  if (parsed.scale > 2) {
    const divisor = BigInt(10) ** BigInt(parsed.scale - 2);
    if (coefficient % divisor !== BigInt(0)) return null;
    coefficient /= divisor;
  }
  if (coefficient > BigInt(Number.MAX_SAFE_INTEGER) || coefficient < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(coefficient);
}
