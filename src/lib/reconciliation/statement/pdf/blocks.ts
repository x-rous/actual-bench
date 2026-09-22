import { looksLikeDate, moneyCandidates } from "./candidates";
import { rowHasMoney, rowLooksLikeDate } from "./rows";
import { diagnostic } from "./diagnostics";
import { rowValuesForColumn } from "./columns";
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
  /** Rows inside an included transaction area that no block claimed. */
  unassignedRows: PdfVisualRow[];
  diagnostics: PdfDiagnosticEvent[];
};

const SECTION_HEADER = /^(?:(?:primary|main|supplementary|additional)\s+(?:card|account|cardholder)|(?:cardholder|account)\s+(?:ending|number|no\.?|#)\b)/i;
const DIRECTION_SECTION_HEADERS: ["debit" | "credit", RegExp][] = [
  ["credit", /^(?:payments?(?:\s+and\s+(?:other\s+)?credits?)?|credits?|deposits?|money\s+in)(?:\s+activity|\s+transactions?)?\s*$/i],
  ["debit", /^(?:purchases?(?:\s+and\s+(?:other\s+)?debits?)?|withdrawals?|money\s+out|fees?(?:\s+and\s+charges?)?|interest\s+charges?)(?:\s+activity|\s+transactions?)?\s*$/i],
];
/** A printed rule between transactions: dashes, dots, or underscores only. */
const SEPARATOR_ROW = /^[\s\p{Pd}\u00b7._]+$/u;
const CONTROL_ROW = /^(?:opening|previous|beginning|closing|ending)\s+balance\b|^(?:balance\s+(?:(?:brought|carried)\s+)?forward|brought\s+forward|carried\s+forward)\b|^(?:sub\s*total|total)(?:\s|$)|\b(?:balance\s+(?:(?:brought|carried)\s+)?forward|opening\s+balance|closing\s+balance)\b/i;

export function assemblePdfTransactionBlocks(
  pages: PdfReconstructedPage[],
  regions: PdfRegion[],
  schema: PdfTableSchema | null,
  guidance: PdfParserGuidance
): PdfBlockResult {
  const includedRegions = regions.filter((region) => region.kind === "transactions" && region.included);
  const rows = includedRegions.flatMap((region) => rowsForRegion(pages, region))
    // The column header belongs to the area, not to any transaction in it.
    .filter((row) => !row.repeatedHeaderFooter && !row.tableHeader)
    .sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
  const anchorColumn = schema?.columns.find((column) => column.role === guidance.transactionAnchorRole)
    ?? schema?.columns.find((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role));
  const rowPitchByPage = new Map(pages.map((page) => [page.pageNumber, typicalRowPitch(
    rows.filter((row) => row.pageNumber === page.pageNumber)
  )]));
  const blocks: PdfTransactionBlock[] = [];
  const controlRows: PdfVisualRow[] = [];
  const unassignedRows: PdfVisualRow[] = [];
  const widthByPage = new Map(pages.map((page) => [page.pageNumber, page.width]));
  const rowsById = new Map(pages.flatMap((page) => page.rows.map((row) => [row.id, row] as const)));
  let sectionId = "section-1";
  let sectionDirection: "debit" | "credit" | undefined;
  let sectionIndex = 1;
  let pendingRows: PdfVisualRow[] = [];
  let previousRow: PdfVisualRow | undefined;
  let previousAnchorRow: PdfVisualRow | undefined;

  const appendPendingToPrevious = (pending: PdfVisualRow[]) => {
    const previous = blocks.at(-1);
    pending.forEach((pendingRow) => {
      if (isSeparatorRow(pendingRow)) return;
      if (previous && isContinuation(previous, pendingRow, pages)) appendRow(previous, pendingRow);
      // A row inside an included transaction area that belongs to no block is
      // reported rather than dropped: the review screen counts it and the user
      // can mark it as a transaction.
      else unassignedRows.push(pendingRow);
    });
  };

  for (const row of rows) {
    const pitch = rowPitchByPage.get(row.pageNumber) ?? Math.max(row.height * 2, 1);
    const separated = standsApartFromPreviousRow(row, previousRow, pitch);
    previousRow = row;
    const pageWidth = widthByPage.get(row.pageNumber) ?? 1;
    const anchorCells = anchorSources(row, anchorColumn, pageWidth);
    const declaredDirection = directionForSection(row.text);
    // A heading owns the rows under it, so it must look like a heading: a
    // wrapped description line such as "PAYMENT" sits one line under its own
    // transaction and must stay part of it.
    if (declaredDirection && separated && !rowLooksLikeDate(row) && !rowHasMoney(row)) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      sectionIndex += 1;
      sectionId = `section-${sectionIndex}`;
      sectionDirection = declaredDirection;
      continue;
    }
    if (SECTION_HEADER.test(row.text) && separated && !rowLooksLikeDate(row)) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      sectionIndex += 1;
      sectionId = `section-${sectionIndex}`;
      sectionDirection = undefined;
      continue;
    }
    // A dated row carrying its own account amount is a transaction even when
    // its description starts with a control word, so merchants such as
    // "TOTAL ENERGIES" are not discarded. A balance-forward or total line
    // prints no amount of its own and stays a control row.
    if (isControlRow(row) && (!anchorCells.length || !hasMappedAccountAmount(row, schema?.columns ?? [], pageWidth))) {
      appendPendingToPrevious(pendingRows);
      pendingRows = [];
      controlRows.push(row);
      continue;
    }
    if (anchorCells.length) {
      // A statement does not always print the date on the first line of a
      // transaction. Decide where the previous transaction ended rather than
      // which lines sit near this date, so a lead description line is not
      // handed to the transaction above it.
      const carried = carriedRowsForAnchor(
        pendingRows,
        row,
        anchorCells,
        previousAnchorRow,
        schema?.columns ?? [],
        pageWidth,
        rowPitchByPage.get(row.pageNumber) ?? Math.max(row.height * 2, 1)
      );
      const carriedIds = new Set(carried.map((pendingRow) => pendingRow.id));
      appendPendingToPrevious(pendingRows.filter((pendingRow) => !carriedIds.has(pendingRow.id)));
      pendingRows = [];
      previousAnchorRow = row;
      blocks.push(blockFromRows([...carried, row], sectionId, false, sectionDirection));
      continue;
    }
    if (isSuppressedDateTransaction(
      row,
      schema?.columns ?? [],
      pageWidth,
      previousTransactionHasAccountAmount(
        blocks.at(-1),
        pendingRows,
        { rowsById, widthByPage },
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
    unassignedRows,
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
      ...unassignedRows.map((row) => diagnostic({
        stage: "block",
        code: "ROW_UNASSIGNED",
        pageNumber: row.pageNumber,
        sourceIds: row.cells.flatMap((cell) => cell.tokenIds),
      })),
    ],
  };
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
  if (!rowLooksLikeDate(row) || !rowHasMoney(row)) return [];
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
  if (!columns.length) return false;
  // Whether a row carries its own date is a question about the date column.
  // Descriptions often print a date of their own - a purchase date, a value
  // date in the narrative - and that must not stop the row becoming the
  // transaction it is.
  const dateColumns = columns.filter((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role));
  const printsItsOwnDate = dateColumns.length
    ? dateColumns.some((column) => rowValuesForColumn(row, column, pageWidth).some((cell) => looksLikeDate(cell.text)))
    : rowLooksLikeDate(row);
  if (printsItsOwnDate) return false;
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
  index: { rowsById: Map<string, PdfVisualRow>; widthByPage: Map<number, number> },
  columns: PdfColumn[]
) {
  if (!previous) return false;
  const existing = previous.rowIds.flatMap((rowId) => {
    const row = index.rowsById.get(rowId);
    return row ? [row] : [];
  });
  return [...existing, ...pendingRows].some((row) => {
    const pageWidth = index.widthByPage.get(row.pageNumber) ?? 1;
    return columns
      .filter((column) => ["amount", "debit", "credit"].includes(column.role))
      .flatMap((column) => rowValuesForColumn(row, column, pageWidth))
      .some((cell) => moneyCandidates(cell.text).length > 0);
  });
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

function verticalOverlap(startA: number, endA: number, startB: number, endB: number) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  return overlap / Math.max(1, Math.min(endA - startA, endB - startB));
}

function sharesAnchorBand(
  row: PdfVisualRow,
  anchor: PdfVisualRow["cells"][number],
  rowPitch: number,
  reach = 0.75
) {
  if (verticalOverlap(row.y, row.y + row.height, anchor.y, anchor.y + anchor.height) >= 0.25) return true;
  const centerDistance = Math.abs((row.y + row.height / 2) - (anchor.y + anchor.height / 2));
  const fontMetricTolerance = Math.max(row.height, anchor.height) * 1.25;
  // A reach of about one printed line is far enough for a lead description
  // line that sits directly above its own date; the tighter default leaves a
  // line that belongs to the transaction above where it is.
  const anchorBand = Math.max(fontMetricTolerance, rowPitch * reach);
  return centerDistance <= anchorBand;
}

/**
 * A heading is preceded by white space, starts a page, or opens the area. A
 * continuation line sits inside the previous row's line pitch.
 */
function standsApartFromPreviousRow(
  row: PdfVisualRow,
  previous: PdfVisualRow | undefined,
  rowPitch: number
) {
  if (!previous || previous.pageNumber !== row.pageNumber) return true;
  // Nothing to continue: the line above is a table header or another heading,
  // not a transaction whose description could wrap onto this line.
  if (!looksLikeDate(previous.text) || moneyCandidates(previous.text).length === 0) return true;
  const gap = row.y - (previous.y + previous.height);
  return gap >= Math.max(2, rowPitch * 0.5);
}

function hasMappedAccountAmount(row: PdfVisualRow, columns: PdfColumn[], pageWidth: number) {
  return columns
    .filter((column) => ["amount", "debit", "credit"].includes(column.role))
    .flatMap((column) => rowValuesForColumn(row, column, pageWidth))
    .some((cell) => moneyCandidates(cell.text).length > 0);
}

function isSeparatorRow(row: PdfVisualRow) {
  return SEPARATOR_ROW.test(row.text.trim());
}

/**
 * Which unclaimed lines belong to the transaction this date anchor starts.
 *
 * A statement does not always print the date on a transaction's first line, so
 * the lines above an anchor have to be divided rather than assumed to belong
 * above. In order of trust:
 *
 * 1. A printed separator is the statement's own boundary.
 * 2. Otherwise a line is claimed only when it sits within about one line of
 *    this date and closer to it than to the previous one, which keeps an
 *    evenly spaced wrapped description with the transaction above it.
 * 3. A line carrying the previous transaction's account amount completes that
 *    transaction, so it and everything above it stay there.
 */
function carriedRowsForAnchor(
  pending: PdfVisualRow[],
  anchor: PdfVisualRow,
  anchorCells: PdfVisualRow["cells"],
  previousAnchor: PdfVisualRow | undefined,
  columns: PdfColumn[],
  pageWidth: number,
  rowPitch: number
) {
  const lastSeparator = findLastIndex(pending, isSeparatorRow);
  // A printed separator is the statement's own boundary and is taken at face
  // value, including when the transaction prints its total on its first line.
  if (lastSeparator >= 0) return pending.slice(lastSeparator + 1).filter((row) => !isSeparatorRow(row));

  const candidates = lastSeparator >= 0
    ? pending.slice(lastSeparator + 1)
    : trailingRowsMatching(pending, (row) => {
      if (row.pageNumber !== anchor.pageNumber || isSeparatorRow(row)) return false;
      const samePageAsPrevious = Boolean(previousAnchor) && previousAnchor!.pageNumber === anchor.pageNumber;
      // Across a page break the line above an anchor is the previous page's
      // wrapped description far more often than a lead line, so only a line
      // sharing this anchor's own baseline is claimed.
      const reach = samePageAsPrevious ? 1.25 : 0.75;
      if (!anchorCells.some((cell) => sharesAnchorBand(row, cell, rowPitch, reach))) return false;
      return !samePageAsPrevious || verticalDistance(row, anchor) < verticalDistance(row, previousAnchor!);
    });

  // Without a separator, a line carrying the previous transaction's account
  // amount completes it, so that line and everything above it stay there.
  // With no transaction above, there is nothing to complete and the line
  // belongs to the transaction it introduces.
  const claimed = candidates.filter((row) => !isSeparatorRow(row));
  if (!previousAnchor) return claimed;
  const lastAccountAmount = findLastIndex(claimed, (row) => hasMappedAccountAmount(row, columns, pageWidth));
  return lastAccountAmount >= 0 ? claimed.slice(lastAccountAmount + 1) : claimed;
}

function verticalDistance(row: PdfVisualRow, other: PdfVisualRow) {
  return Math.abs((row.y + row.height / 2) - (other.y + other.height / 2));
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) return index;
  }
  return -1;
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
