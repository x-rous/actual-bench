import { minorToDecimalString } from "../format";
import type { VarianceModel } from "./varianceViewModel";

/**
 * The drivers on screen as CSV rows. Amounts are plain two-decimal numbers
 * because a spreadsheet is where someone goes to do arithmetic; direction is a
 * word in its own column so the sign never has to be read.
 */
export function buildVarianceCsvRows(model: VarianceModel): string[][] {
  const v = model.vocab;
  const header = [
    model.level === "group" ? "Group" : "Category",
    "Group",
    v.budget,
    v.actual,
    "Variance",
    "Direction",
    "% of budget",
    "Share of gross side",
    ...(model.mode === "envelope" ? ["Closing balance", "Deficit"] : []),
  ];
  const rows = model.drivers.map((d) => {
    const direction =
      d.variance > 0 ? v.unfavourable : d.variance < 0 ? v.favourable : "On plan";
    return [
      d.name,
      d.groupName,
      minorToDecimalString(d.budget),
      minorToDecimalString(d.actual),
      minorToDecimalString(Math.abs(d.variance)),
      direction,
      d.pctOfBudget == null ? "" : (d.pctOfBudget * 100).toFixed(1),
      d.share == null ? "" : (d.share * 100).toFixed(1),
      ...(model.mode === "envelope"
        ? [
            minorToDecimalString(d.aggregate.envelope?.closing ?? 0),
            minorToDecimalString(d.aggregate.envelope?.deficit ?? 0),
          ]
        : []),
    ];
  });
  return [header, ...rows];
}
