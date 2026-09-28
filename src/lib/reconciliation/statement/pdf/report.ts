import { normalizePdfText } from "./text";
import type {
  PdfColumn,
  PdfParserGuidance,
  PdfStatementParseResult,
  PdfTransactionProposal,
  PdfVisualRow,
} from "./model";

/**
 * What a reader shares when a statement does not read the way it should:
 * enough to see why, and to rebuild the layout that caused it, with none of
 * the statement's words or figures.
 *
 * Letters in any script become `A` and digits `9`, so a row keeps its shape -
 * `99-Aug-99 | A A | 9,999.99 CR` - without its content. The words the parser
 * itself acts on stay (`CR`/`DR`, currency codes, month names, the generic words
 * of table headings; see `KEPT_WORDS`). Positions are percentages of the page
 * width. No other statement text, and no internal ids.
 */
export function buildPdfDiagnosticsReport(
  result: PdfStatementParseResult,
  context: {
    appVersion: string;
    userAgent?: string;
    layout?: { applied: boolean; assignedToAccount: boolean };
  }
) {
  const pageWidth = new Map(result.reconstructedPages.map((page) => [page.pageNumber, page.width]));
  const blockPage = new Map(result.blocks.map((block) => [block.id, block.pageNumber]));
  const rowsById = new Map(result.reconstructedPages.flatMap((page) => page.rows.map((row) => [row.id, row] as const)));
  const firstWidth = result.reconstructedPages[0]?.width ?? 1;
  const transactions = result.transactions;

  return {
    format: 1,
    appVersion: context.appVersion,
    parserModelVersion: result.modelVersion,
    extraction: result.extraction ?? null,
    userAgent: context.userAgent ?? null,
    layout: context.layout ?? null,
    pages: result.reconstructedPages.map((page, index) => {
      const regions = result.regions.filter((region) => region.pageNumber === page.pageNumber && region.kind === "transactions");
      const onPage = transactions.filter((transaction) => blockPage.get(transaction.id) === page.pageNumber);
      return {
        page: page.pageNumber,
        size: `${Math.round(page.width)}x${Math.round(page.height)}`,
        rotation: page.rotation ?? 0,
        textItems: result.document.pages[index]?.items.length ?? 0,
        rows: page.rows.length,
        imageOnly: page.imageOnlyLikelihood >= 0.75,
        transactionAreas: {
          included: regions.filter((region) => region.included).length,
          ignoredByLayout: regions.filter((region) => region.ignoredByLayout).length,
          ignored: regions.filter((region) => !region.included && !region.ignoredByLayout).length,
        },
        transactions: countBy(onPage, (transaction) => transaction.status),
      };
    }),
    settings: settingsReport(result),
    columns: {
      inUse: result.guidance.columns.map((column) => columnReport(column, firstWidth)),
      detected: result.detectedGuidance.columns.map((column) => columnReport(column, firstWidth)),
    },
    outcome: {
      metrics: result.metrics,
      accountType: result.accountType,
      balanceBehavior: result.balanceBehavior,
      balancePolarity: result.balancePolarity?.source ?? null,
      likelyScanned: result.likelyScanned,
      byStatus: countBy(transactions, (transaction) => transaction.status),
      reasons: countBy(transactions.flatMap((transaction) => transaction.issueCodes), (code) => code),
      directionEvidence: countBy(transactions, (transaction) => transaction.directionEvidence),
    },
    notices: result.notices.map((notice) => ({
      code: notice.code,
      kind: notice.kind,
      setting: notice.setting ?? null,
      pages: notice.pageNumbers ?? [],
      rows: notice.rows?.length ?? 0,
    })),
    tableHeaders: result.reconstructedPages.flatMap((page) => page.rows
      .filter((row) => row.tableHeader)
      .slice(0, 1)
      .map((row) => ({ page: page.pageNumber, cells: cellShapes(row, pageWidth.get(page.pageNumber) ?? 1) }))),
    rowSamples: rowSamples(result, rowsById, pageWidth, blockPage),
    events: eventSummary(result),
  };
}

/**
 * Words kept as printed, so a shape still explains the result: the markers,
 * currency codes and month names the parser reads, and the generic words
 * table headings are made of, which column detection reads. None of them
 * identifies a person, an account or a merchant.
 */
const KEPT_WORDS = /^(?:date|transaction|trans|posting|posted|value|booking|description|details|narration|narrative|particulars|reference|ref|amount|debit|credit|withdrawals?|deposits?|balance|original|currency|vat|tax|fees?|total|money|in|out|CR|DR|AED|AUD|BHD|CAD|CHF|CNY|DKK|EGP|EUR|GBP|HKD|INR|JPY|KWD|NOK|NZD|OMR|QAR|SAR|SEK|SGD|USD|ZAR|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)$/i;

/** A value's shape: letters in any script as `A`, digits as `9`, kept words as printed. */
export function maskForDiagnostics(value: string): string {
  return normalizePdfText(value)
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[^\p{L}]/gu, "");
      if (bare && KEPT_WORDS.test(bare)) return word.replace(/\d/g, "9");
      return word.replace(/\p{L}+/gu, "A").replace(/\p{N}/gu, "9");
    })
    .join(" ");
}

