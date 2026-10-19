import { formatAmount } from "@/features/assets-debt/lib/money";
import { formatCardDate } from "../../lib/displayDates";

/** The one missing-value glyph (UI-15; the repo uses a plain hyphen in UI text). Unknown is never shown as 0. */
export const MISSING = "-";

/** Integer minor units as text with Actual's sign; neutral colour everywhere (D28). */
export const money = (minor: number | null | undefined) => (minor == null ? MISSING : formatAmount(minor, 2));

/** "8 Oct" within the current year, "8 Oct 2025" otherwise. */
export function shortDate(date: string, today?: string) {
  const full = formatCardDate(date);
  return today && date.slice(0, 4) === today.slice(0, 4) ? full.replace(/ \d{4}$/, "") : full;
}

export const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** Read time for the header and the refresh banner, e.g. "10:32". */
export const readTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** 1st, 2nd, 3rd, 11th… for day-of-month rules. */
export const ordinal = (day: number) => `${day}${day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th"}`;
