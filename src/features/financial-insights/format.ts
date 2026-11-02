import { formatAmount } from "@/features/assets-debt/lib/money";

/** Unknown is never shown as zero. */
export const MISSING = "-";

/** Integer minor units in Bench's one number format: no currency symbol or code. */
export const money = (minor: number | null | undefined): string => (minor == null ? MISSING : formatAmount(minor, 2));

/** A signed change, with an explicit plus. */
export const signedMoney = (minor: number): string => (minor > 0 ? `+${formatAmount(minor, 2)}` : formatAmount(minor, 2));

/** Short axis label: 1.2k, 3.4m. */
export function compactMoney(minor: number): string {
  const major = Math.abs(minor) / 100;
  const sign = minor < 0 ? "-" : "";
  if (major >= 1_000_000) return `${sign}${(major / 1_000_000).toFixed(major >= 10_000_000 ? 0 : 1)}m`;
  if (major >= 1_000) return `${sign}${(major / 1_000).toFixed(major >= 10_000 ? 0 : 1)}k`;
  // Below a thousand the axis can be a few cents wide: keep the decimals it needs (0.2, 0.4) so the ticks stay apart.
  return `${sign}${Number(major.toFixed(2))}`;
}

export const percent = (value: number): string => `${value.toFixed(1)}%`;
export { formatDay } from "@/lib/financial-insights/period";
