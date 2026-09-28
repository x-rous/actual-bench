import { assemblePdfTransactionBlocks } from "./blocks";
import { divideCellsAcrossColumns, rowValuesForColumn } from "./columns";
import { dateCandidates, looksLikeMoney } from "./candidates";
import { applyBlockCorrections, applyFieldCorrections, applyGuidanceCorrections, type PdfCorrection } from "./corrections";
import { inferPdfDateFormat, parsePdfDateCandidate } from "./dates";
import { reconstructPdfLayout } from "./layout";
import { interpretPdfBlocks } from "./interpret";
import {
  DEFAULT_PDF_PARSER_GUIDANCE,
  PDF_PARSER_MODEL_VERSION,
  type PdfParseNotice,
  type PdfParserGuidance,
  type PdfStatementDocument,
  type PdfStatementParseResult,
} from "./model";
import { createPdfLayoutSignature } from "./profiles";
import { applyPageRules, classifyPdfRegions, extendRegionsWithMappedColumns } from "./regions";
import { detectPdfTableSchemas } from "./schema";
import { validatePdfTransactions } from "./validate";

export type PdfParseOptions = {
  guidance?: Partial<PdfParserGuidance>;
  corrections?: PdfCorrection[];
};

export function parsePdfStatementDocumentV2(
  document: PdfStatementDocument,
  options: PdfParseOptions = {}
): PdfStatementParseResult {
  const layout = reconstructPdfLayout(document);
  const baseGuidance: PdfParserGuidance = {
    ...DEFAULT_PDF_PARSER_GUIDANCE,
    ...options.guidance,
    statementPeriod: { ...DEFAULT_PDF_PARSER_GUIDANCE.statementPeriod, ...options.guidance?.statementPeriod },
    regions: options.guidance?.regions ?? [],
    columns: options.guidance?.columns ?? [],
  };
  const corrections = options.corrections ?? [];
  const guidance = applyGuidanceCorrections(baseGuidance, corrections);
  // Detection always runs on its own so `detectedGuidance` stays the answer to
  // "what would Actual Bench do without help", which is what Reset detection
  // returns to. Guidance is layered on top of it rather than replacing it.
  // Read from the reconstructed layout, before any guidance or cell division,
  // so the same statement signs the same whoever has corrected it.
  const detectionSignature = createPdfLayoutSignature(layout.pages);
  const detectedRegions = classifyPdfRegions(layout.pages);
  const guidedRegions = guidance.regions.length ? guidance.regions : detectedRegions.regions;
  const schemas = detectPdfTableSchemas(layout.pages, guidedRegions, guidance.columns.length ? guidance : undefined);
  const detectedColumns = guidance.columns.length ? guidance.columns : schemas.active?.columns ?? [];
  // A layout describes a table, not a page count: pages the layout never saw
  // still belong to the statement when their rows line up with its columns.
  const extendedRegions = extendRegionsWithMappedColumns(layout.pages, guidedRegions, detectedColumns);
  // Applied last, so a page the rules ignore cannot be carried back in above.
  const pageRuled = applyPageRules(extendedRegions.regions, layout.pages.length, guidance.pageRules);
  const detectedPeriod = detectStatementPeriod(layout.pages);
  const statementPeriod = {
    start: guidance.statementPeriod.start ?? detectedPeriod.start,
    end: guidance.statementPeriod.end ?? detectedPeriod.end,
  };
  const samplesByRole = dateSamples(layout.pages, pageRuled.regions, detectedColumns);
  const inferredFormats = Object.fromEntries(Object.entries(samplesByRole).map(([role, samples]) => [
    role,
    guidance.dateFormat === "auto"
      ? inferPdfDateFormat([samples], statementPeriod)
      : guidance.dateFormat,
  ]));
  const inferredDateFormat = inferredFormats[guidance.transactionAnchorRole]
    ?? inferredFormats["transaction-date"]
    ?? guidance.dateFormat;
  const inferredDateFormats = [...new Set(Object.values(inferredFormats).filter((format) => format !== "auto"))];
  const displayedDateFormat = guidance.dateFormat === "auto" && inferredDateFormats.length > 1
    ? "auto"
    : inferredDateFormat;
  const symbolCurrency = currencyFromSymbols(layout.pages);
  const detectedGuidance: PdfParserGuidance = {
    ...DEFAULT_PDF_PARSER_GUIDANCE,
    accountType: "auto",
    currency: currencyFromAmountColumn(detectedColumns)
      ?? detectDocumentCurrency(layout.pages)
      ?? symbolCurrency?.currency
      ?? null,
    dateFormat: displayedDateFormat,
    statementPeriod: detectedPeriod,
    regions: detectedRegions.regions,
    columns: detectedColumns,
  };
  const effectiveGuidance: PdfParserGuidance = {
    ...detectedGuidance,
    ...guidance,
    currency: options.guidance?.currency !== undefined ? guidance.currency : detectedGuidance.currency,
    dateFormat: guidance.dateFormat === "auto" ? displayedDateFormat : guidance.dateFormat,
    statementPeriod,
    regions: pageRuled.regions,
    columns: guidance.columns.length ? guidance.columns : schemas.active?.columns ?? [],
  };
  effectiveGuidance.importDate = availableImportDate(effectiveGuidance.importDate, effectiveGuidance.columns);
  // Detection reads the page as extracted; everything after it reads the page
  // divided along the mapped columns, so one cell cannot answer for several.
  const pages = divideCellsAcrossColumns(layout.pages, effectiveGuidance.columns);
  const activeSchema = effectiveGuidance.columns.length
    ? { id: "effective", regionIds: effectiveGuidance.regions.filter((region) => region.included).map((region) => region.id), columns: effectiveGuidance.columns, score: 1, reasons: ["effective schema"] }
    : schemas.active;
  const assembled = assemblePdfTransactionBlocks(pages, effectiveGuidance.regions, activeSchema, effectiveGuidance);
  const markedBlocks = corrections.reduce((blocks, correction) => {
    if (correction.kind !== "mark-row" || blocks.some((block) => block.rowIds.includes(correction.rowId))) return blocks;
    const row = pages.find((page) => page.pageNumber === correction.pageNumber)?.rows.find((candidate) => candidate.id === correction.rowId);
    if (!row) return blocks;
    return [...blocks, {
      id: `manual-${correction.id}`,
      sectionId: "manual",
      pageNumber: row.pageNumber,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rowIds: [row.id],
      sourceIds: row.cells.flatMap((cell) => cell.tokenIds),
      excluded: false,
      manuallyCreated: true,
    }];
  }, assembled.blocks);
  const correctedBlocks = applyBlockCorrections(markedBlocks, corrections);
  const assignedRowIds = new Set(correctedBlocks.flatMap((block) => block.rowIds));
  const interpreted = interpretPdfBlocks(
    pages,
    correctedBlocks,
    activeSchema,
    effectiveGuidance,
    inferredFormats
  );
  const correctedTransactions = applyFieldCorrections(
    interpreted.transactions,
    corrections.filter((correction) => correction.kind !== "accept-transaction")
  );
  const validated = validatePdfTransactions(correctedTransactions, effectiveGuidance, {
    pages,
    regions: effectiveGuidance.regions,
    accountType: interpreted.accountType,
    balanceBehavior: interpreted.balanceBehavior,
    balanceCheckpoints: interpreted.balanceCheckpoints,
    balancePolarity: interpreted.balancePolarity,
  });
  const transactions = applyFieldCorrections(
    validated.transactions,
    corrections.filter((correction) => correction.kind === "accept-transaction")
  );
  // Only a row that prints an amount can be a transaction the parser missed.
  // Lines of text inside the table - a translated label, a column heading
  // wrapped onto its own line, a disclaimer - cannot, in any language, so they
  // stay in the diagnostics rather than asking the reader to check them.
  const possiblyMissed = assembled.unassignedRows
    .filter((row) => !assignedRowIds.has(row.id) && row.cells.some((cell) => looksLikeMoney(cell.text)))
    .sort((left, right) => left.pageNumber - right.pageNumber || left.y - right.y);
  const likelyScanned = layout.pages.length > 0 && layout.pages.every((page) => page.imageOnlyLikelihood >= 0.75);
  const imageOnlyPages = layout.pages.filter((page) => page.imageOnlyLikelihood >= 0.75);
  const metrics = {
    pages: layout.pages.length,
    transactionPages: new Set(effectiveGuidance.regions.filter((region) => region.kind === "transactions" && region.included).map((region) => region.pageNumber)).size,
    transactions: transactions.length,
    accepted: transactions.filter((transaction) => transaction.status === "accepted").length,
    review: transactions.filter((transaction) => transaction.status === "review").length,
    rejected: transactions.filter((transaction) => transaction.status === "rejected").length,
    duplicates: transactions.filter((transaction) => transaction.issueCodes.includes("POSSIBLE_DUPLICATE")).length,
    skippedRegions: effectiveGuidance.regions.filter((region) => !region.included).length,
    // Counted after corrections, not before them: a row the reader has marked
    // as a transaction now belongs to a block, and a warning that keeps
    // reporting it is a warning that cannot be acted on - the reader does the
    // one thing it asks for and it stays.
    unassignedRows: possiblyMissed.length,
    imageOnlyPages: likelyScanned ? 0 : imageOnlyPages.length,
    // Extraction owns this count; the parser never sees a page it could not read.
    unreadablePages: 0,
  };
  const notices: PdfParseNotice[] = [
    ...(likelyScanned
      ? [{ code: "NO_TEXT" as const, kind: "note" as const, message: "The PDF has no selectable text, so it cannot be read." }]
      : []),
    ...(metrics.imageOnlyPages
      ? [{
        code: "IMAGE_ONLY_PAGES" as const,
        kind: "note" as const,
        message: `${pageList(imageOnlyPages.map((page) => page.pageNumber))} ${imageOnlyPages.length === 1 ? "has" : "have"} no readable text layer, so any transactions printed there are missing.`,
        pageNumbers: imageOnlyPages.map((page) => page.pageNumber),
      }]
      : []),
    ...(possiblyMissed.length
      ? [{
        code: "UNASSIGNED_ROWS" as const,
        kind: "answer" as const,
        message: `${possiblyMissed.length} ${possiblyMissed.length === 1 ? "row" : "rows"} ${onPages(possiblyMissed.map((row) => row.pageNumber))} ${possiblyMissed.length === 1 ? "was" : "were"} not read as ${possiblyMissed.length === 1 ? "a transaction" : "transactions"}.`,
        pageNumbers: [...new Set(possiblyMissed.map((row) => row.pageNumber))],
        rows: possiblyMissed.map((row) => ({ pageNumber: row.pageNumber, rowId: row.id })),
      }]
      : []),
    ...(pageRuled.coversEveryPage
      ? [{
        code: "PAGE_RULES_NOT_APPLIED" as const,
        kind: "answer" as const,
        message: "The page rules would ignore every page of this statement, so they were not applied.",
        setting: "pageRules" as const,
      }]
      : []),
    ...(effectiveGuidance.currency
      ? []
      : [{ code: "CURRENCY_MISSING" as const, kind: "answer" as const, message: "The statement currency was not detected.", setting: "currency" as const }]),
    ...(interpreted.balancePolarity?.source === "detected-type"
      ? [{
        code: "ACCOUNT_TYPE_FROM_BALANCE" as const,
        kind: "answer" as const,
        message: "Money in and out were worked out from the balance, using the detected account type.",
        setting: "accountType" as const,
      }]
      : []),
    ...(["loan", "investment"].includes(interpreted.accountType)
      ? [{ code: "SPECIALIZED_ACCOUNT" as const, kind: "note" as const, message: "Loan and investment statements need specialized review before import." }]
      : []),
    ...(metrics.rejected
      ? [{
        code: "ROWS_BLOCKED" as const,
        kind: "note" as const,
        message: `${metrics.rejected} ${metrics.rejected === 1 ? "transaction has" : "transactions have"} unresolved required fields.`,
      }]
      : []),
  ];
  const warnings = notices.map((notice) => notice.message);
  return {
    modelVersion: PDF_PARSER_MODEL_VERSION,
    document,
    reconstructedPages: pages,
    regions: effectiveGuidance.regions,
    schemaHypotheses: schemas.hypotheses,
    activeSchema,
    detectionSignature,
    blocks: correctedBlocks,
    guidance: effectiveGuidance,
    detectedGuidance,
    accountType: interpreted.accountType,
    balanceBehavior: interpreted.balanceBehavior,
    balancePolarity: interpreted.balancePolarity,
    transactions,
    diagnostics: [...layout.diagnostics, ...detectedRegions.diagnostics, ...extendedRegions.diagnostics, ...schemas.diagnostics, ...assembled.diagnostics, ...interpreted.diagnostics, ...validated.diagnostics],
    metrics,
    likelyScanned,
    warnings,
    notices,
  };
}

