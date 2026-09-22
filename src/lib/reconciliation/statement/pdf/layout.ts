import { diagnostic } from "./diagnostics";
import type {
  PdfDiagnosticEvent,
  PdfPositionedToken,
  PdfReconstructedPage,
  PdfStatementDocument,
  PdfStatementPage,
  PdfVisualCell,
  PdfVisualRow,
} from "./model";
import { normalizePdfText } from "./text";
import { looksLikeDate, moneyCandidates } from "./candidates";
import { isTransactionHeader } from "./regions";
import { rowLooksLikeDate, rowLooksLikeMoney } from "./rows";

type TokenDraft = PdfPositionedToken & { sourceOrder: number };

export type PdfLayoutResult = {
  pages: PdfReconstructedPage[];
  diagnostics: PdfDiagnosticEvent[];
};

export function reconstructPdfLayout(document: PdfStatementDocument): PdfLayoutResult {
  const pages = document.pages.map(reconstructPage);
  pages.forEach((page) => page.rows.forEach((row) => {
    if (isTransactionHeader(row)) row.tableHeader = true;
  }));
  markRepeatedHeadersAndFooters(pages);
  return {
    pages,
    diagnostics: pages.map((page) => diagnostic({
      stage: "layout",
      code: "PAGE_RECONSTRUCTED",
      pageNumber: page.pageNumber,
      metrics: {
        tokens: page.tokens.length,
        rows: page.rows.length,
        coveragePermille: Math.round(page.coverage * 1000),
        imageLikelihoodPermille: Math.round(page.imageOnlyLikelihood * 1000),
      },
    })),
  };
}

function reconstructPage(page: PdfStatementPage): PdfReconstructedPage {
  const width = positive(page.width) ?? inferredPageWidth(page);
  const height = positive(page.height) ?? inferredPageHeight(page);
  const rotation = normalizeRotation(page.rotation ?? 0);
  const tokens = buildTokens(page, width, height, rotation);
  const rows = clusterRows(tokens, page.pageNumber);
  const inkArea = tokens.reduce((sum, token) => sum + token.width * token.height, 0);
  const coverage = Math.min(1, inkArea / Math.max(1, width * height));
  const visibleCharacterCount = tokens.reduce((sum, token) => sum + token.text.length, 0);
  const imageOnlyLikelihood = visibleCharacterCount === 0
    ? 1
    : visibleCharacterCount < 20 || coverage < 0.00015
      ? 0.75
      : 0;
  return { pageNumber: page.pageNumber, width, height, rotation, coverage, imageOnlyLikelihood, tokens, rows };
}

function buildTokens(
  page: PdfStatementPage,
  pageWidth: number,
  pageHeight: number,
  rotation: number
): PdfPositionedToken[] {
  const drafts: TokenDraft[] = [];
  page.items.forEach((item, itemIndex) => {
    const normalized = normalizePdfText(item.str);
    if (!normalized) return;
    const rawX = finite(item.transform[4]);
    const rawY = finite(item.transform[5]);
    const fontHeight = positive(item.height)
      ?? Math.max(Math.abs(finite(item.transform[0])), Math.abs(finite(item.transform[3])), 8);
    const itemWidth = positive(item.width) ?? Math.max(normalized.length * fontHeight * 0.48, 1);
    const box = positionedBox(
      rawX,
      rawY,
      itemWidth,
      fontHeight,
      pageWidth,
      pageHeight,
      rotation,
      page.viewportTransform
    );
    const isRtl = item.dir === "rtl" || hasStrongRtl(normalized);
    const parts = splitItem(normalized, item.str, itemWidth, isRtl);
    parts.forEach((part, partIndex) => {
      drafts.push({
        id: item.id ? `${item.id}-w${partIndex}` : `p${page.pageNumber}-i${itemIndex}-w${partIndex}`,
        pageNumber: page.pageNumber,
        rawText: part.raw,
        text: part.text,
        x: box.x + part.offset * (box.width / Math.max(itemWidth, 1)),
        y: box.y,
        width: part.width * (box.width / Math.max(itemWidth, 1)),
        height: box.height,
        direction: isRtl ? "rtl" : "ltr",
        fontHeight,
        sourceOrder: itemIndex,
      });
    });
  });

  return mergeCharacterFragments(drafts)
    .sort((left, right) => left.y - right.y || left.x - right.x || left.sourceOrder - right.sourceOrder)
    .map(({ sourceOrder, ...token }) => {
      void sourceOrder;
      return token;
    });
}

