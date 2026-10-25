import { assetMoney } from "./AssetPresentation";

export type SaleModel = {
  representation: "external-receipt" | "asset-transfer" | "write-off";
  /** The existing deposit or transfer, in words (payee · date · amount). */ sourceLabel: string | null;
  /** The new noncash adjustment in the asset's account (signed minor units); 0 when none is needed. */ adjustmentMinor: number;
  date: string; feeLabels: string[]; basis: "gross" | "net";
  netProceedsMinor: number; gainMinor: number;
};
/**
 * How the sale will be modelled in Actual and Bench, one plain sentence per thing that happens (or deliberately does not).
 * Every line is about a real transaction, so the owner can tell exactly what will change before confirming.
 */
export function saleModel(m: SaleModel): { actual: string[]; bench: string[] } {
  const actual: string[] = [];
  if (m.representation === "external-receipt") actual.push(`Your deposit ${m.sourceLabel ?? "for the sale"} stays exactly as it is. It is not changed, moved or linked in Actual.`);
  else if (m.representation === "asset-transfer") actual.push(`The transfer out of the asset's account ${m.sourceLabel ?? ""} and the matching deposit in your account stay exactly as they are.`.replace("  ", " "));
  else actual.push("No money moves, and nothing in your budget changes.");
  actual.push(m.adjustmentMinor !== 0
    ? `One new entry of ${assetMoney(m.adjustmentMinor)} is added to the asset's own account on ${m.date}. It is a noncash entry, typed Disposal and tagged #disposal. It is not a transaction in your bank or your budget.`
    : "No new entry is needed: the transfer already takes exactly the value that left the asset out of its account.");
  if (m.feeLabels.length > 0) actual.push(`${m.feeLabels.length === 1 ? "The expense" : `The ${m.feeLabels.length} expenses`} ${m.feeLabels.join("; ")} stay${m.feeLabels.length === 1 ? "s" : ""} in your budget unchanged. Bench only counts ${m.feeLabels.length === 1 ? "it" : "them"} against the sale.`);
  const bench = [
    m.feeLabels.length > 0 ? (m.basis === "gross" ? "The payment is treated as before costs, so the costs are subtracted from it." : "The payment is treated as already after costs, so the costs are not subtracted again.") : null,
    `Reports will show ${assetMoney(m.netProceedsMinor)} received after costs and a ${m.gainMinor < 0 ? "loss" : "gain"} of ${assetMoney(Math.abs(m.gainMinor))} on the sale. None of it counts as income or as an expense.`,
  ].filter((line): line is string => !!line);
  return { actual, bench };
}
