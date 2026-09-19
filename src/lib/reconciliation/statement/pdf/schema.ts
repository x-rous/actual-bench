import { looksLikeDate, moneyCandidates } from "./candidates";
import { columnExamplesForRegions } from "./columns";
import { diagnostic } from "./diagnostics";
import type {
  PdfColumn,
  PdfColumnRole,
  PdfDiagnosticEvent,
  PdfParserGuidance,
  PdfReconstructedPage,
  PdfRegion,
  PdfTableSchema,
  PdfVisualCell,
} from "./model";

export type PdfSchemaResult = {
  hypotheses: PdfTableSchema[];
  active: PdfTableSchema | null;
  diagnostics: PdfDiagnosticEvent[];
};

const HEADER_ROLES: [PdfColumnRole, RegExp][] = [
  ["transaction-date", /transaction\s*date|trans\.?\s*date|purchase\s*date|date\s+of\s+transaction|^date$/i],
  ["posting-date", /post(?:ing|ed)?\s*date|processed\s*date|booking\s*date|entry\s*date|registration\s*date/i],
  ["value-date", /value\s*date/i],
  ["description", /description|details|narration|narrative|merchant|particulars|memo|remarks|activity|payment\s+details/i],
  ["reference", /reference|ref\.?|transaction id|cheque/i],
  ["debit", /debit|withdrawal|money out|charges?/i],
  ["credit", /credit|deposit|money in/i],
  ["amount", /^amount$|account amount|total amount/i],
  ["direction", /(?:d|dr)\s*[/\\]\s*(?:c|cr)|(?:c|cr)\s*[/\\]\s*(?:d|dr)|debit\s*[/\\]\s*credit\s+indicator|notation|type/i],
  ["balance", /balance/i],
  ["original-amount", /original amount|foreign amount|transaction amount/i],
  ["original-currency", /original currency|foreign currency|transaction currency/i],
  ["exchange-rate", /exchange rate|fx rate|conversion rate/i],
  ["currency", /^(?:currency|ccy)$|statement currency/i],
  ["fee", /fees?|charge amount/i],
  ["vat", /vat|tax/i],
];

export function detectPdfTableSchemas(
  pages: PdfReconstructedPage[],
  regions: PdfRegion[],
  guidance?: Pick<PdfParserGuidance, "columns">
): PdfSchemaResult {
  const transactionRegions = regions.filter((region) => region.kind === "transactions" && region.included);
  if (guidance?.columns.length) {
    const active = schema("guided", transactionRegions, guidance.columns, 1, ["explicit file guidance"]);
    return { hypotheses: [active], active, diagnostics: [diagnostic({ stage: "schema", code: "GUIDED_SCHEMA", metrics: { columns: active.columns.length } })] };
  }
  const referencePageWidth = pages.find((page) => transactionRegions.some((region) => region.pageNumber === page.pageNumber))?.width
    ?? pages[0]?.width
    ?? 1;
  const rows = transactionRegions.flatMap((region) => {
    const page = pages.find((entry) => entry.pageNumber === region.pageNumber);
    const scale = referencePageWidth / Math.max(1, page?.width ?? referencePageWidth);
    return rowsForRegion(pages, region).map((row) => ({
      ...row,
      x: row.x * scale,
      width: row.width * scale,
      cells: row.cells.map((cell) => ({ ...cell, x: cell.x * scale, width: cell.width * scale })),
    }));
  });
  const cells = rows.flatMap((row) => row.cells);
  if (cells.length === 0) return { hypotheses: [], active: null, diagnostics: [] };
  const clusters = clusterCellsByX(cells);
  const headerHypothesis = withExamples(
    columnsFromHeaders(clusters, referencePageWidth),
    pages,
    transactionRegions
  );
  const transactionRowKeys = new Set(rows.filter((row) => looksLikeDate(row.text)).map((row) => row.id));
  const contentHypothesis = withExamples(
    columnsFromContent(clusters, referencePageWidth, transactionRowKeys),
    pages,
    transactionRegions
  );
  const hypotheses = [headerHypothesis, contentHypothesis]
    .filter((columns) => columns.length > 0)
    .map((columns, index) => schema(
      index === 0 ? "headers" : "content",
      transactionRegions,
      columns,
      scoreSchema(columns, index === 0),
      index === 0 ? ["roles inferred from printed headers"] : ["roles inferred from column values"]
    ))
    .sort((left, right) => right.score - left.score);
  return {
    hypotheses,
    active: hypotheses[0] ?? null,
    diagnostics: hypotheses.map((hypothesis) => diagnostic({
      stage: "schema",
      code: "SCHEMA_HYPOTHESIS",
      metrics: { columns: hypothesis.columns.length, scorePermille: Math.round(hypothesis.score * 1000) },
    })),
  };
}

