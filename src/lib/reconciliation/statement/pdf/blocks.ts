import { looksLikeDate, moneyCandidates } from "./candidates";
import { diagnostic } from "./diagnostics";
import { columnAppliesToPage, columnBoundsForPage } from "./columns";
import type {
  PdfColumn,
  PdfDiagnosticEvent,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfTableSchema,
  PdfTransactionBlock,
  PdfVisualRow,
} from "./model";

export type PdfBlockResult = {
  blocks: PdfTransactionBlock[];
  diagnostics: PdfDiagnosticEvent[];
};

const SECTION_HEADER = /^(?:(?:primary|main|supplementary|additional)\s+(?:card|account|cardholder)|(?:cardholder|account)\s+(?:ending|number|no\.?|#)\b)/i;
const DIRECTION_SECTION_HEADERS: ["debit" | "credit", RegExp][] = [
  ["credit", /^(?:payments?(?:\s+and\s+(?:other\s+)?credits?)?|credits?|deposits?|money\s+in)(?:\s+activity|\s+transactions?)?\s*$/i],
  ["debit", /^(?:purchases?(?:\s+and\s+(?:other\s+)?debits?)?|withdrawals?|money\s+out|fees?(?:\s+and\s+charges?)?|interest\s+charges?)(?:\s+activity|\s+transactions?)?\s*$/i],
];
const CONTROL_ROW = /^(?:opening|previous|beginning|closing|ending)\s+balance\b|^(?:balance\s+(?:(?:brought|carried)\s+)?forward|brought\s+forward|carried\s+forward)\b|^(?:sub\s*total|total)(?:\s|$)|\b(?:balance\s+(?:(?:brought|carried)\s+)?forward|opening\s+balance|closing\s+balance)\b/i;

export function assemblePdfTransactionBlocks(
  pages: PdfReconstructedPage[],
  regions: PdfRegion[],
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance
): PdfBlockResult {
  const includedRegions = regions.filter((region) => region.kind === "transactions" && region.included);
  const rows = includedRegions.flatMap((region) => rowsForRegion(pages, region))
    .filter((row) => !row.repeatedHeaderFooter)
    .sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
  const anchorColumn = schema?.columns.find((column) => column.role === guidance.transactionAnchorRole)
    ?? schema?.columns.find((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role));
  const rowPitchByPage = new Map(pages.map((page) => [page.pageNumber, typicalRowPitch(
    rows.filter((row) => row.pageNumber === page.pageNumber)
  )]));
  const blocks: PdfTransactionBlock[] = [];
  const controlRows: PdfVisualRow[] = [];
  let sectionId = "section-1";
  let sectionDirection: "debit" | "credit" | undefined;
  let sectionIndex = 1;
  let pendingRows: PdfVisualRow[] = [];

  const appendPendingToPrevious = (pending: PdfVisualRow[]) => {
    const previous = blocks.at(-1);
    if (!previous) return;
    pending.forEach((pendingRow) => {
      if (isContinuation(previous, pendingRow, pages)) appendRow(previous, pendingRow);
    });
  };

  for (const row of rows) {
    const declaredDirection = directionForSection(row.text);
    if (declaredDirection && !looksLikeDate(row.text) && moneyCandidates(row.text).length === 0) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      sectionIndex += 1;
      sectionId = `section-${sectionIndex}`;
      sectionDirection = declaredDirection;
      continue;
    }
    if (SECTION_HEADER.test(row.text) && !looksLikeDate(row.text)) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      sectionIndex += 1;
      sectionId = `section-${sectionIndex}`;
      sectionDirection = undefined;
      continue;
    }
    const pageWidth = pages.find((page) => page.pageNumber === row.pageNumber)?.width ?? 1;
    if (isControlRow(row)) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      controlRows.push(row);
      continue;
    }
    const anchorCells = anchorSources(row, anchorColumn, pageWidth);
    if (anchorCells.length) {
      // PDF text on one printed line can be emitted on slightly different
      // baselines. Delay continuation assignment until the next anchor is
      // known, then move rows whose boxes overlap that anchor into its block.
      // This keeps a transaction's description with its own date even when
      // the description happens to sort just before the date token.
      const alignedWithNext = trailingRowsMatching(pendingRows, (pendingRow) =>
        pendingRow.pageNumber === row.pageNumber
        && anchorCells.some((cell) => sharesAnchorBand(
          pendingRow,
          cell,
          rowPitchByPage.get(row.pageNumber) ?? Math.max(row.height, cell.height) * 2
        ))
      );
      const alignedIds = new Set(alignedWithNext.map((pendingRow) => pendingRow.id));
      appendPendingToPrevious(pendingRows.filter((pendingRow) => !alignedIds.has(pendingRow.id)));
      pendingRows = [];
      blocks.push(blockFromRows([...alignedWithNext, row], sectionId, false, sectionDirection));
      continue;
    }
    if (isSuppressedDateTransaction(
      row,
      schema?.columns ?? [],
      pageWidth,
      previousTransactionHasAccountAmount(
        blocks.at(-1),
        pendingRows,
        pages,
        schema?.columns ?? []
      )
    )) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      blocks.push(blockFromRows([row], sectionId, true, sectionDirection));
      continue;
    }
    pendingRows.push(row);
  }
  appendPendingToPrevious(pendingRows);

  return {
    blocks,
    diagnostics: [
      ...blocks.map((block) => diagnostic({
        stage: "block",
        code: "TRANSACTION_BLOCK_ASSEMBLED",
        pageNumber: block.pageNumber,
        sourceIds: block.sourceIds,
        metrics: {
          rows: block.rowIds.length,
          section: block.sectionId,
          inheritedDate: Boolean(block.inheritsPreviousDate),
        },
      })),
      ...controlRows.map((row) => diagnostic({
        stage: "block",
        code: "CONTROL_ROW_EXCLUDED",
        pageNumber: row.pageNumber,
        sourceIds: row.cells.flatMap((cell) => cell.tokenIds),
      })),
    ],
  };
}

