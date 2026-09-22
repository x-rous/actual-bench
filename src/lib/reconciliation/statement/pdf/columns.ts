import { CURRENCY_CANDIDATE, dateCandidates, looksLikeDate, moneyCandidates } from "./candidates";
import type { PdfColumn, PdfColumnRole, PdfPositionedToken, PdfReconstructedPage, PdfRegion, PdfVisualCell, PdfVisualRow } from "./model";

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
      .filter((row) => includedRows.has(`${page.pageNumber}:${row.id}`) && !row.tableHeader)
      .flatMap((row) => row.cells)
      .filter((cell) => {
        if (!cellBelongsToColumn(cell, column)) return false;
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

/** The cells of one row that fall inside a mapped column on that row's page. */
export function rowValuesForColumn(row: PdfVisualRow, column: PdfColumn | undefined, pageWidth: number) {
  if (!column || !columnAppliesToPage(column, row.pageNumber)) return [];
  const bounds = columnBoundsForPage(column, pageWidth);
  return row.cells.filter((cell) => cellBelongsToColumn(cell, column)
    && horizontalOverlap(cell.x, cell.x + cell.width, bounds.xStart, bounds.xEnd) >= 0.25);
}

/**
 * A value settled in favour of one column is read by that column alone. An
 * amount cannot be money in and money out at once, however the boundary
 * between those columns happens to fall across the printed number.
 */
export function cellBelongsToColumn(cell: PdfVisualCell, column: PdfColumn) {
  return cell.columnId === undefined || cell.columnId === column.id;
}

function horizontalOverlap(startA: number, endA: number, startB: number, endB: number) {
  const overlap = Math.max(0, Math.min(endA, endB) - Math.max(startA, startB));
  return overlap / Math.max(1, Math.min(endA - startA, endB - startB));
}

/**
 * Divide cells that more than one mapped column claims.
 *
 * Extraction decides where a cell ends from the gap between glyphs, so a
 * statement that prints "17 Jun 19  16 Jun 19  ATM WITHDRAWAL" tightly gives
 * one cell for three columns. Every column that overlapped it then took the
 * whole string, which is why dates turned up inside descriptions.
 *
 * Only ambiguous cells are touched: a cell that one column claims is left
 * exactly as it was. Each of its tokens goes to the claiming column it sits
 * in, or nearest to, so the text is divided rather than duplicated or lost.
 */
export function divideCellsAcrossColumns(
  pages: PdfReconstructedPage[],
  columns: PdfColumn[]
): PdfReconstructedPage[] {
  if (columns.length < 2) return pages;
  return pages.map((page) => {
    const claims = columns
      .filter((column) => columnAppliesToPage(column, page.pageNumber))
      .map((column) => ({ column, ...columnBoundsForPage(column, page.width) }));
    if (claims.length < 2) return page;
    const tokensById = new Map(page.tokens.map((token) => [token.id, token]));

    let divided = false;
    const rows = page.rows.map((row) => {
      const cells = row.cells.flatMap((cell) => {
        const claiming = claims.filter((claim) =>
          horizontalOverlap(cell.x, cell.x + cell.width, claim.xStart, claim.xEnd) >= 0.25);
        if (claiming.length < 2) return [cell];
        const widest = claiming.reduce((best, claim) =>
          overlapWidth(cell, claim) > overlapWidth(cell, best) ? claim : best);
        const cellTokens = cell.tokenIds
          .flatMap((tokenId) => {
            const token = tokensById.get(tokenId);
            return token ? [token] : [];
          })
          .sort((left, right) => left.x - right.x);
        const groups = splitTokensByColumn(cellTokens, claiming);
        // Nothing to divide - a single printed number, say - so the column
        // that covers most of it takes it, and the others do not see it.
        if (groups.length < 2) {
          if (cell.columnId === widest.column.id) return [cell];
          divided = true;
          return [{ ...cell, columnId: widest.column.id }];
        }
        divided = true;
        return groups.map((tokens, index) => cellFromTokens(cell, tokens, ordered(claiming)[index]?.column.id));
      });
      if (cells.length === row.cells.length && cells.every((cell, index) => cell === row.cells[index])) return row;
      // Cell ids stay positional so that anything deriving a row from a cell
      // keeps working; token ids, which source highlighting uses, never move.
      const renumbered = cells.map((cell, index) => ({ ...cell, id: `${row.id}-c${index}` }));
      return { ...row, cells: renumbered, cellIds: renumbered.map((cell) => cell.id) };
    });
    return divided ? { ...page, rows } : page;
  });
}

/**
 * Divide one cell's words between the columns that claim it.
 *
 * Geometry alone is not enough: in "17 Jun 19  16 Jun 19  ATM WITHDRAWAL" the
 * gap inside a date is the same width as the gap before the description, so a
 * cut placed by position alone leaves half a date in the description. A date
 * column therefore takes the date it is for, and the remaining columns are
 * divided at the word gap nearest their boundary.
 */
function splitTokensByColumn(
  tokens: PdfPositionedToken[],
  claiming: { column: PdfColumn; xStart: number; xEnd: number }[]
): PdfPositionedToken[][] {
  if (tokens.length < 2) return [tokens];
  const ordered = [...claiming].sort((left, right) => left.xStart - right.xStart);
  const segments: PdfPositionedToken[][] = [];
  let remaining = tokens;

  for (let index = 0; index < ordered.length && remaining.length; index += 1) {
    if (index === ordered.length - 1) {
      segments.push(remaining);
      remaining = [];
      break;
    }
    let take = 0;
    if (DATE_ROLES.includes(ordered[index].column.role)) {
      take = leadingDateTokenCount(remaining);
      // Where the next column is not another date, a second printed date
      // belongs with the first rather than at the head of a description.
      if (take && !DATE_ROLES.includes(ordered[index + 1].column.role)) {
        take += leadingDateTokenCount(remaining.slice(take));
      }
    }
    if (!take) {
      const boundary = (ordered[index].xEnd + ordered[index + 1].xStart) / 2;
      take = wordGapCut(remaining, boundary);
    }
    if (take <= 0 || take >= remaining.length) continue;
    segments.push(remaining.slice(0, take));
    remaining = remaining.slice(take);
  }
  if (remaining.length) segments.push(remaining);
  return segments.filter((segment) => segment.length > 0);
}

const DATE_ROLES: PdfColumnRole[] = ["transaction-date", "posting-date", "value-date"];

/** How many leading words form one printed date, or 0 when they do not. */
function leadingDateTokenCount(tokens: PdfPositionedToken[]) {
  const compact = (value: string) => value.replace(/\s+/g, "");
  for (let count = Math.min(4, tokens.length); count >= 1; count -= 1) {
    const text = tokens.slice(0, count).map((token) => token.text).join(" ");
    const [candidate] = dateCandidates(text);
    if (candidate && compact(candidate) === compact(text)) return count;
  }
  return 0;
}

/** The word gap closest to a column boundary, preferring the widest one near it. */
function wordGapCut(tokens: PdfPositionedToken[], boundary: number) {
  const heights = tokens.map((token) => token.height).sort((left, right) => left - right);
  const reach = Math.max(6, (heights[Math.floor(heights.length / 2)] ?? 10) * 2);
  const gaps = tokens.slice(1).map((token, index) => ({
    index: index + 1,
    position: ((tokens[index].x + tokens[index].width) + token.x) / 2,
    size: token.x - (tokens[index].x + tokens[index].width),
  })).filter((gap) => Math.abs(gap.position - boundary) <= reach);
  if (!gaps.length) return 0;
  return gaps.reduce((best, gap) => gap.size > best.size ? gap : best).index;
}

function overlapWidth(cell: PdfVisualCell, claim: { xStart: number; xEnd: number }) {
  return Math.max(0, Math.min(cell.x + cell.width, claim.xEnd) - Math.max(cell.x, claim.xStart));
}

function ordered(claiming: { column: PdfColumn; xStart: number; xEnd: number }[]) {
  return [...claiming].sort((left, right) => left.xStart - right.xStart);
}

function cellFromTokens(cell: PdfVisualCell, tokens: PdfPositionedToken[], columnId?: string): PdfVisualCell {
  const x = Math.min(...tokens.map((token) => token.x));
  const y = Math.min(...tokens.map((token) => token.y));
  const endX = Math.max(...tokens.map((token) => token.x + token.width));
  const endY = Math.max(...tokens.map((token) => token.y + token.height));
  return {
    id: cell.id,
    pageNumber: cell.pageNumber,
    x,
    y,
    width: endX - x,
    height: endY - y,
    rawText: tokens.map((token) => token.rawText).join(" "),
    text: tokens.map((token) => token.text).join(" "),
    tokenIds: tokens.map((token) => token.id),
    ...(columnId === undefined ? {} : { columnId }),
  };
}
