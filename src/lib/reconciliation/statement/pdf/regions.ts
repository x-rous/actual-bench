import { diagnostic } from "./diagnostics";
import { dateCandidates, looksLikeDate, looksLikeMoney, moneyCandidates } from "./candidates";
import { rowValuesForColumn } from "./columns";
import type {
  PdfColumn,
  PdfDiagnosticEvent,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfRegionKind,
} from "./model";

export type PdfRegionResult = { regions: PdfRegion[]; diagnostics: PdfDiagnosticEvent[] };

const REGION_HINTS: { kind: Exclude<PdfRegionKind, "transactions" | "other">; pattern: RegExp }[] = [
  { kind: "summary", pattern: /account summary|statement summary|opening balance|closing balance|totals?\b/i },
  { kind: "rewards", pattern: /rewards?|points?|cashback summary/i },
  { kind: "installments", pattern: /installments?|payment plan|amortization schedule/i },
  { kind: "fees", pattern: /fees? summary|interest charges?|finance charges?/i },
];

export function classifyPdfRegions(
  pages: PdfReconstructedPage[],
  guidance?: Pick<PdfParserGuidance, "regions">
): PdfRegionResult {
  if (guidance?.regions.length) {
    return {
      regions: guidance.regions,
      diagnostics: [diagnostic({ stage: "region", code: "FILE_GUIDANCE_APPLIED", metrics: { regions: guidance.regions.length } })],
    };
  }
  const regions: PdfRegion[] = [];
  // Once a statement has shown its transaction table, later pages continue it
  // even when a summary page interrupts them, so the evidence is kept for the
  // whole document rather than only for the page before.
  let documentHasTransactions = false;
  pages.forEach((page) => {
    const proposed = proposePageRegions(page, documentHasTransactions);
    regions.push(...proposed);
    documentHasTransactions = documentHasTransactions
      || proposed.some((region) => region.kind === "transactions" && region.included);
  });
  return {
    regions,
    diagnostics: regions.map((region) => diagnostic({
      stage: "region",
      code: "REGION_PROPOSED",
      pageNumber: region.pageNumber,
      sourceIds: region.rowIds,
      metrics: { kind: region.kind, included: region.included, confidencePermille: Math.round(region.confidence * 1000) },
    })),
  };
}

function proposePageRegions(
  page: PdfReconstructedPage,
  documentHasTransactions: boolean
): PdfRegion[] {
  const usable = page.rows.filter((row) => !row.repeatedHeaderFooter);
  const transactionHeader = page.rows.find(isTransactionHeader);
  const hasTransactionHeader = Boolean(transactionHeader);
  const anchorCandidates = usable.filter((row, index) =>
    hasLikelyDateAnchor(row, hasTransactionHeader)
    && (!transactionHeader || row.y > transactionHeader.y)
    && (hasTransactionHeader || usable.slice(index, index + 7).some((candidate) => moneyCandidates(candidate.text).length > 0))
  );
  const anchors = hasTransactionHeader
    ? anchorCandidates
    : anchorsInDominantDateColumn(anchorCandidates);
  // The first transaction area has to prove itself. Once the statement has
  // shown one, a later page continues it on a single dated row, which is what
  // a wrapped last transaction looks like at the top of the next page.
  const requiredAnchors = documentHasTransactions ? 1 : 3;
  if (anchors.length === 0 || (!hasTransactionHeader && anchors.length < requiredAnchors)) {
    const kind = page.imageOnlyLikelihood >= 0.75 ? "other" : classifyText(usable.map((row) => row.text).join(" "));
    return [regionFromRows(page, usable, kind, false, kind === "other" ? 0.4 : 0.75)];
  }

  const minY = transactionHeader?.y
    ?? Math.max(0, Math.min(...anchors.map((row) => row.y)) - medianRowHeight(usable) * 3);
  const lastAnchorEnd = Math.max(...anchors.map((row) => row.y + row.height));
  const nextSection = usable.find((row) => row.y > lastAnchorEnd && isNonTransactionSection(row.text));
  // Page furniture sits well below the table. Wrapped description lines follow
  // their transaction within the table's own line pitch, so the first row
  // separated by a clear gap ends the area.
  const tailBreak = firstRowBelowGap(usable, lastAnchorEnd, medianRowPitch(usable));
  const maxY = Math.min(
    nextSection ? Math.max(minY, nextSection.y - 0.01) : page.height,
    tailBreak ? Math.max(minY, tailBreak.y - 0.01) : page.height
  );
  const before = usable.filter((row) => row.y + row.height < minY);
  const transactionRows = usable.filter((row) => row.y + row.height >= minY && row.y <= maxY);
  const after = usable.filter((row) => row.y > maxY);
  const output: PdfRegion[] = [];
  if (before.length) output.push(regionFromRows(page, before, classifyText(before.map((row) => row.text).join(" ")), false, 0.65));
  output.push(regionFromRows(page, transactionRows, "transactions", true, Math.min(0.98, 0.65 + anchors.length * 0.04)));
  if (after.length) output.push(regionFromRows(page, after, classifyText(after.map((row) => row.text).join(" ")), false, 0.65));
  return output;
}

