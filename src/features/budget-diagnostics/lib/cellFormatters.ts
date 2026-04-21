export type CellDisplayKind = "null" | "text" | "number" | "date" | "month" | "boolean" | "json" | "binary";

export type CellDisplay = {
  text: string;
  title: string;
  kind: CellDisplayKind;
};

const BOOLEAN_COLUMNS = new Set([
  "cleared",
  "completed",
  "enabled",
  "hidden",
  "active",
  "tombstone",
]);

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function toInteger(value: unknown): number | null {
  if (isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeColumnName(column: string): string {
  return column.trim().toLowerCase();
}

function formatDateInteger(value: number): string | null {
  if (value <= 0) return null;
  const year = Math.floor(value / 10000);
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  if (year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day
    .toString()
    .padStart(2, "0")}`;
}

function formatMonthInteger(value: number): string | null {
  if (value <= 0) return null;
  const year = Math.floor(value / 100);
  const month = value % 100;
  if (year < 1900 || year > 9999 || month < 1 || month > 12) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function isDateColumn(column: string): boolean {
  const normalized = normalizeColumnName(column);
  return normalized === "date" || normalized.endsWith("_date");
}

function isMonthColumn(column: string): boolean {
  return normalizeColumnName(column).includes("month");
}

function isBooleanColumn(column: string): boolean {
  const normalized = normalizeColumnName(column);
  return (
    BOOLEAN_COLUMNS.has(normalized) ||
    normalized.startsWith("is_") ||
    normalized.startsWith("has_")
  );
}

function isJsonString(value: string): boolean {
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function isBinaryValue(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

export function binaryHexPreview(value: Uint8Array, bytes = 16): string {
  return Array.from(value.slice(0, bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join(" ");
}

export function binaryToBase64(value: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < value.length; offset += chunkSize) {
    const chunk = value.slice(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function rawCellTitle(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (isBinaryValue(value)) {
    const preview = binaryHexPreview(value);
    return preview ? `hex: ${preview}` : "empty binary value";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function formatCellDisplay(column: string, value: unknown): CellDisplay {
  if (value === null || value === undefined) {
    return { text: "NULL", title: "", kind: "null" };
  }

  if (isBinaryValue(value)) {
    return {
      text: `<binary, ${value.byteLength.toLocaleString("en-US")} bytes>`,
      title: rawCellTitle(value),
      kind: "binary",
    };
  }

  const integer = toInteger(value);
  if (integer !== null && isBooleanColumn(column) && (integer === 0 || integer === 1)) {
    return { text: integer === 1 ? "Yes" : "No", title: String(value), kind: "boolean" };
  }

  if (integer !== null && isMonthColumn(column)) {
    const formatted = formatMonthInteger(integer);
    if (formatted) return { text: formatted, title: String(value), kind: "month" };
  }

  if (integer !== null && isDateColumn(column)) {
    const formatted = formatDateInteger(integer);
    return {
      text: formatted ?? "—",
      title: String(value),
      kind: "date",
    };
  }

  if (typeof value === "number") {
    return { text: String(value), title: String(value), kind: "number" };
  }

  if (typeof value === "string" && isJsonString(value)) {
    return { text: value, title: value, kind: "json" };
  }

  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return { text, title: text, kind: "json" };
  }

  return { text: String(value), title: String(value), kind: "text" };
}

function toJsonSafeValue(value: unknown): unknown {
  if (isBinaryValue(value)) return { $base64: binaryToBase64(value) };
  if (Array.isArray(value)) return value.map(toJsonSafeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, toJsonSafeValue(entryValue)])
    );
  }
  return value;
}

export function stringifyRowForClipboard(row: Record<string, unknown>): string {
  return JSON.stringify(toJsonSafeValue(row), null, 2);
}
