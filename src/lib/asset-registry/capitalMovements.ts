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
  // Indexed once per call: links and anchors look rows up by id, and a scan per lookup grows with links × rows.
  // A transaction moved between the book and external reads can appear under two accounts. The book read reconciles to
  // Actual's balance for the asset's own account, so its rows stay counted (closing value, capital added, anchors saved for
  // that account); a link saved for another account whose transaction the book also holds is not counted until a read agrees.
  const index = new Map<string, (typeof all.rows)[number]>(); const moved = new Set<string>();
  for (const r of [...all.rows, ...external.rows]) { const seen = index.get(r.id); if (!seen) index.set(r.id, r); else if (seen.accountId !== r.accountId) moved.add(r.id); }
  const actual = (id: string, accountId: string) => { const row = index.get(id); return row && row.accountId === accountId && (accountId === snapshot.accountId || !moved.has(id)) ? row : undefined; };
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