function anchorsInDominantDateColumn(
  rows: PdfReconstructedPage["rows"]
) {
  const entries = rows.flatMap((row) => {
    const cell = row.cells.find((candidate) => dateCandidates(candidate.text).some((value) =>
      /\p{L}/u.test(value) || /[/\-]/.test(value) || /^\d{4}[.]/.test(value)
    ));
    return cell ? [{ row, x: cell.x }] : [];
  });
  const groups: typeof entries[] = [];
  entries.forEach((entry) => {
    const group = groups.find((candidate) =>
      Math.abs(candidate.reduce((sum, value) => sum + value.x, 0) / candidate.length - entry.x) <= 18
    );
    if (group) group.push(entry);
    else groups.push([entry]);
  });
  const dominant = groups.sort((left, right) => right.length - left.length)[0] ?? [];
  return dominant.map((entry) => entry.row);
}

function hasLikelyDateAnchor(
  row: PdfReconstructedPage["rows"][number],
  hasTransactionHeader: boolean
) {
  if (hasTransactionHeader) return looksLikeDate(row.text);
  return row.cells.some((cell) => dateCandidates(cell.text).some((candidate) =>
    /\p{L}/u.test(candidate) || /[/\-]/.test(candidate) || /^\d{4}[.]/.test(candidate)
  ));
}

export function isTransactionHeader(row: PdfReconstructedPage["rows"][number]) {
  const isCompactHeader = row.cells.length >= 2 || row.text.length <= 90;
  return isCompactHeader
    && /(?:transaction|trans\.?|posting|post(?:ed)?|processed|booking|entry|registration|value)?\s*date|date\s+of\s+transaction/i.test(row.text)
    && /amount|debit|credit|withdrawal|deposit|money out|money in/i.test(row.text)
    && /description|details|narration|narrative|merchant|particulars|memo|remarks|activity|payment\s+details/i.test(row.text);
}

function isNonTransactionSection(text: string) {
  return /account summary|statement summary|statement totals?|total (?:debits?|credits?|withdrawals?|deposits?)|closing balance|credit limit|available credit|minimum payment|payment due|rewards?|points?|advertisement|important information|fees? summary|interest charges?/i.test(text);
}

function classifyText(text: string): PdfRegionKind {
  return REGION_HINTS.find((hint) => hint.pattern.test(text))?.kind ?? "other";
}

