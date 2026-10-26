import { CAPITAL_TYPES } from "./models";
/**
 * How an asset's recorded value moved over a period, summed from the classified book rows (never inferred from the change
 * in value): Opening + Capital added + Revaluation + Depreciation & write-downs + Disposals & other = Closing.
 * Capital added uses the same types as Performance, so the two agree whenever Performance is complete.
 */
export type ValueBridge = { openingMinor: number; capitalMinor: number; revaluationMinor: number; depreciationMinor: number; disposalMinor: number; otherMinor: number; closingMinor: number };
const CAPITAL = new Set(CAPITAL_TYPES);
const DEPRECIATION = new Set(["depreciation", "impairment"]);

export function valueBridge(rows: { date: string; classification: string | null; amountMinor: number }[], from: string | null, to: string): ValueBridge {
  const bridge: ValueBridge = { openingMinor: 0, capitalMinor: 0, revaluationMinor: 0, depreciationMinor: 0, disposalMinor: 0, otherMinor: 0, closingMinor: 0 };
  for (const row of rows) {
    if (row.date > to) continue;
    if (from !== null && row.date < from) { bridge.openingMinor += row.amountMinor; continue; }
    const type = row.classification ?? "";
    if (CAPITAL.has(type)) bridge.capitalMinor += row.amountMinor;
    else if (type === "revaluation") bridge.revaluationMinor += row.amountMinor;
    else if (DEPRECIATION.has(type)) bridge.depreciationMinor += row.amountMinor;
    else if (type === "disposal") bridge.disposalMinor += row.amountMinor;
    else bridge.otherMinor += row.amountMinor; // other adjustments and unclassified rows stay visible, so the bridge always adds up
  }
  bridge.closingMinor = bridge.openingMinor + bridge.capitalMinor + bridge.revaluationMinor + bridge.depreciationMinor + bridge.disposalMinor + bridge.otherMinor;
  return bridge;
}
