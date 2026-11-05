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

/**
 * A figure written on a chart: compact thousands and millions as on the axis, but whole units below a thousand (one decimal below
 * ten), so a label never reads like a bank balance (89.88) next to its neighbours (15k, 1.4k). Not for axes, whose ticks can sit a
 * few cents apart and keep their decimals.
 */
export function labelMoney(minor: number): string {
  const major = Math.abs(minor) / 100;
  if (major >= 1_000) return compactMoney(minor);
  const shown = major < 10 ? Number(major.toFixed(1)) : Math.round(major);
  return `${minor < 0 && shown !== 0 ? "-" : ""}${shown}`;
}

/** `compactMoney` with a fixed number of decimals on the thousands and millions. */
function compactFixed(minor: number, digits: number): string {
  const major = Math.abs(minor) / 100;
  const sign = minor < 0 ? "-" : "";
  if (major >= 1_000_000) return `${sign}${(major / 1_000_000).toFixed(digits)}m`;
  if (major >= 1_000) return `${sign}${(major / 1_000).toFixed(digits)}k`;
  return `${sign}${Number(major.toFixed(2))}`;
}

/**
 * Value-axis labels for a set of ticks, compact and never two the same. A narrow range far from zero (84.5k to 86k) rounds
 * several ticks to one label with `compactMoney`; it then takes one decimal, or two, until they are all different.
 */
export function compactAxis(marks: readonly number[]): string[] {
  const plain = marks.map(compactMoney);
  if (new Set(plain).size === plain.length) return plain;
  for (const digits of [1, 2]) {
    const labels = marks.map((v) => compactFixed(v, digits));
    if (new Set(labels).size === labels.length) return labels;
  }
  return marks.map((v) => compactFixed(v, 2));
}

export const percent = (value: number): string => `${value.toFixed(1)}%`;
export { formatDay } from "@/lib/financial-insights/period";
