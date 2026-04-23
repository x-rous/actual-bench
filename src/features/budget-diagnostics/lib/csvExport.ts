import { csvField } from "@/lib/csv";
import type { ColumnInfo } from "../types";
import { binaryToBase64, isBinaryValue } from "./cellFormatters";

export const CSV_UTF8_BOM = "\uFEFF";
export const CSV_MEMORY_WARNING_BYTES = 200 * 1024 * 1024;

const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);
const BLOB_BASE64_PAYLOAD_LIMIT = 4096;
const BLOB_BYTE_HEAD_LIMIT = Math.floor(BLOB_BASE64_PAYLOAD_LIMIT / 4) * 3;

function columnType(column: ColumnInfo): string {
  return column.type.trim().toUpperCase();
}

function isBlobColumn(column: ColumnInfo): boolean {
  return columnType(column).includes("BLOB");
}

function neutralizeTextForCsv(value: string): string {
  if (value.length === 0) return value;
  return FORMULA_PREFIXES.has(value[0]) ? `'${value}` : value;
}

function encodeBlobValue(value: Uint8Array): string {
  const truncated = value.byteLength > BLOB_BYTE_HEAD_LIMIT;
  const head = truncated ? value.slice(0, BLOB_BYTE_HEAD_LIMIT) : value;
  return `base64:${binaryToBase64(head)}${truncated ? ";truncated=true" : ""}`;
}

export function encodeCsvCell(value: unknown, column: ColumnInfo): string {
  if (value === null || value === undefined) return "";
  if (isBinaryValue(value)) return encodeBlobValue(value);

  if (isBlobColumn(column)) return encodeBlobValue(new TextEncoder().encode(String(value)));
  if (typeof value === "string") return neutralizeTextForCsv(value);
  return String(value);
}

export function buildCsvHeader(columns: readonly ColumnInfo[]): string {
  return columns.map((column) => csvField(column.name)).join(",");
}

export function buildCsvRows(
  rows: readonly Record<string, unknown>[],
  columns: readonly ColumnInfo[]
): string {
  return rows
    .map((row) =>
      columns.map((column) => csvField(encodeCsvCell(row[column.name], column))).join(",")
    )
    .join("\r\n");
}

export function estimateCsvBytes(
  rowCount: number,
  sampleRows: readonly Record<string, unknown>[],
  columns: readonly ColumnInfo[]
): number {
  if (rowCount <= 0 || sampleRows.length === 0 || columns.length === 0) return 0;

  const totalCellLength = sampleRows.reduce((rowTotal, row) => {
    return (
      rowTotal +
      columns.reduce((cellTotal, column) => {
        return cellTotal + csvField(encodeCsvCell(row[column.name], column)).length;
      }, 0)
    );
  }, 0);
  const averageColumnTextLength = totalCellLength / sampleRows.length / columns.length;
  return Math.ceil(rowCount * averageColumnTextLength * columns.length);
}

export function csvExportFilename(objectName: string, date = new Date()): string {
  const safeObject = objectName.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `budget-diagnostics-${safeObject}-${date.toISOString().slice(0, 10)}.csv`;
}