function splitItem(text: string, rawText: string, width: number, rtl: boolean) {
  // PDF.js already exposes the logical reading order inside one RTL text item.
  // Mirroring its words into separate positioned tokens and then sorting them
  // by x reverses that logical order during row reconstruction.
  if (rtl) return [{ text, raw: rawText, offset: 0, width }];
  const matches = [...text.matchAll(/\S+/g)];
  if (matches.length <= 1) return [{ text, raw: rawText, offset: 0, width }];
  const length = Math.max(text.length, 1);
  return matches.map((match) => {
    const start = match.index ?? 0;
    const partWidth = Math.max(1, width * (match[0].length / length));
    const logicalOffset = width * (start / length);
    return {
      text: match[0],
      raw: match[0],
      offset: rtl ? Math.max(0, width - logicalOffset - partWidth) : logicalOffset,
      width: partWidth,
    };
  });
}

function mergeCharacterFragments(tokens: TokenDraft[]): TokenDraft[] {
  const sorted = [...tokens].sort((a, b) => a.y - b.y || a.x - b.x || a.sourceOrder - b.sourceOrder);
  const merged: TokenDraft[] = [];
  for (const token of sorted) {
    const previous = merged.at(-1);
    const tolerance = Math.max(1.5, Math.min(token.fontHeight, previous?.fontHeight ?? token.fontHeight) * 0.28);
    const gap = previous ? token.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY;
    const sameBaseline = previous
      && previous.pageNumber === token.pageNumber
      && Math.abs((previous.y + previous.height) - (token.y + token.height)) <= tolerance;
    const fragmentsWord = sameBaseline
      && gap >= -tolerance
      && gap <= Math.max(2.5, token.fontHeight * 0.18)
      && (previous.text.length === 1 || token.text.length === 1)
      && /[\p{L}\p{N}]/u.test(previous.text + token.text);
    if (!previous || !fragmentsWord) {
      merged.push({ ...token });
      continue;
    }
    previous.rawText += token.rawText;
    previous.text = normalizePdfText(previous.text + token.text);
    previous.width = Math.max(previous.width, token.x + token.width - previous.x);
    previous.height = Math.max(previous.height, token.height);
    previous.id = `${previous.id}+${token.id}`;
  }
  return merged;
}

function clusterRows(tokens: PdfPositionedToken[], pageNumber: number): PdfVisualRow[] {
  const fontHeights = tokens.map((token) => token.fontHeight).sort((a, b) => a - b);
  const medianHeight = median(fontHeights) || 10;
  const baselineTolerance = Math.max(1.5, medianHeight * 0.34);
  // Tokens arrive in reading order, so the matching baseline is one of the
  // last groups. Scanning from the end with a running centre keeps row
  // clustering linear instead of quadratic on long statements.
  const groups: { tokens: PdfPositionedToken[]; centerSum: number }[] = [];
  for (const token of [...tokens].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const center = token.y + token.height / 2;
    let group: { tokens: PdfPositionedToken[]; centerSum: number } | undefined;
    for (let index = groups.length - 1; index >= 0; index -= 1) {
      const candidate = groups[index];
      const candidateCenter = candidate.centerSum / candidate.tokens.length;
      if (Math.abs(center - candidateCenter) <= baselineTolerance) {
        group = candidate;
        break;
      }
      if (candidateCenter < center - baselineTolerance * 3) break;
    }
    if (group) {
      group.tokens.push(token);
      group.centerSum += center;
    } else {
      groups.push({ tokens: [token], centerSum: center });
    }
  }

  return groups.map(({ tokens: group }, rowIndex) => {
    const ordered = [...group].sort((a, b) => a.x - b.x);
    const cells = clusterCells(ordered, pageNumber, rowIndex, medianHeight);
    const x = Math.min(...ordered.map((token) => token.x));
    const y = Math.min(...ordered.map((token) => token.y));
    const endX = Math.max(...ordered.map((token) => token.x + token.width));
    const endY = Math.max(...ordered.map((token) => token.y + token.height));
    return {
      id: `p${pageNumber}-r${rowIndex}`,
      pageNumber,
      x,
      y,
      width: endX - x,
      height: endY - y,
      rawText: cells.map((cell) => cell.rawText).join(" "),
      text: cells.map((cell) => cell.text).join(" "),
      cellIds: cells.map((cell) => cell.id),
      cells,
      repeatedHeaderFooter: false,
    };
  });
}

function clusterCells(
  tokens: PdfPositionedToken[],
  pageNumber: number,
  rowIndex: number,
  medianHeight: number
): PdfVisualCell[] {
  const cells: PdfPositionedToken[][] = [];
  for (const token of tokens) {
    const previous = cells.at(-1)?.at(-1);
    const gap = previous ? token.x - (previous.x + previous.width) : Number.POSITIVE_INFINITY;
    if (!previous || gap > Math.max(8, medianHeight * 0.9)) cells.push([token]);
    else cells.at(-1)!.push(token);
  }
  return cells.map((cellTokens, cellIndex) => {
    const x = Math.min(...cellTokens.map((token) => token.x));
    const y = Math.min(...cellTokens.map((token) => token.y));
    const endX = Math.max(...cellTokens.map((token) => token.x + token.width));
    const endY = Math.max(...cellTokens.map((token) => token.y + token.height));
    return {
      id: `p${pageNumber}-r${rowIndex}-c${cellIndex}`,
      pageNumber,
      x,
      y,
      width: endX - x,
      height: endY - y,
      rawText: cellTokens.map((token) => token.rawText).join(" "),
      text: cellTokens.map((token) => token.text).join(" "),
      tokenIds: cellTokens.map((token) => token.id),
    };
  });
}

