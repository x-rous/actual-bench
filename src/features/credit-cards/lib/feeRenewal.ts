import { addMonths, daysBetween } from "@/lib/financial-models/calendar/dates";
import type { Card } from "./models";

/** Days before an annual-fee renewal that the card asks for attention (time to keep, downgrade or cancel). */
export const RENEWAL_NOTICE_DAYS = 30;

/** The next annual-fee renewal on or after `today`, from the stored renewal date repeated yearly. */
export function nextFeeRenewal(card: Pick<Card, "annualFeeRenewalDate">, today: string): string | null {
  const anchor = card.annualFeeRenewalDate;
  if (!anchor) return null;
  const day = Number(anchor.slice(8, 10));
  let years = 0;
  let next = anchor;
  while (next < today) next = addMonths(anchor, 12 * ++years, day);
  return next;
}

/** The renewal within the notice window, with its fee (minor units, null when not set). */
export function upcomingFeeRenewal(card: Pick<Card, "annualFeeRenewalDate" | "annualFeeMinor" | "status">, today: string) {
  if (card.status !== "active") return null;
  const date = nextFeeRenewal(card, today);
  if (!date) return null;
  const inDays = daysBetween(today, date);
  return inDays <= RENEWAL_NOTICE_DAYS ? { date, inDays, feeMinor: card.annualFeeMinor } : null;
}

const AUTO_PAY: Record<Card["autoPay"], string | null> = {
  unknown: null,
  off: null,
  minimum: "Auto-pay pays the minimum",
  full: "Auto-pay pays the full amount",
  fixed: "Auto-pay pays a fixed amount",
};

/** The card's auto-pay setting as a short line, or null when off or not set. */
export function autoPayLine(card: Pick<Card, "autoPay">) {
  return AUTO_PAY[card.autoPay];
}