/**
 * A statement that prints "Total Amount (AED)" has already named its currency.
 * That is a stronger signal than scanning the page for codes, which a foreign
 * transaction can make ambiguous.
 */
function currencyFromAmountColumn(columns: PdfParserGuidance["columns"]) {
  const headers = columns
    .filter((column) => ["amount", "debit", "credit", "balance"].includes(column.role))
    .map((column) => column.header)
    .filter((header): header is string => Boolean(header));
  const codes = [...new Set(headers.flatMap((header) =>
    [...header.matchAll(/\b(AED|AUD|BHD|CAD|CHF|CNY|DKK|EGP|EUR|GBP|HKD|INR|JPY|KWD|NOK|NZD|OMR|QAR|SAR|SEK|SGD|USD|ZAR)\b/gi)]
      .map((match) => match[1].toUpperCase())))];
  return codes.length === 1 ? codes[0] : null;
}

/** "on page 5", "on pages 2, 4 and 5": where, in words. */
function onPages(pageNumbers: number[]) {
  const unique = [...new Set(pageNumbers)];
  return `on ${pageList(unique).replace(/^Page/, "page")}`;
}

function pageList(pageNumbers: number[]) {
  if (pageNumbers.length === 1) return `Page ${pageNumbers[0]}`;
  return `Pages ${pageNumbers.slice(0, -1).join(", ")} and ${pageNumbers.at(-1)}`;
}

