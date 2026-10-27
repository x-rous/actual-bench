import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { attributeBook, sumMinor, type BookSnapshot } from "./ledger";
import type { ExternalSnapshot } from "./cashflows";
import type { Asset, Registry } from "./models";

/**
 * Real money that moved because of a capital event, read only from Actual rows (never from noncash book adjustments):
 * `investment` is a cash-to-asset transfer classified as an acquisition (out, negative), `disposal` is the net proceeds of a sale (in, positive). Selling costs are deducted from
 * the disposal exactly once, by the same rule Performance uses, and never appear as their own movement.
 */
export type CapitalMovement = { date: string; kind: "investment" | "disposal"; amountMinor: number; rowIds: string[] };

export function capitalMovements(asset: Asset, registry: Registry, snapshot: BookSnapshot, external: ExternalSnapshot): CapitalMovement[] {
  const all = normalizeActivity(snapshot.source);
  const book = attributeBook({ ...snapshot, rows: all.rows }, registry.assets, registry.metadata);
  const own = book.rows.filter((r) => r.assetId === asset.id);
  const links = (registry.cashflows ?? []).filter((m) => m.assetId === asset.id);
  const metadata = registry.metadata.filter((m) => m.actualAccountId === asset.actualAccountId);
  const actual = (id: string, accountId: string) => [...all.rows, ...external.rows].find((r) => r.id === id && r.accountId === accountId);
  const movements: CapitalMovement[] = [];
  for (const row of own) if ((row.classification === "acquisition" || row.classification === "added-capital") && row.transferId && row.amountMinor > 0) movements.push({ date: row.date, kind: "investment", amountMinor: -row.amountMinor, rowIds: [row.id] });
  for (const anchor of [...metadata.filter((m) => m.assetId === asset.id), ...links].filter((m) => m.context?.data.kind === "disposal")) {
    const context = anchor.context!.data;
    if (context.kind !== "disposal") continue;
    const row = actual(anchor.actualTransactionId, anchor.actualAccountId);
    if (!row) continue;
    const gross = context.representation === "external-receipt" ? row.amountMinor : context.representation === "asset-transfer" ? -row.amountMinor : 0;
    if (gross < 0) continue;
    const fees = links.filter((m) => m.context?.data.kind === "selling-cost" && m.context.data.disposalTransactionId === row.id)
      .flatMap((fee) => { const source = actual(fee.actualTransactionId, fee.actualAccountId); return source && source.amountMinor < 0 ? [-source.amountMinor] : []; });
    const net = context.representation === "write-off" || context.proceedsBasis === "gross" ? sumMinor([gross, -sumMinor(fees)]) : gross;
    if (net !== 0) movements.push({ date: row.date, kind: "disposal", amountMinor: net, rowIds: [row.id] });
  }
  return movements.sort((a, b) => a.date.localeCompare(b.date));
}
