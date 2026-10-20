import { formatChartDate } from "@/features/assets-debt/components/chart/chartMeta";

/** Display only. Stored dates, date arithmetic and sort keys remain ISO. */
export const CARD_DATE_FORMAT = "dd MMM yyyy";
export const formatCardDate = formatChartDate;

/** The closing date already shows the year; preserve the starting year across New Year. */
export function formatStatementPeriod(start: string, close: string) {
  const short = (date: string) => formatCardDate(date).replace(/ \d{4}$/, "");
  return `${start.slice(0, 4) === close.slice(0, 4) ? short(start) : formatCardDate(start)} – ${short(close)}`;
}

const MONTH_FORMAT = new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" });
const months = new Map<string, string>();
/** "Oct 2026". Charts call this per point, so the formatter is shared and results are cached by month. */
export function formatCardMonth(date: string) {
  const key = date.slice(0, 7);
  let label = months.get(key);
  if (label === undefined) {
    label = MONTH_FORMAT.format(new Date(`${key}-01T00:00:00Z`));
    months.set(key, label);
  }
  return label;
}