function markRepeatedHeadersAndFooters(pages: PdfReconstructedPage[]) {
  if (pages.length < 2) return;
  const occurrences = new Map<string, PdfVisualRow[]>();
  pages.forEach((page) => {
    const ordered = [...page.rows].sort((left, right) => left.y - right.y);
    const pitch = medianRowPitch(ordered);
    ordered.forEach((row, rowIndex) => {
      // A line printed directly under a dated transaction row is that
      // transaction's wrapped text, not page furniture, however often the
      // same words happen to repeat.
      const above = ordered[rowIndex - 1];
      const continuesTransaction = Boolean(above)
        && row.y - (above.y + above.height) <= pitch * 1.2
        && looksLikeDate(above.text)
        && moneyCandidates(above.text).length > 0;
      if (continuesTransaction) return;
      const edge = row.y <= page.height * 0.14 || row.y + row.height >= page.height * 0.86;
      // Furniture repeats the same words, with at most a changing number such
      // as a page or statement number. Matching on letter shape instead also
      // caught unrelated wrapped description lines - every two-word line has
      // the same shape - and silently deleted statement text.
      // Furniture also repeats at the same height on every page, while a
      // wrapped description lands wherever its transaction happens to fall.
      const band = Math.round(row.y / Math.max(1, page.height) * 50);
      const key = `${normalizePdfText(row.text).replace(/\d+/g, "#")}@${band}`;
      // A row that carries both a date and a money-shaped value is transaction
      // data even when a page starts or ends with one, and is never discarded
      // as furniture. A bare number is not money: "Page 3 of 6" must stay
      // eligible, or the footer ends up inside the transaction area.
      // The table header repeats on every page by design. Removing it as
      // furniture would take the statement's own column names away from
      // schema detection, which is where they are most useful.
      if (!edge || key.length < 3 || row.tableHeader || (rowLooksLikeDate(row) && rowLooksLikeMoney(row))) return;
      const list = occurrences.get(key) ?? [];
      list.push(row);
      occurrences.set(key, list);
    });
  });

  // Furniture repeats on most pages. A line that happens to appear on two
  // pages of a longer statement - the same summary label, the same wrapped
  // city - is content, and removing it would delete statement text.
  const requiredPages = Math.max(2, Math.ceil(pages.length * 0.6));
  occurrences.forEach((rows) => {
    if (new Set(rows.map((row) => row.pageNumber)).size < requiredPages) return;
    rows.forEach((row) => { row.repeatedHeaderFooter = true; });
  });
}

function medianRowPitch(rows: PdfVisualRow[]) {
  const gaps = rows
    .slice(1)
    .map((row, index) => row.y - rows[index].y)
    .filter((gap) => gap > 1)
    .sort((left, right) => left - right);
  return median(gaps) || rows[0]?.height || 12;
}

function positionedBox(
  x: number,
  y: number,
  width: number,
  height: number,
  pageWidth: number,
  pageHeight: number,
  rotation: number,
  viewportTransform: number[] | undefined
) {
  if (viewportTransform?.length === 6) {
    const points = [
      transformPoint(x, y, viewportTransform),
      transformPoint(x + width, y, viewportTransform),
      transformPoint(x, y + height, viewportTransform),
      transformPoint(x + width, y + height, viewportTransform),
    ];
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }
  const point = rotatePoint(x, y, pageWidth, pageHeight, rotation);
  return { x: point.x, y: pageHeight - point.y - height, width, height };
}

function transformPoint(x: number, y: number, matrix: number[]) {
  return {
    x: matrix[0] * x + matrix[2] * y + matrix[4],
    y: matrix[1] * x + matrix[3] * y + matrix[5],
  };
}

function rotatePoint(x: number, y: number, width: number, height: number, rotation: number) {
  if (rotation === 90) return { x: y, y: width - x };
  if (rotation === 180) return { x: width - x, y: height - y };
  if (rotation === 270) return { x: height - y, y: x };
  return { x, y };
}

function inferredPageWidth(page: PdfStatementPage) {
  return Math.max(612, ...page.items.map((item) => finite(item.transform[4]) + (positive(item.width) ?? 0)));
}

function inferredPageHeight(page: PdfStatementPage) {
  return Math.max(792, ...page.items.map((item) => finite(item.transform[5]) + (positive(item.height) ?? 12)));
}

function normalizeRotation(rotation: number) {
  const normalized = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

function hasStrongRtl(value: string) {
  return /[\u0590-\u08ff]/.test(value);
}

function median(values: number[]) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function positive(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
