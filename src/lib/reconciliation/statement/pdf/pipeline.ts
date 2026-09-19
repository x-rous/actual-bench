import { assemblePdfTransactionBlocks, rowValuesForColumn } from "./blocks";
import { dateCandidates } from "./candidates";
import { applyBlockCorrections, applyFieldCorrections, applyGuidanceCorrections, type PdfCorrection } from "./corrections";
import { inferPdfDateFormat, parsePdfDateCandidate } from "./dates";
import { reconstructPdfLayout } from "./layout";
import { interpretPdfBlocks } from "./interpret";
import {
  DEFAULT_PDF_PARSER_GUIDANCE,
  PDF_PARSER_MODEL_VERSION,
  type PdfParserGuidance,
  type PdfStatementDocument,
  type PdfStatementParseResult,
} from "./model";
import { classifyPdfRegions } from "./regions";
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
  const detectedRegions = classifyPdfRegions(layout.pages, guidance.regions.length ? guidance : undefined);
  const schemas = detectPdfTableSchemas(layout.pages, detectedRegions.regions, guidance.columns.length ? guidance : undefined);
  const detectedColumns = guidance.columns.length ? guidance.columns : schemas.active?.columns ?? [];
  const detectedPeriod = detectStatementPeriod(layout.pages);
  const statementPeriod = {
    start: guidance.statementPeriod.start ?? detectedPeriod.start,
    end: guidance.statementPeriod.end ?? detectedPeriod.end,
  };
  const samplesByRole = dateSamples(layout.pages, detectedRegions.regions, detectedColumns);
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
  const detectedGuidance: PdfParserGuidance = {
    ...DEFAULT_PDF_PARSER_GUIDANCE,
    accountType: "auto",
    currency: detectDocumentCurrency(layout.pages),
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
    regions: guidance.regions.length ? guidance.regions : detectedRegions.regions,
    columns: guidance.columns.length ? guidance.columns : schemas.active?.columns ?? [],
  };
  effectiveGuidance.importDate = availableImportDate(effectiveGuidance.importDate, effectiveGuidance.columns);
  const activeSchema = effectiveGuidance.columns.length
    ? { id: "effective", regionIds: effectiveGuidance.regions.filter((region) => region.included).map((region) => region.id), columns: effectiveGuidance.columns, score: 1, reasons: ["effective schema"] }
    : schemas.active;
  const assembled = assemblePdfTransactionBlocks(layout.pages, effectiveGuidance.regions, activeSchema, effectiveGuidance);
  const markedBlocks = corrections.reduce((blocks, correction) => {
    if (correction.kind !== "mark-row" || blocks.some((block) => block.rowIds.includes(correction.rowId))) return blocks;
    const row = layout.pages.find((page) => page.pageNumber === correction.pageNumber)?.rows.find((candidate) => candidate.id === correction.rowId);
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
  const interpreted = interpretPdfBlocks(
    layout.pages,
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
    pages: layout.pages,
    regions: effectiveGuidance.regions,
    accountType: interpreted.accountType,
    balanceBehavior: interpreted.balanceBehavior,
    balanceCheckpoints: interpreted.balanceCheckpoints,
  });
  const transactions = applyFieldCorrections(
    validated.transactions,
    corrections.filter((correction) => correction.kind === "accept-transaction")
  );
  const likelyScanned = layout.pages.length > 0 && layout.pages.every((page) => page.imageOnlyLikelihood >= 0.75);
  const metrics = {
    pages: layout.pages.length,
    transactionPages: new Set(effectiveGuidance.regions.filter((region) => region.kind === "transactions" && region.included).map((region) => region.pageNumber)).size,
    transactions: transactions.length,
    accepted: transactions.filter((transaction) => transaction.status === "accepted").length,
    review: transactions.filter((transaction) => transaction.status === "review").length,
    rejected: transactions.filter((transaction) => transaction.status === "rejected").length,
    duplicates: transactions.filter((transaction) => transaction.issueCodes.includes("POSSIBLE_DUPLICATE")).length,
    skippedRegions: effectiveGuidance.regions.filter((region) => !region.included).length,
  };
  const warnings = [
    ...(likelyScanned ? ["The document does not contain enough selectable text to parse safely."] : []),
    ...(metrics.rejected ? [`${metrics.rejected} transaction ${metrics.rejected === 1 ? "has" : "have"} unresolved required fields.`] : []),
    ...(["loan", "investment"].includes(interpreted.accountType) ? ["This statement type needs specialized review before import."] : []),
  ];
  return {
    modelVersion: PDF_PARSER_MODEL_VERSION,
    document,
    reconstructedPages: layout.pages,
    regions: effectiveGuidance.regions,
    schemaHypotheses: schemas.hypotheses,
    activeSchema,
    blocks: correctedBlocks,
    guidance: effectiveGuidance,
    detectedGuidance,
    accountType: interpreted.accountType,
    balanceBehavior: interpreted.balanceBehavior,
    transactions,
    diagnostics: [...layout.diagnostics, ...detectedRegions.diagnostics, ...schemas.diagnostics, ...assembled.diagnostics, ...interpreted.diagnostics, ...validated.diagnostics],
    metrics,
    likelyScanned,
    warnings,
  };
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
  return { "transaction-date": rows.flatMap(({ row }) => dateMatches(row.text)) };
}

function detectStatementPeriod(
  pages: PdfStatementParseResult["reconstructedPages"]
) {
  const firstPage = pages[0];
  const rows = firstPage
    ? firstPage.rows.filter((row) => row.y <= firstPage.height * 0.45)
    : [];
  const candidates = rows
    .filter((row) => /statement\s+(?:period|cycle)|period\s+(?:covered|from)|(?:statement|period)\b.+\bfrom\b.+\bto\b|open(?:ing)?\s+date.+clos(?:ing|e)\s+date/i.test(row.text))
    .map((row) => dateMatches(row.text))
    .filter((matches) => matches.length >= 2);
  for (const matches of candidates) {
    const format = inferPdfDateFormat([matches], { start: null, end: null });
    if (format === "auto") continue;
    const parsed = matches.flatMap((value) => {
      const result = parsePdfDateCandidate(value, format, [], { start: null, end: null });
      return result.value ? [result.value] : [];
    });
    if (parsed.length < 2) continue;
    return { start: [...parsed].sort()[0], end: [...parsed].sort().at(-1) ?? null };
  }

  const ending = rows.find((row) =>
    /statement\s+(?:date|ending|end)|period\s+ending|closing\s+date/i.test(row.text)
    && dateMatches(row.text).length > 0
  );
  if (ending) {
    const value = parseMetadataDate(dateMatches(ending.text)[0]);
    if (value) return { start: null, end: value };
  }
  return { start: null, end: null };
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
