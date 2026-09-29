import { dec, mul, toPlainString } from "@/lib/financial-models/money/kernel";

/**
 * Exact conversions between what a person types and what the configuration
 * stores (RD-084 P1.3). No floating point: amounts become integer minor units
 * and rates become exact decimal strings by string and BigInt arithmetic.
 */

export type Parsed<T> = { ok: true; value: T } | { ok: false; message: string };

/** "400,000.50" → 40000050 (two-decimal currency). Empty text is null. */
export function parseMajorToMinor(text: string, minorDigits: number): Parsed<number | null> {
  const clean = text.replace(/[,\s_]/g, "");
  if (clean === "") return { ok: true, value: null };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return { ok: false, message: "Enter an amount such as 1250.00" };
  const [, whole, frac = ""] = match;
  if (frac.length > minorDigits) return { ok: false, message: minorDigits === 0 ? "This currency has no minor units" : `Use at most ${minorDigits} decimal places` };
  const minor = BigInt(whole) * BigInt(10) ** BigInt(minorDigits) + BigInt((frac + "0".repeat(minorDigits)).slice(0, minorDigits) || "0");
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) return { ok: false, message: "The amount is too large" };
  return { ok: true, value: Number(minor) };
}

/** 40000050 → "400000.50": plain, for an input's value (no grouping). */
export function minorToMajorText(minor: number | null, minorDigits: number): string {
  if (minor === null) return "";
  const negative = minor < 0;
  const digits = Math.abs(minor).toString().padStart(minorDigits + 1, "0");
  const whole = digits.slice(0, digits.length - minorDigits);
  const frac = minorDigits > 0 ? `.${digits.slice(digits.length - minorDigits)}` : "";
  return `${negative ? "-" : ""}${whole}${frac}`;
}

/** 40000050 → "400,000.50 AUD", for display. */
export function formatMinor(minor: number, minorDigits: number, currency: string): string {
  const [whole, frac] = minorToMajorText(Math.abs(minor), minorDigits).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${minor < 0 ? "-" : ""}${grouped}${frac !== undefined ? `.${frac}` : ""} ${currency}`;
}

/** "6.12" (percent) → "0.0612" (the stored fraction), exactly. Empty text is null. */
export function percentToFraction(text: string): Parsed<string | null> {
  const clean = text.trim().replace(/%$/, "").trim();
  if (clean === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(clean)) return { ok: false, message: "Enter a rate such as 6.12 (negative rates are not supported)" };
  return { ok: true, value: toPlainString(mul(dec(clean), dec("0.01"))) };
}

/** "0.0612" → "6.12". */
export function fractionToPercent(fraction: string | null): string {
  return fraction === null ? "" : toPlainString(mul(dec(fraction), dec("100")));
}

/** A multiplier such as "1.075" (a 7.5% payment-increase cap), kept exact. */
export function parseFactor(text: string): Parsed<string | null> {
  const clean = text.trim();
  if (clean === "") return { ok: true, value: null };
  if (!/^\d+(\.\d+)?$/.test(clean)) return { ok: false, message: "Enter a multiplier such as 1.075" };
  const value = toPlainString(dec(clean));
  if (value === "0") return { ok: false, message: "The multiplier must be greater than zero" };
  return { ok: true, value };
}
