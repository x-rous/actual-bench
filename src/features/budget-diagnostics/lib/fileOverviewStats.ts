import type { OverviewPayload } from "../types";

export type OverviewMetric = {
  id: string;
  label: string;
  value: string;
  detail?: string;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB"] as const;

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 || value >= 10 ? 0 : 1;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unitIndex]}`;
}

export function buildOverviewMetrics(overview: OverviewPayload): OverviewMetric[] {
  const { counts, file } = overview;

  return [
    { id: "tables", label: "Tables", value: formatCount(counts.tables) },
    { id: "views", label: "Views", value: formatCount(counts.views) },
    { id: "transactions", label: "Transactions", value: formatCount(counts.transactions) },
    { id: "accounts", label: "Accounts", value: formatCount(counts.accounts) },
    { id: "payees", label: "Payees", value: formatCount(counts.payees) },
    {
      id: "category_groups",
      label: "Category Groups",
      value: formatCount(counts.category_groups),
    },
    { id: "categories", label: "Categories", value: formatCount(counts.categories) },
    { id: "rules", label: "Rules", value: formatCount(counts.rules) },
    { id: "schedules", label: "Schedules", value: formatCount(counts.schedules) },
    { id: "tags", label: "Tags", value: formatCount(counts.tags) },
    { id: "notes", label: "Notes", value: formatCount(counts.notes) },
    {
      id: "db_size",
      label: "db.sqlite size",
      value: formatBytes(file.dbSizeBytes),
      detail: "Opened snapshot",
    },
  ];
}
