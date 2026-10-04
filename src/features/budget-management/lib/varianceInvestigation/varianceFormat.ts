import { formatMinor } from "../format";

/**
 * Number formatting for the Variance Drivers dialog.
 *
 * Follows the grid's decimals setting: whole numbers by default, cents when
 * the setting is on. Magnitudes carry no sign; direction is a separate word,
 * arrow or `+`/`−` so it never rests on colour alone.
 */
export type VarianceFormat = {
  /** Unsigned amount: "74,619" or "74,619.00". */
  money: (minor: number) => string;
  /** With an explicit sign, none when it rounds to zero: "+4,436", "−543". */
  signed: (minor: number) => string;
  /** Short chart label: "12.6k" at ten thousand and over, else as `money`. */
  compact: (minor: number) => string;
  /** Short chart label with a sign. */
  compactSigned: (minor: number) => string;
  /** Always two decimals, for rows that are a single transaction. */
  exact: (minor: number) => string;
};

export function createVarianceFormat(showDecimals: boolean): VarianceFormat {
  const whole = (minor: number) =>
    Math.round(Math.abs(minor) / 100).toLocaleString("en-US");
  const money = (minor: number) => (showDecimals ? formatMinor(Math.abs(minor)) : whole(minor));
  const isZero = (minor: number) =>
    showDecimals ? Math.round(Math.abs(minor)) === 0 : Math.round(Math.abs(minor) / 100) === 0;
  const signOf = (minor: number) => (isZero(minor) ? "" : minor > 0 ? "+" : "−");
  const compact = (minor: number) => {
    const units = Math.abs(minor) / 100;
    if (units < 10_000) return money(minor);
    const k = units / 1000;
    return `${(units >= 100_000 ? Math.round(k) : Math.round(k * 10) / 10).toLocaleString("en-US")}k`;
  };
  return {
    money,
    signed: (minor) => `${signOf(minor)}${money(minor)}`,
    compact,
    compactSigned: (minor) => `${signOf(minor)}${compact(minor)}`,
    exact: (minor) => formatMinor(Math.abs(minor)),
  };
}
