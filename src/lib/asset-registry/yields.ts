const DAY = 86_400_000;
/** Years between two `YYYY-MM-DD` dates (actual/365). */
export const yearsBetween = (from: string, to: string): number => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY / 365;

/**
 * What the asset earns each year on average, as a % of what was put in: the all-time Operating Yield (Operating Result ÷ Opening +
 * Capital Added, in percent) spread over the years held. Null when the yield is unknown or under six months of history, where
 * dividing by so short a span says little.
 */
export function averageYearlyYield(operatingYield: number | null | undefined, years: number): number | null {
  if (operatingYield === null || operatingYield === undefined || !(years >= 0.5)) return null;
  return Math.round((operatingYield / years) * 100) / 100;
}
/** What the asset earns against what it is worth now: an operating result over today's recorded value (signed integer minor units), in percent. */
export function netYieldOnValue(operatingMinor: number | null | undefined, valueMinor: number | null | undefined): number | null {
  if (operatingMinor === null || operatingMinor === undefined || valueMinor === null || valueMinor === undefined || valueMinor <= 0) return null;
  return Math.round((operatingMinor / valueMinor) * 10000) / 100;
}
/**
 * What the asset earns against what it is worth, as a yearly rate: an operating result over a period (signed integer minor
 * units) against the value at the end of that period, in percent. A period of at least three months is scaled to a year;
 * a shorter one is reported as it is and marked so, because scaling a few weeks says little. Negative for an asset that costs
 * more than it earns. Null when the result or a positive value is unknown.
 */
export function yearlyNetYield(operatingMinor: number | null | undefined, valueMinor: number | null | undefined, years: number): { percent: number; annualized: boolean } | null {
  const raw = netYieldOnValue(operatingMinor, valueMinor);
  if (raw === null) return null;
  if (!(years >= 0.25)) return { percent: raw, annualized: false };
  return { percent: Math.round((raw / years) * 100) / 100, annualized: true };
}