function regionFromRows(
  page: PdfReconstructedPage,
  rows: PdfReconstructedPage["rows"],
  kind: PdfRegionKind,
  included: boolean,
  confidence: number
): PdfRegion {
  const x = rows.length ? Math.min(...rows.map((row) => row.x)) : 0;
  const y = rows.length ? Math.min(...rows.map((row) => row.y)) : 0;
  const endX = rows.length ? Math.max(...rows.map((row) => row.x + row.width)) : page.width;
  const endY = rows.length ? Math.max(...rows.map((row) => row.y + row.height)) : page.height;
  return {
    id: `p${page.pageNumber}-${kind}-${Math.round(y)}`,
    pageNumber: page.pageNumber,
    x,
    y,
    width: endX - x,
    height: endY - y,
    kind,
    included,
    confidence,
    rowIds: rows.map((row) => row.id),
    reasons: kind === "transactions" ? ["dated rows with monetary values"] : [`classified as ${kind}`],
  };
}

function firstRowBelowGap(
  rows: PdfReconstructedPage["rows"],
  fromY: number,
  rowPitch: number
) {
  const below = rows
    .filter((row) => row.y > fromY)
    .sort((left, right) => left.y - right.y);
  let previousEnd = fromY;
  for (const row of below) {
    if (row.y - previousEnd > rowPitch * 2) return row;
    previousEnd = row.y + row.height;
  }
  return null;
}

function medianRowPitch(rows: PdfReconstructedPage["rows"]) {
  const centers = rows.map((row) => row.y).sort((left, right) => left - right);
  const gaps = centers
    .slice(1)
    .map((value, index) => value - centers[index])
    .filter((gap) => gap > 1)
    .sort((left, right) => left - right);
  return gaps[Math.floor(gaps.length / 2)] ?? medianRowHeight(rows) * 2;
}

function medianRowHeight(rows: PdfReconstructedPage["rows"]) {
  const values = rows.map((row) => row.height).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 12;
}

/**
 * Include pages whose rows line up with the mapped date and amount columns.
 *
 * A saved layout describes a table, not a page count: next month's statement
 * can carry that table onto pages the layout has never seen. Pages that
 * already have a transaction area are left alone, including one the user
 * deliberately excluded.
 */
export function extendRegionsWithMappedColumns(
  pages: PdfReconstructedPage[],
  regions: PdfRegion[],
  columns: PdfColumn[]
): PdfRegionResult {
  const dateColumn = columns.find((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role));
  const amountColumns = columns.filter((column) => ["amount", "debit", "credit"].includes(column.role));
  if (!dateColumn || !amountColumns.length) return { regions, diagnostics: [] };

  const pagesWithTransactionArea = new Set(regions
    .filter((region) => region.kind === "transactions")
    .map((region) => region.pageNumber));
  const added: PdfRegion[] = [];
  pages.forEach((page) => {
    if (pagesWithTransactionArea.has(page.pageNumber)) return;
    const aligned = page.rows.filter((row) => !row.repeatedHeaderFooter
      && rowValuesForColumn(row, dateColumn, page.width).some((cell) => looksLikeDate(cell.text))
      && amountColumns.some((column) => rowValuesForColumn(row, column, page.width).some((cell) => looksLikeMoney(cell.text))));
    if (aligned.length < 2) return;
    const firstY = Math.min(...aligned.map((row) => row.y));
    const lastY = Math.max(...aligned.map((row) => row.y + row.height));
    const rows = page.rows.filter((row) => !row.repeatedHeaderFooter
      && row.y + row.height >= firstY
      && row.y <= lastY);
    added.push({
      ...regionFromRows(page, rows, "transactions", true, 0.8),
      id: `p${page.pageNumber}-transactions-mapped`,
      reasons: ["rows align with the mapped columns"],
    });
  });

  if (!added.length) return { regions, diagnostics: [] };
  const merged = [...regions.filter((region) => !added.some((entry) => entry.pageNumber === region.pageNumber && !region.included && region.kind === "other")), ...added]
    .sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
  return {
    regions: merged,
    diagnostics: added.map((region) => diagnostic({
      stage: "region",
      code: "REGION_FROM_MAPPED_COLUMNS",
      pageNumber: region.pageNumber,
      metrics: { rows: region.rowIds.length },
    })),
  };
}
