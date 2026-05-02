import type { ReactNode } from "react";
import { formatSummary } from "../../lib/format";
import type {
  TrackingSummaryTone,
  TrackingSummaryValueKind,
} from "../../lib/trackingSummary";

export type SummaryCellMetric = {
  label?: ReactNode;
  value: number | null;
  valueKind?: TrackingSummaryValueKind;
  signed?: boolean;
  tone?: TrackingSummaryTone;
  tooltip?: string;
};

export function summaryToneClass(
  tone: TrackingSummaryTone | undefined
): string {
  switch (tone) {
    case "positive":
      return "text-emerald-600 dark:text-emerald-400";
    case "negative":
      return "text-destructive";
    case "warning":
      return "text-amber-600 dark:text-amber-400";
    case "future":
      return "text-muted-foreground/55";
    case "muted":
      return "text-muted-foreground";
    case "neutral":
    default:
      return "text-foreground/75";
  }
}

export function summaryLabelClass(
  tone: TrackingSummaryTone | undefined
): string {
  return tone === "future" ? "text-muted-foreground/60" : "text-muted-foreground";
}

function formatSummaryDelta(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatSummary(Math.abs(value))}`;
}

export function formatSummaryCellValue(cell: SummaryCellMetric): string {
  if (cell.value == null) return "—";
  if (cell.valueKind === "percent") {
    return `${cell.value.toLocaleString("en-US")}%`;
  }
  return cell.signed
    ? formatSummaryDelta(cell.value)
    : formatSummary(cell.value);
}
