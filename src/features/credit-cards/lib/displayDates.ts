import { format } from "date-fns";
import { formatChartDate } from "@/features/assets-debt/components/chart/chartMeta";

/** Display only. Stored dates, date arithmetic and sort keys remain ISO. */
export const CARD_DATE_FORMAT = "dd MMM yyyy";
export const formatCardDate = formatChartDate;
export function formatCardTimestamp(timestamp: string) {
  return format(new Date(timestamp), `${CARD_DATE_FORMAT} · HH:mm:ss`);
}

/** The closing date already shows the year; preserve the starting year across New Year. */
export function formatStatementPeriod(start: string, close: string) {
  const short = (date: string) => formatCardDate(date).replace(/ \d{4}$/, "");
  return `${start.slice(0, 4) === close.slice(0, 4) ? short(start) : formatCardDate(start)} – ${short(close)}`;
}