function cellShapes(row: PdfVisualRow, width: number) {
  return row.cells.map((cell) => `${maskForDiagnostics(cell.text)} @${percent(cell.x, width)}-${percent(cell.x + cell.width, width)}%`);
}

function percent(value: number, width: number) {
  return Math.round((value / Math.max(1, width)) * 100);
}

function columnReport(column: PdfColumn, firstWidth: number) {
  const width = column.referencePageWidth ?? firstWidth;
  return {
    role: column.role,
    page: column.pageNumber,
    from: percent(column.xStart, width),
    to: percent(column.xEnd, width),
    header: column.header ? maskForDiagnostics(column.header) : null,
  };
}

/** Each setting in force, what detection found, and whether the reader changed it. */
function settingsReport(result: PdfStatementParseResult) {
  const used = result.guidance;
  const found = result.detectedGuidance;
  const keys = ["accountType", "currency", "dateFormat", "numberFormat", "importDate", "unsignedDirection", "printedSign", "transactionAnchorRole"] as const;
  const settings: Record<string, { inUse: unknown; detected: unknown; changed: boolean }> = {};
  for (const key of keys) {
    settings[key] = { inUse: used[key], detected: found[key], changed: used[key] !== found[key] };
  }
  const rules = (guidance: PdfParserGuidance) => guidance.pageRules ?? { ignoreFirst: 0, ignoreLast: 0 };
  settings.pageRules = {
    inUse: rules(used),
    detected: rules(found),
    changed: JSON.stringify(rules(used)) !== JSON.stringify(rules(found)),
  };
  // Whether a period was found and how long it is, not the dates themselves.
  const period = (guidance: PdfParserGuidance) => ({
    start: Boolean(guidance.statementPeriod.start),
    end: Boolean(guidance.statementPeriod.end),
    days: guidance.statementPeriod.start && guidance.statementPeriod.end
      ? Math.round((Date.parse(guidance.statementPeriod.end) - Date.parse(guidance.statementPeriod.start)) / 864e5)
      : null,
  });
  settings.statementPeriod = {
    inUse: period(used),
    detected: period(found),
    changed: JSON.stringify(used.statementPeriod) !== JSON.stringify(found.statementPeriod),
  };
  return settings;
}

const MAX_SAMPLES = 60;

/**
 * The rows that explain the outcome, as shapes: for every reason a row is not
 * ready, a few rows that have it; rows reported as not read; and the first
 * rows of each page for the ordinary case.
 */
function rowSamples(
  result: PdfStatementParseResult,
  rowsById: Map<string, PdfVisualRow>,
  pageWidth: Map<number, number>,
  blockPage: Map<string, number>
) {
  const blockRows = new Map(result.blocks.map((block) => [block.id, block.rowIds]));
  const chosen: PdfTransactionProposal[] = [];
  const add = (transaction: PdfTransactionProposal) => {
    if (chosen.length < MAX_SAMPLES && !chosen.includes(transaction)) chosen.push(transaction);
  };
  const reasons = new Set(result.transactions.filter((transaction) => transaction.status !== "accepted").flatMap((transaction) => transaction.issueCodes));
  for (const reason of reasons) {
    result.transactions.filter((transaction) => transaction.issueCodes.includes(reason)).slice(0, 3).forEach(add);
  }
  for (const page of result.reconstructedPages) {
    result.transactions.filter((transaction) => blockPage.get(transaction.id) === page.pageNumber).slice(0, 2).forEach(add);
  }

  const shape = (rowId: string) => {
    const row = rowsById.get(rowId);
    return row ? cellShapes(row, pageWidth.get(row.pageNumber) ?? 1).join(" | ") : null;
  };
  const transactions = chosen.map((transaction) => ({
    page: blockPage.get(transaction.id) ?? null,
    status: transaction.status,
    direction: transaction.direction,
    directionEvidence: transaction.directionEvidence,
    reasons: transaction.issueCodes,
    rows: (blockRows.get(transaction.id) ?? []).map(shape).filter(Boolean),
  }));
  const notRead = (result.notices.find((notice) => notice.code === "UNASSIGNED_ROWS")?.rows ?? [])
    .slice(0, 10)
    .map((reference) => ({ page: reference.pageNumber, row: shape(reference.rowId) }));
  return { transactions, notRead };
}

/** Per-row events counted, the rest listed (without source ids), at most 20 of each. */
const PER_ROW_EVENTS = new Set(["TRANSACTION_BLOCK_ASSEMBLED", "TRANSACTION_INTERPRETED", "TRANSACTION_VALIDATED", "ROW_UNASSIGNED"]);

function eventSummary(result: PdfStatementParseResult) {
  const counts = countBy(result.diagnostics, (event) => `${event.stage}:${event.code}`);
  const listed: Record<string, number> = {};
  const events = result.diagnostics
    .filter((event) => !PER_ROW_EVENTS.has(event.code))
    .filter((event) => {
      const key = `${event.stage}:${event.code}`;
      listed[key] = (listed[key] ?? 0) + 1;
      return listed[key] <= 20;
    })
    .map(({ stage, code, pageNumber, metrics }) => ({ stage, code, page: pageNumber ?? null, metrics: metrics ?? {} }));
  return { counts, events };
}

function countBy<T>(items: T[], key: (item: T) => string) {
  const counts: Record<string, number> = {};
  items.forEach((item) => {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  });
  return counts;
}
