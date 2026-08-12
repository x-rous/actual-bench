/**
 * The one entry point for turning a statement file into `StatementRow`s
 * (RD-072 §2.5).
 *
 * Format-specific work stops here. Everything past this module — matching,
 * planning, Apply — sees the same normalized rows whether they came from a
 * pasted spreadsheet, a bank's OFX export, or a Quicken QIF file. That is the
 * property worth protecting: a format is added by writing a parser, not by
 * teaching the reconciliation engine a new special case.
 */

import { parseOfx, looksLikeOfx } from "./ofx";
import { parseQif, looksLikeQif } from "./qif";
import { parseStatementText, type DelimitedTable, type StatementDelimiter } from "./parse";
import {
  DEFAULT_PARSE_CONFIG,
  detectDateFormat,
  detectDelimitedConfig,
  isDateFormatAmbiguous,
  normalizeStatement,
  type NormalizedStatement,
  type StatementFormat,
  type StatementParseConfig,
} from "./normalize";
import { normalizeStructuredStatement } from "./structured";

/** What a file's extension says it is. Content still gets the final word. */
export function formatFromFileName(fileName: string | null | undefined): StatementFormat | null {
  if (!fileName) return null;
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (extension === "ofx" || extension === "qfx") return "ofx";
  if (extension === "qif") return "qif";
  if (extension === "csv" || extension === "tsv" || extension === "txt") return "delimited";
  return null;
}

/**
 * Detect the format of a statement.
 *
 * Content wins over the extension for the structured formats, because a `.txt`
 * holding an OFX export is a real thing and reading it as a delimited table
 * produces gibberish rather than an error. It does not win the other way: a file
 * that is neither OFX nor QIF is delimited by elimination, which is also what a
 * paste is.
 */
export function detectStatementFormat(input: {
  fileName?: string | null;
  text: string;
}): StatementFormat {
  if (looksLikeOfx(input.text)) return "ofx";
  if (looksLikeQif(input.text)) return "qif";
  return formatFromFileName(input.fileName) ?? "delimited";
}

export type StatementSource = {
  text: string;
  fileName?: string | null;
  /** Overrides delimiter sniffing for delimited files. */
  delimiter?: StatementDelimiter;
};

export type ParsedStatement = NormalizedStatement & {
  format: StatementFormat;
  /** The tokenized table, for the delimited mapping UI. Null for other formats. */
  table: DelimitedTable | null;
};

/**
 * A starting parse configuration for this source.
 *
 * Detection is a proposal, not a verdict: the import UI shows what was detected
 * and the user's edits win, which is the rule the analysis doc is explicit about
 * for CSV and which costs nothing to honour for the structured formats too.
 */
export function detectParseConfig(source: StatementSource): StatementParseConfig {
  const format = detectStatementFormat(source);
  if (format === "delimited") {
    const table = parseStatementText(source.text, { delimiter: source.delimiter });
    return detectDelimitedConfig(table);
  }

  // QIF states no date convention of its own — Quicken writes whatever the
  // machine that exported it uses — so its dates get the same detection a CSV
  // column gets. OFX needs none: `parseOfx` has already made them ISO.
  if (format === "qif") {
    const dates = parseQif(source.text).transactions.map((transaction) => transaction.date ?? "");
    return { ...DEFAULT_PARSE_CONFIG, format, dateFormat: detectDateFormat(dates) };
  }

  return { ...DEFAULT_PARSE_CONFIG, format };
}

/**
 * Whether the file's dates leave day-first versus month-first unresolved.
 *
 * Asked separately from `detectParseConfig` because it is a statement about the
 * *file*, not a setting: there is nothing to configure, only something the user
 * needs telling.
 */
export function hasAmbiguousDates(source: StatementSource, config: StatementParseConfig): boolean {
  if (config.format === "ofx") return false;
  if (config.format === "qif") {
    return isDateFormatAmbiguous(
      parseQif(source.text).transactions.map((transaction) => transaction.date ?? "")
    );
  }

  const table = parseStatementText(source.text, { delimiter: source.delimiter });
  return isDateFormatAmbiguous(table.rows.map((cells) => cells[config.columns.date] ?? ""));
}

/** Parse a statement into normalized rows under an explicit configuration. */
export function parseStatement(
  source: StatementSource,
  config: StatementParseConfig,
  makeId: (index: number) => string
): ParsedStatement {
  if (config.format === "ofx") {
    const { transactions } = parseOfx(source.text);
    return {
      format: "ofx",
      table: null,
      ...normalizeStructuredStatement(transactions, config, makeId),
    };
  }

  if (config.format === "qif") {
    const { transactions } = parseQif(source.text);
    return {
      format: "qif",
      table: null,
      ...normalizeStructuredStatement(transactions, config, makeId),
    };
  }

  const table = parseStatementText(source.text, { delimiter: source.delimiter });
  return {
    format: "delimited",
    table,
    ...normalizeStatement(table, config, makeId),
  };
}

/** Human-facing format names, for the import panel and error messages. */
export const STATEMENT_FORMAT_LABELS: Record<StatementFormat, string> = {
  delimited: "CSV / TSV",
  ofx: "OFX / QFX",
  qif: "QIF",
};