export function rowValuesForColumn(row: PdfVisualRow, column: PdfColumn | undefined, pageWidth: number) {
  if (!column || !columnAppliesToPage(column, row.pageNumber)) return [];
  const bounds = columnBoundsForPage(column, pageWidth);
  return row.cells.filter((cell) => horizontalOverlap(cell.x, cell.x + cell.width, bounds.xStart, bounds.xEnd) >= 0.25);
}

function anchorSources(row: PdfVisualRow, column: PdfColumn | undefined, pageWidth: number) {
  const mapped = column
    ? rowValuesForColumn(row, column, pageWidth).filter((cell) => looksLikeDate(cell.text))
    : [];
  if (mapped.length) return mapped;
  // Once a date column is mapped, values elsewhere in the row (especially
  // decimal amounts such as 11.05) must not become date anchors.
  if (column) return [];
  // Without a mapped date column, require both a date and a financial value
  // before a full row can create a boundary.
  if (!looksLikeDate(row.text) || moneyCandidates(row.text).length === 0) return [];
  const datedCells = row.cells.filter((cell) => looksLikeDate(cell.text));
  return datedCells.length ? datedCells : row.cells;
}

function isContinuation(
  previous: PdfTransactionBlock,
  row: PdfVisualRow,
  pages: PdfReconstructedPage[]
) {
  if (row.pageNumber === previous.pageNumber) return row.y >= previous.y;
  const pageHeight = pages.find((page) => page.pageNumber === row.pageNumber)?.height;
  return row.pageNumber === previous.pageNumber + 1
    && pageHeight !== undefined
    && row.y < pageHeight * 0.3;
}

function blockFromRows(
  rows: PdfVisualRow[],
  sectionId: string,
  inheritsPreviousDate: boolean,
  sectionDirection?: "debit" | "credit"
): PdfTransactionBlock {
  const ordered = [...rows].sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
  const anchor = rows.at(-1)!;
  const memberRows = [anchor, ...ordered.filter((row) => row.id !== anchor.id)];
  const firstPageRows = ordered.filter((row) => row.pageNumber === anchor.pageNumber);
  const x = Math.min(...firstPageRows.map((row) => row.x));
  const y = Math.min(...firstPageRows.map((row) => row.y));
  const endX = Math.max(...firstPageRows.map((row) => row.x + row.width));
  const endY = Math.max(...firstPageRows.map((row) => row.y + row.height));
  return {
    // Anchor-source IDs survive calibration reruns, so row-level corrections
    // cannot slide onto a different transaction when a preceding block changes.
    id: `block-${anchor.id}`,
    sectionId,
    pageNumber: anchor.pageNumber,
    x,
    y,
    width: endX - x,
    height: endY - y,
    // Keep the anchor first for stable split/correction semantics even when a
    // slightly higher description baseline is visually read before it.
    rowIds: memberRows.map((row) => row.id),
    sourceIds: ordered.flatMap((row) => row.cells.flatMap((cell) => cell.tokenIds)),
    excluded: false,
    manuallyCreated: false,
    inheritsPreviousDate,
    sectionDirection,
  };
}

function directionForSection(text: string) {
  return DIRECTION_SECTION_HEADERS.find(([, pattern]) => pattern.test(text.trim()))?.[0];
}

function isControlRow(row: PdfVisualRow) {
  return CONTROL_ROW.test(row.text.trim());
}