/**
 * The currency a statement prints as a symbol rather than a code.
 *
 * A symbol is weaker evidence than a code, and some are shared: a dollar sign
 * is as much Canadian or Australian as it is American. Rather than leave the
 * currency unknown - which asks the reader a question the page cannot answer
 * any better than this can - the common reading is taken and said out loud,
 * so it can be corrected in one place instead of confirmed in every statement.
 */
const CURRENCY_SYMBOLS: Record<string, { currency: string; ambiguous: boolean }> = {
  "$": { currency: "USD", ambiguous: true },
  "¥": { currency: "JPY", ambiguous: true },
  "£": { currency: "GBP", ambiguous: false },
  "€": { currency: "EUR", ambiguous: false },
  "₹": { currency: "INR", ambiguous: false },
};

function currencyFromSymbols(pages: PdfStatementParseResult["reconstructedPages"]) {
  const symbols = [...new Set(pages.flatMap((page) => page.rows.flatMap((row) =>
    row.text.match(/[$£€¥₹]/gu) ?? []
  )))];
  // Two symbols on one statement is a foreign-currency section, not a
  // statement currency: that stays a question for the reader.
  if (symbols.length !== 1) return null;
  const match = CURRENCY_SYMBOLS[symbols[0]];
  return match ? { symbol: symbols[0], ...match } : null;
}

