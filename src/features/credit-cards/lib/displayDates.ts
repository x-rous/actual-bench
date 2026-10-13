import { format } from "date-fns";
import { formatChartDate } from "@/features/assets-debt/components/chart/chartMeta";

/** Display only. Stored dates, date arithmetic and sort keys remain ISO. */
export const CARD_DATE_FORMAT = "dd MMM yyyy";
export const formatCardDate = formatChartDate;
export function formatCardTimestamp(timestamp: string) {
  return format(new Date(timestamp), `${CARD_DATE_FORMAT} · HH:mm:ss`);
}
