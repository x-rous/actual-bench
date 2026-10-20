/**
 * Percent input (CA-17): 0–100 with up to two decimals, in basis points. Unlike the money
 * parser, thousands separators are rejected, so "1,000" is never read as 1,000%.
 */
export function parsePercentBps(text: string): number | null {
  const value = text.trim().replace(/%$/, "").trim();
  if (!value) return null;
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(value)) throw new Error("Enter a percentage from 0 to 100, with up to two decimals");
  const [whole, fraction = ""] = value.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 10_000) throw new Error("Enter a percentage from 0 to 100");
  return bps;
}

/** Basis points as an editable percent string ("24.99"). */
export function formatPercentBps(bps: number | null) {
  if (bps === null) return "";
  const whole = Math.floor(bps / 100);
  const fraction = bps % 100;
  return fraction ? `${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}` : String(whole);
}
