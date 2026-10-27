import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { xirr, type DatedFlow } from "./irr";
import { divRoundInt } from "@/lib/financial-models/money";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { attributeBook, sumMinor, type BookSnapshot } from "./ledger";
import { BOOK_TYPES, CAPITAL_TYPES, CASHFLOW_TYPES, type Asset, type Registry } from "./models";
import type { ExternalSnapshot } from "./cashflows";

export type AssetPerformance = {
  /** All amounts are signed integer minor units. Ratios are percentage points, rounded for display only. */
  openingMinor: number | null; closingMinor: number | null; capitalAddedMinor: number | null;
  operatingMinor: number | null; netProceedsMinor: number | null; totalMinor: number | null;
  operatingYield: number | null; simpleReturn: number | null;
  /** Money-weighted annual return (IRR), in percent; null while incomplete or when the period is too short to annualize. */ irr: number | null; gaps: string[];
};
/**
 * Actual is the truth: a saved link or treatment whose transaction is gone, moved or changed is simply not counted (and is
 * pruned on the next complete read). Gaps are only inputs Bench genuinely lacks: an unreadable account, a ledger that does not
 * add up, rows nobody has assigned or typed, and a hand-typed disposal with no treatment.
 */
export function performance(asset: Asset, registry: Registry, snapshot: BookSnapshot, external: ExternalSnapshot, from: string, to: string): AssetPerformance {
  if (!isIsoDate(from) || !isIsoDate(to) || from > to) throw new Error("Choose a valid reporting period");
  const all = normalizeActivity(snapshot.source);
  const book = attributeBook({ ...snapshot, rows: all.rows.filter((r) => r.date <= to) }, registry.assets, registry.metadata);
  const links = (registry.cashflows ?? []).filter((m) => m.assetId === asset.id);
  // An unreadable source account only affects assets that link to it; unscoped snapshots stay all-or-nothing.
  const externalIssues = external.accountIssues ? [...new Set(links.map((m) => m.actualAccountId))].flatMap((id) => external.accountIssues![id] ?? []) : external.issues;
  const gaps = new Set([...book.issues, ...all.issues, ...externalIssues]);
  const gap = (message: string) => { gaps.add(message); };
  const own = book.rows.filter((r) => r.assetId === asset.id);
  const inPeriod = (date: string) => date >= from && date <= to;
  const opening = book.available ? sumMinor(own.filter((r) => r.date < from).map((r) => r.amountMinor)) : null;
  const closing = book.available ? sumMinor(own.map((r) => r.amountMinor)) : null;
  if (!book.available) gap("Dated asset values are unavailable");
  if (book.rows.some((r) => !r.assetId && inPeriod(r.date))) gap("Unassigned entries require review");
  const metadata = registry.metadata.filter((m) => m.actualAccountId === asset.actualAccountId);
  const actual = (id: string, accountId: string) => [...all.rows, ...external.rows].find((r) => r.id === id && r.accountId === accountId);
  const operating: number[] = [], capital: number[] = [], proceeds: number[] = [];
  /** Every dated movement of money, for the annual (money-weighted) return. */
  const flows: DatedFlow[] = [];
  const companions = new Set([...metadata, ...links].flatMap((m) => m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId ? [m.context.data.bookAdjustmentTransactionId] : []));
  for (const row of own.filter((r) => inPeriod(r.date))) {
    const m = metadata.find((m) => m.actualTransactionId === row.id);
    if (!Object.hasOwn(BOOK_TYPES, row.classification ?? "")) gap("Unclassified entries");
    if (CAPITAL_TYPES.includes(row.classification ?? "")) { capital.push(row.amountMinor); flows.push({ date: row.date, amountMinor: -row.amountMinor }); }
    if (row.classification === "disposal" && !m?.context && !companions.has(row.id)) gap("Disposal treatment is missing");
  }
  for (const link of links) {
    const row = actual(link.actualTransactionId, link.actualAccountId);
    // A link to a transaction that is gone, a treatment's own rows and transfers or asset-account rows never count as operating.
    if (!row || !inPeriod(row.date) || (link.classification && Object.hasOwn(CASHFLOW_TYPES, link.classification)) || link.context || row.transferId || registry.assets.some((a) => a.actualAccountId === row.accountId)) continue;
    if (row.amountMinor !== 0) { operating.push(row.amountMinor); flows.push({ date: row.date, amountMinor: row.amountMinor }); }
  }
  for (const anchor of [...metadata.filter((m) => m.assetId === asset.id), ...links].filter((m) => m.context?.data.kind === "disposal")) {
    const context = anchor.context!.data;
    if (context.kind !== "disposal") continue;
    const row = actual(anchor.actualTransactionId, anchor.actualAccountId);
    if (!row || !inPeriod(row.date)) continue;
    const p = context.representation === "external-receipt" ? row.amountMinor : context.representation === "asset-transfer" ? -row.amountMinor : 0;
    if (p < 0) continue;
    const fees = links.filter((m) => m.context?.data.kind === "selling-cost" && m.context.data.disposalTransactionId === row.id)
      .flatMap((fee) => { const source = actual(fee.actualTransactionId, fee.actualAccountId); return source && source.amountMinor < 0 ? [-source.amountMinor] : []; });
    const net = context.representation === "write-off" || context.proceedsBasis === "gross" ? sumMinor([p, -sumMinor(fees)]) : p;
    proceeds.push(net); flows.push({ date: row.date, amountMinor: net });
  }
  const op = sumMinor(operating);
  const added = sumMinor(capital), withdrawn = sumMinor(proceeds);
  const complete = gaps.size === 0 && opening !== null && closing !== null;
  const total = complete ? sumMinor([closing!, -opening!, -added, withdrawn, op]) : null;
  const base = opening === null ? 0 : sumMinor([opening, added]);
  // The value you start the period with counts as money put in on its first day; the closing value as money back on its last.
  const irr = complete ? xirr([...(opening ? [{ date: from, amountMinor: -opening }] : []), ...flows, { date: to, amountMinor: closing! }]) : null;
  const ratio = (value: number | null) => value === null || !complete || base <= 0 ? null : Number(divRoundInt(BigInt(value) * BigInt(10000), BigInt(base), "half-even")) / 100;
  return { openingMinor: opening, closingMinor: closing, capitalAddedMinor: complete ? added : null, operatingMinor: op, netProceedsMinor: complete ? withdrawn : null, totalMinor: total, operatingYield: ratio(op), simpleReturn: ratio(total), irr, gaps: [...gaps] };
}