function isSuppressedDateTransaction(
  row: PdfVisualRow,
  columns: PdfColumn[],
  pageWidth: number,
  previousHasAccountAmount: boolean
) {
  if (!columns.length || looksLikeDate(row.text)) return false;
  const values = (roles: PdfColumn["role"][]) => columns
    .filter((column) => roles.includes(column.role))
    .flatMap((column) => rowValuesForColumn(row, column, pageWidth));
  const accountAmount = values(["amount", "debit", "credit"])
    .some((cell) => moneyCandidates(cell.text).length > 0);
  const description = values(["description", "reference"])
    .some((cell) => cell.text.trim().length > 0);
  if (!accountAmount || !description) return false;

  const balance = values(["balance"])
    .some((cell) => moneyCandidates(cell.text).length > 0);
  const direction = values(["direction"])
    .some((cell) => /^(?:CR|DR|C|D|CREDIT|DEBIT)$/i.test(cell.text.trim()));
  const directionalAmount = values(["debit", "credit"])
    .some((cell) => moneyCandidates(cell.text).length > 0);
  // Missing dates are treated as suppressed only when the rest of the row
  // provides independent structural evidence. A bare amount on a continuation
  // line remains in its dated transaction block.
  return previousHasAccountAmount && (balance || direction || directionalAmount);
}

function previousTransactionHasAccountAmount(
  previous: PdfTransactionBlock | undefined,
  pendingRows: PdfVisualRow[],
  pages: PdfReconstructedPage[],
  columns: PdfColumn[]
) {
  if (!previous) return false;
  const existing = rowsForBlockIds(pages, previous.rowIds);
  return [...existing, ...pendingRows].some((row) => {
    const pageWidth = pages.find((page) => page.pageNumber === row.pageNumber)?.width ?? 1;
    return columns
      .filter((column) => ["amount", "debit", "credit"].includes(column.role))
      .flatMap((column) => rowValuesForColumn(row, column, pageWidth))
      .some((cell) => moneyCandidates(cell.text).length > 0);
  });
}

function rowsForBlockIds(pages: PdfReconstructedPage[], rowIds: string[]) {
  const ids = new Set(rowIds);
  return pages.flatMap((page) => page.rows.filter((row) => ids.has(row.id)));
}

function appendRow(block: PdfTransactionBlock, row: PdfVisualRow) {
  if (block.rowIds.includes(row.id)) return;
  const previousEndX = block.x + block.width;
  block.rowIds.push(row.id);
  block.sourceIds.push(...row.cells.flatMap((cell) => cell.tokenIds));
  block.x = Math.min(block.x, row.x);
  block.y = block.pageNumber === row.pageNumber ? Math.min(block.y, row.y) : block.y;
  block.width = Math.max(previousEndX, row.x + row.width) - block.x;
  if (block.pageNumber === row.pageNumber) block.height = Math.max(block.height, row.y + row.height - block.y);
}

function rowsForRegion(pages: PdfReconstructedPage[], region: PdfRegion) {
  const rowIds = new Set(region.rowIds);
  return pages.find((page) => page.pageNumber === region.pageNumber)?.rows.filter((row) => rowIds.has(row.id)) ?? [];
}

function horizontalOverlap(startA: number, endA: number, startB: number, endB: number) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  return overlap / Math.max(1, Math.min(endA - startA, endB - startB));
}

function verticalOverlap(startA: number, endA: number, startB: number, endB: number) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  return overlap / Math.max(1, Math.min(endA - startA, endB - startB));
}

function sharesAnchorBand(
  row: PdfVisualRow,
  anchor: PdfVisualRow["cells"][number],
  rowPitch: number
) {
  if (verticalOverlap(row.y, row.y + row.height, anchor.y, anchor.y + anchor.height) >= 0.25) return true;
  const centerDistance = Math.abs((row.y + row.height / 2) - (anchor.y + anchor.height / 2));
  const fontMetricTolerance = Math.max(row.height, anchor.height) * 1.25;
  const anchorBand = Math.min(rowPitch * 0.75, Math.max(fontMetricTolerance, rowPitch * 0.7));
  return centerDistance <= anchorBand;
}

function trailingRowsMatching(rows: PdfVisualRow[], predicate: (row: PdfVisualRow) => boolean) {
  let start = rows.length;
  while (start > 0 && predicate(rows[start - 1])) start -= 1;
  return rows.slice(start);
}

function typicalRowPitch(rows: PdfVisualRow[]) {
  const centers = rows
    .map((row) => row.y + row.height / 2)
    .sort((left, right) => left - right);
  const gaps = centers
    .slice(1)
    .map((center, index) => center - centers[index])
    .filter((gap) => gap > 1)
    .sort((left, right) => left - right);
  if (!gaps.length) return rows[0]?.height ? rows[0].height * 2 : 20;
  const middle = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2;
}