function detectDocumentCurrency(pages: PdfStatementParseResult["reconstructedPages"]) {
  const codes = pages.flatMap((page) => page.rows.flatMap((row) =>
    row.text.match(/\b(?:AED|AUD|BHD|CAD|CHF|CNY|DKK|EGP|EUR|GBP|HKD|INR|JPY|KWD|NOK|NZD|OMR|QAR|SAR|SEK|SGD|USD|ZAR)\b/gi) ?? []
  )).map((code) => code.toUpperCase());
  const unique = [...new Set(codes)];
  return unique.length === 1 ? unique[0] : null;
}

function dateSamples(
  pages: PdfStatementParseResult["reconstructedPages"],
  regions: PdfStatementParseResult["regions"],
  columns: PdfParserGuidance["columns"]
) {
  const includedRowIds = new Set(regions
    .filter((region) => region.kind === "transactions" && region.included)
    .flatMap((region) => region.rowIds));
  const rows = pages.flatMap((page) => page.rows
    .filter((row) => includedRowIds.has(row.id))
    .map((row) => ({ row, pageWidth: page.width })))
    .sort((left, right) => left.row.pageNumber - right.row.pageNumber || left.row.y - right.row.y);
  const dateColumns = columns.filter((column) => ["transaction-date", "posting-date", "value-date"].includes(column.role));
  if (dateColumns.length) {
    return Object.fromEntries(dateColumns.map((column) => [
      column.role,
      rows.flatMap(({ row, pageWidth }) =>
        rowValuesForColumn(row, column, pageWidth).flatMap((cell) => dateMatches(cell.text))
      ),
    ]));
  }
  return { "transaction-date": rows.flatMap(({ row }) => row.cells.flatMap((cell) => dateMatches(cell.text))) };
}

