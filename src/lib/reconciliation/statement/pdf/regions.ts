import { diagnostic } from "./diagnostics";
import { dateCandidates, looksLikeDate, moneyCandidates } from "./candidates";
import type {
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
  let previousPageHadTransactions = false;
  pages.forEach((page) => {
    const proposed = proposePageRegions(page, previousPageHadTransactions);
    regions.push(...proposed);
    previousPageHadTransactions = proposed.some((region) => region.kind === "transactions" && region.included);
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
  previousPageHadTransactions: boolean
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
  if (anchors.length === 0 || (!hasTransactionHeader && !previousPageHadTransactions && anchors.length < 3)) {
    const kind = page.imageOnlyLikelihood >= 0.75 ? "other" : classifyText(usable.map((row) => row.text).join(" "));
    return [regionFromRows(page, usable, kind, false, kind === "other" ? 0.4 : 0.75)];
  }

  const minY = transactionHeader?.y
    ?? Math.max(0, Math.min(...anchors.map((row) => row.y)) - medianRowHeight(usable) * 3);
  const lastAnchorEnd = Math.max(...anchors.map((row) => row.y + row.height));
  const nextSection = usable.find((row) => row.y > lastAnchorEnd && isNonTransactionSection(row.text));
  const maxY = nextSection
    ? Math.max(minY, nextSection.y - 0.01)
    : page.height;
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

function isTransactionHeader(row: PdfReconstructedPage["rows"][number]) {
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

function medianRowHeight(rows: PdfReconstructedPage["rows"]) {
  const values = rows.map((row) => row.height).sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 12;
}
