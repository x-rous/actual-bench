/**
 * Single source of truth for amount formatting in the Budget Management feature.
 *
 * Pre-BM-09, six near-identical helpers (`fmt`, `fmtSummary`, `fmtAmount`,
 * `formatAmount`, `formatDelta`, `minorToDecimal`/`decimalToMinor`) were
 * scattered across `BudgetGrid`, `BudgetCell`, `BudgetDraftPanel`,
 * `BudgetSelectionSummary`, `BulkActionDialog`, `BudgetExportDialog`,
 * `BudgetImportDialog`, and `lib/budgetCsv`. They differed only in:
 *
 *   - fraction digits (0 for summary rows, 2 elsewhere)
 *   - sign convention (`-`, `−` typographic minus, or signed `+/−`)
 *   - currency prefix (some preserve the `$`, some don't)
 *
 * This module exposes those four axes as named functions; callers pick the
 * one matching their visual context. Pure — no React deps.
 */

/**
 * Format a minor-units amount with two fraction digits and locale grouping.
 * No sign prefix, no currency prefix. Matches the `fmt` / `formatAmount` (no $)
 * variants used in cells, group aggregates, and the draft panel's header.
 *
 *   formatMinor(15000) // → "150.00"
 *   formatMinor(-1234) // → "-12.34"
 */
export function formatMinor(minor: number): string {
  return (minor / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a minor-units amount as currency with a `$` prefix, two fraction
 * digits. Matches `formatAmount` in `BulkActionDialog`, `BudgetExportDialog`,
 * and `BudgetImportDialog`.
 *
 *   formatCurrency(15000) // → "$150.00"
 */
export function formatCurrency(minor: number): string {
  return `$${formatMinor(minor)}`;
}

/**
 * Format a minor-units amount with a typographic minus sign for negatives
 * (the en-dash-style `−` U+2212), no currency prefix. Used in the draft
 * panel's metric rows where the negative sign needs visual weight.
 *
 *   formatSigned(15000)  // → "150.00"
 *   formatSigned(-1234) // → "−12.34"
 */
export function formatSigned(minor: number): string {
  const sign = minor < 0 ? "−" : "";
  return `${sign}${formatMinor(Math.abs(minor))}`;
}

/**
 * Format a delta value with an explicit `+` or `−` sign (and the typographic
 * minus). Used in the selection summary and the staged-changes diff list.
 *
 *   formatDelta(0)     // → "0.00"
 *   formatDelta(15000) // → "+150.00"
 *   formatDelta(-1234) // → "−12.34"
 */
export function formatDelta(minor: number): string {
  const sign = minor > 0 ? "+" : minor < 0 ? "−" : "";
  return `${sign}${formatMinor(Math.abs(minor))}`;
}

/**
 * Whole-dollar format — rounds to the nearest dollar and groups by locale.
 * Used in summary rows where two-decimal precision is visual noise. Matches
 * `fmtSummary` in `BudgetGrid`.
 *
 *   formatSummary(15049) // → "150"
 *   formatSummary(15050) // → "151"
 */
export function formatSummary(minor: number): string {
  return Math.round(minor / 100).toLocaleString("en-US");
}

// ─── CSV-specific (decimal string ↔ minor units) ──────────────────────────────

/**
 * Convert minor units to a fixed-2 decimal string for CSV cells.
 * Distinct from `formatMinor` because CSV must NOT have locale grouping.
 *
 *   minorToDecimalString(15000) // → "150.00"
 */
export function minorToDecimalString(minor: number): string {
  return (minor / 100).toFixed(2);
}

/**
 * Parse a decimal string from a CSV cell into minor units. Returns NaN on
 * malformed input (caller is expected to filter NaN out).
 *
 *   decimalStringToMinor("150.00")  // → 15000
 *   decimalStringToMinor("1,234.5") // → 123450  (commas stripped)
 *   decimalStringToMinor("garbage") // → NaN
 */
export function decimalStringToMinor(decimal: string): number {
  const normalized = decimal.replace(/,/g, "").trim();
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
  const parsed = Number(normalized);
  if (isNaN(parsed)) return NaN;
  return Math.round(parsed * 100);
}