function columnsFromHeaders(clusters: PdfVisualCell[][], referencePageWidth: number): PdfColumn[] {
  const allCells = clusters.flat();
  const candidates = allCells.flatMap((cell) => HEADER_ROLES.flatMap(([role, pattern]) => {
    const match = pattern.exec(cell.text);
    if (!match) return [];
    const center = cell.x + cell.width * (((match.index ?? 0) + match[0].length / 2) / Math.max(1, cell.text.length));
    return [{ cell, role, center, rowKey: cell.id.replace(/-c\d+$/, "") }];
  }));
  const candidatesByRow = new Map<string, typeof candidates>();
  candidates.forEach((candidate) => candidatesByRow.set(candidate.rowKey, [...(candidatesByRow.get(candidate.rowKey) ?? []), candidate]));
  const headerRow = [...candidatesByRow.values()]
    .filter((rowCandidates) => {
      const roles = new Set(rowCandidates.map((candidate) => candidate.role));
      return [...roles].some((role) => ["transaction-date", "posting-date", "value-date"].includes(role))
        && [...roles].some((role) => ["amount", "debit", "credit"].includes(role))
        && roles.has("description");
    })
    .sort((left, right) => new Set(right.map((candidate) => candidate.role)).size - new Set(left.map((candidate) => candidate.role)).size)[0];
  const headers = (headerRow ?? [])
    .filter((entry, index, entries) =>
      ["description", "reference"].includes(entry.role)
      || entries.findIndex((candidate) => candidate.role === entry.role) === index
    )
    .sort((left, right) => left.center - right.center);
  if (!headers.length) return [];
  const pageEnd = Math.max(...allCells.map((cell) => cell.x + cell.width));
  return headers.map((entry, index) => {
    const previous = headers[index - 1];
    const next = headers[index + 1];
    const xStart = previous ? (previous.center + entry.center) / 2 : Math.max(0, entry.cell.x - 8);
    const xEnd = next ? (entry.center + next.center) / 2 : Math.min(pageEnd + 8, entry.cell.x + entry.cell.width + 24);
    return {
      id: `column-${index}-${entry.role}`,
      pageNumber: null,
      referencePageWidth,
      xStart,
      xEnd,
      role: entry.role,
      header: entry.cell.text,
      examples: [],
      confidence: 0.9,
    };
  });
}

