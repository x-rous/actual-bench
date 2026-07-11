import { formatAmount, type PreviewRow } from "./previewRows";

/**
 * Audit export for a sync run (RD-057 §7). Serializes the loaded preview rows -
 * source side, target side, classification, apply state, flags, message - to
 * JSON or CSV so a run can be archived or reviewed outside the app. Pure and
 * UI-agnostic; the component only handles the file download.
 */

export type RunAuditRecord = {
  sourceItemKey: string;
  classification: string;
  plannedAction: string;
  applyState: string;
  sourceDate: string;
  sourceAmount: string;
  sourcePayee: string;
  sourceCategory: string;
  targetDate: string;
  targetAmount: string;
  targetPayee: string;
  targetCategory: string;
  flags: string;
  message: string;
};

export function toAuditRecord(row: PreviewRow): RunAuditRecord {
  return {
    sourceItemKey: row.sourceItemKey,
    classification: row.classification ?? "",
    plannedAction: row.plannedAction ?? "",
    applyState: row.applyState ?? "",
    sourceDate: row.source.date,
    sourceAmount: formatAmount(row.source.amount),
    sourcePayee: row.source.payeeName ?? "",
    sourceCategory: row.source.categoryName ?? "",
    targetDate: row.target.date,
    targetAmount: formatAmount(row.target.amount),
    targetPayee: row.target.payeeName ?? "",
    targetCategory: row.target.categoryName ?? "",
    flags: row.flags.join("|"),
    message: row.message ?? "",
  };
}

export function buildRunAuditJson(rows: PreviewRow[]): string {
  return JSON.stringify(rows.map(toAuditRecord), null, 2);
}

const CSV_COLUMNS: (keyof RunAuditRecord)[] = [
  "sourceItemKey", "classification", "plannedAction", "applyState",
  "sourceDate", "sourceAmount", "sourcePayee", "sourceCategory",
  "targetDate", "targetAmount", "targetPayee", "targetCategory",
  "flags", "message",
];

/** RFC-4180 field escaping: quote when the value has a comma, quote, or newline. */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildRunAuditCsv(rows: PreviewRow[]): string {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => {
    const rec = toAuditRecord(row);
    return CSV_COLUMNS.map((col) => csvField(rec[col])).join(",");
  });
  return [header, ...lines].join("\r\n");
}

/** Stable, filesystem-safe filename for a run export. */
export function auditFileName(runId: string, format: "json" | "csv"): string {
  const safe = runId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "run";
  return `sync-audit-${safe}.${format}`;
}