/**
 * The statement period, read from the upper part of the first two pages, page
 * one first. Some statements print it on a second summary page rather than
 * the cover.
 */
function detectStatementPeriod(
  pages: PdfStatementParseResult["reconstructedPages"]
) {
  for (const page of pages.slice(0, 2)) {
    const period = periodOnPage(page);
    if (period) return period;
  }
  return { start: null, end: null };
}

function periodOnPage(page: PdfStatementParseResult["reconstructedPages"][number]) {
  const upper = page.rows.filter((row) => row.y <= page.height * 0.45);
  // The upper part first, where most statements print it; then the rest of
  // the page, for a cover page that prints its summary lower down.
  return periodInRows(page, upper) ?? periodInRows(page, page.rows);
}

function periodInRows(
  page: PdfStatementParseResult["reconstructedPages"][number],
  rows: PdfStatementParseResult["reconstructedPages"][number]["rows"]
) {
  const labelled = rows.filter((row) =>
    /statement\s+(?:period|cycle)|period\s+(?:covered|from)|(?:statement|period)\b.+\bfrom\b.+\bto\b|open(?:ing)?\s+date.+clos(?:ing|e)\s+date/i.test(row.text));
  const candidates = labelled
    .map((row) => {
      const own = dateMatches(row.text);
      if (own.length >= 2) return own;
      // A label on one line and its dates on the next: "Statement Period"
      // above "From 22 August 25 to 21 September 25".
      const next = page.rows.find((candidate) => candidate.y > row.y);
      return next ? dateMatches(next.text) : own;
    })
    .filter((matches) => matches.length >= 2);
  for (const matches of candidates) {
    // A month written as a word says which part is the month, as it does for
    // a statement date below; the order of numbers is what needs inferring.
    const format = matches.some((value) => /\p{L}/u.test(value))
      ? "dmy-name" as const
      : inferPdfDateFormat([matches], { start: null, end: null });
    if (format === "auto") continue;
    const parsed = matches.flatMap((value) => {
      const result = parsePdfDateCandidate(value, format, [], { start: null, end: null });
      return result.value ? [result.value] : [];
    });
    if (parsed.length < 2) continue;
    // The first two dates are the period, printed start then end. A line can
    // go on to print another date - the payment due date, say - which the
    // earliest-and-latest reading used to take as the period's end.
    const [start, end] = parsed.slice(0, 2).sort();
    return { start, end };
  }

  const ending = rows.find((row) =>
    /statement\s+(?:date|ending|end)|period\s+ending|closing\s+date/i.test(row.text)
    && dateMatches(row.text).length > 0
  );
  if (ending) {
    const value = parseMetadataDate(dateMatches(ending.text)[0]);
    if (value) return { start: null, end: value };
  }

  return null;
}

function parseMetadataDate(value: string) {
  const format = /\p{L}/u.test(value)
    ? "dmy-name" as const
    : inferPdfDateFormat([[value]], { start: null, end: null });
  if (format === "auto") return null;
  return parsePdfDateCandidate(value, format, [], { start: null, end: null }).value;
}

function dateMatches(value: string) {
  return dateCandidates(value);
}

function availableImportDate(
  requested: PdfParserGuidance["importDate"],
  columns: PdfParserGuidance["columns"]
): PdfParserGuidance["importDate"] {
  const available = new Set(columns.flatMap((column) =>
    column.role === "transaction-date" ? ["transaction" as const]
      : column.role === "posting-date" ? ["posting" as const]
        : column.role === "value-date" ? ["value" as const]
          : []
  ));
  if (available.has(requested)) return requested;
  return (["transaction", "posting", "value"] as const).find((candidate) => available.has(candidate)) ?? requested;
}