function columnsFromContent(
  clusters: PdfVisualCell[][],
  referencePageWidth: number,
  transactionRowKeys: Set<string>
): PdfColumn[] {
  const supported = clusters.map((cells, index) => {
    const transactionCells = cells.filter((cell) => transactionRowKeys.has(rowKey(cell)));
    const samples = transactionCells.map((cell) => cell.text).filter(Boolean);
    return {
      cells: transactionCells,
      index,
      samples,
      support: new Set(transactionCells.map(rowKey)).size,
      dateRatio: ratio(samples, looksLikeDate),
      moneyRatio: ratio(samples, (value) => moneyCandidates(value).length === 1),
      directionRatio: ratio(samples, (value) => /^(?:CR|DR|C|D|CREDIT|DEBIT)$/i.test(value.trim())),
    };
  }).filter((candidate) => candidate.support >= 2);
  const moneyClusters = supported.filter((candidate) => candidate.moneyRatio >= 0.65);
  const descriptionCluster = supported
    .filter((candidate) => candidate.dateRatio < 0.25 && candidate.moneyRatio < 0.25 && candidate.directionRatio < 0.65)
    .sort((left, right) => average(right.samples.map((sample) => sample.length)) - average(left.samples.map((sample) => sample.length)))[0];
  let dateIndex = 0;
  return supported.flatMap(({ cells, index, dateRatio, moneyRatio, directionRatio }) => {
    let role: PdfColumnRole | null = null;
    if (dateRatio >= 0.65) {
      role = dateIndex === 0 ? "transaction-date" : dateIndex === 1 ? "posting-date" : "value-date";
      dateIndex += 1;
    } else if (moneyRatio >= 0.65 && moneyClusters.length === 1) {
      role = "amount";
    } else if (directionRatio >= 0.65) {
      role = "direction";
    } else if (descriptionCluster?.index === index) {
      role = "description";
    }
    return role
      ? [columnFromCluster(cells, index, role, null, Math.max(dateRatio, moneyRatio, directionRatio, 0.65), referencePageWidth)]
      : [];
  });
}

function rowKey(cell: PdfVisualCell) {
  return cell.id.replace(/-c\d+$/, "");
}

function clusterCellsByX(cells: PdfVisualCell[]) {
  const clusters: PdfVisualCell[][] = [];
  for (const cell of [...cells].sort((a, b) => a.x - b.x)) {
    const center = cell.x + cell.width / 2;
    const cluster = clusters.find((candidate) => {
      const candidateCenter = average(candidate.map((entry) => entry.x + entry.width / 2));
      return Math.abs(candidateCenter - center) <= Math.max(18, cell.width * 0.35);
    });
    if (cluster) cluster.push(cell);
    else clusters.push([cell]);
  }
  return clusters.sort((a, b) => minX(a) - minX(b));
}

function columnFromCluster(
  cells: PdfVisualCell[],
  index: number,
  role: PdfColumnRole,
  header: string | null,
  confidence: number,
  referencePageWidth: number
): PdfColumn {
  return {
    id: `column-${index}-${role}`,
    pageNumber: null,
    referencePageWidth,
    xStart: Math.min(...cells.map((cell) => cell.x)),
    xEnd: Math.max(...cells.map((cell) => cell.x + cell.width)),
    role,
    header,
    examples: [],
    confidence,
  };
}

function schema(
  id: string,
  regions: PdfRegion[],
  columns: PdfColumn[],
  score: number,
  reasons: string[]
): PdfTableSchema {
  return { id, regionIds: regions.map((region) => region.id), columns, score, reasons };
}

function scoreSchema(columns: PdfColumn[], fromHeaders: boolean) {
  const roles = new Set(columns.map((column) => column.role));
  const hasDate = roles.has("transaction-date") || roles.has("posting-date") || roles.has("value-date");
  const hasAmount = roles.has("amount") || roles.has("debit") || roles.has("credit");
  return Math.min(1, (hasDate ? 0.35 : 0) + (hasAmount ? 0.4 : 0) + (roles.has("description") ? 0.15 : 0) + (fromHeaders ? 0.1 : 0));
}

function rowsForRegion(pages: PdfReconstructedPage[], region: PdfRegion) {
  const ids = new Set(region.rowIds);
  return pages.find((page) => page.pageNumber === region.pageNumber)?.rows.filter((row) => ids.has(row.id)) ?? [];
}

function ratio(values: string[], predicate: (value: string) => boolean) {
  if (!values.length) return 0;
  return values.filter(predicate).length / values.length;
}

function minX(cells: PdfVisualCell[]) {
  return Math.min(...cells.map((cell) => cell.x));
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function withExamples(
  columns: PdfColumn[],
  pages: PdfReconstructedPage[],
  regions: PdfRegion[]
) {
  return columns.map((column) => ({
    ...column,
    examples: columnExamplesForRegions(pages, regions, column),
  }));
}
