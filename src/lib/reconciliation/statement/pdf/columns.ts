import { CURRENCY_CANDIDATE, looksLikeDate, moneyCandidates } from "./candidates";
import type { PdfColumn, PdfColumnRole, PdfReconstructedPage, PdfRegion } from "./model";

export function columnBoundsForPage(column: PdfColumn, pageWidth: number) {
  const referenceWidth = column.referencePageWidth;
  const scale = referenceWidth && referenceWidth > 0 ? pageWidth / referenceWidth : 1;
  return { xStart: column.xStart * scale, xEnd: column.xEnd * scale };
}

export function columnCoordinateToReference(column: PdfColumn, pageWidth: number, value: number) {
  const referenceWidth = column.referencePageWidth;
  return referenceWidth && referenceWidth > 0 ? value * referenceWidth / Math.max(1, pageWidth) : value;
}

export function columnAppliesToPage(column: PdfColumn, pageNumber: number) {
  return column.pageNumber === null || column.pageNumber === pageNumber;
}

export function columnExamplesForRegions(
  pages: PdfReconstructedPage[],
  regions: PdfRegion[],
  column: PdfColumn,
  limit = 3
) {
  if (column.role === "ignore") return [];
  const includedRows = new Set(regions
    .filter((region) => region.kind === "transactions" && region.included)
    .flatMap((region) => region.rowIds.map((rowId) => `${region.pageNumber}:${rowId}`)));
  const values = pages.flatMap((page) => {
    if (!columnAppliesToPage(column, page.pageNumber)) return [];
    const bounds = columnBoundsForPage(column, page.width);
    return page.rows
      .filter((row) => includedRows.has(`${page.pageNumber}:${row.id}`))
      .flatMap((row) => row.cells)
      .filter((cell) => {
        const center = cell.x + cell.width / 2;
        return center >= bounds.xStart && center < bounds.xEnd;
      })
      .map((cell) => cell.text.trim())
      .filter((value) => value && value !== column.header && supportsExample(column.role, value));
  });
  return [...new Set(values)].slice(0, limit);
}

function supportsExample(role: PdfColumnRole, value: string) {
  if (["transaction-date", "posting-date", "value-date"].includes(role)) return looksLikeDate(value);
  if (["debit", "credit", "amount", "balance", "original-amount", "exchange-rate", "fee", "vat"].includes(role)) {
    return !looksLikeDate(value) && moneyCandidates(value).length > 0;
  }
  if (role === "direction") return /^(?:CR|DR)$/i.test(value);
  if (role === "currency" || role === "original-currency") {
    const match = value.match(CURRENCY_CANDIDATE)?.[0];
    return Boolean(match && match.length === value.length);
  }
  if (role === "description" || role === "reference") return /[\p{L}\p{N}]/u.test(value);
  return false;
}
