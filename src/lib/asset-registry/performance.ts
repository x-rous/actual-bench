import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { divRoundInt } from "@/lib/financial-models/money";
import { isIsoDate } from "@/lib/financial-models/calendar/dates";
import { attributeBook, sumMinor, type BookSnapshot } from "./ledger";
import { BOOK_TYPES, CASHFLOW_TYPES, type Asset, type Registry } from "./models";
import type { ExternalSnapshot } from "./cashflows";
import { capitalizationIssues } from "./capitalization";

export type AssetPerformance = {
  /** All amounts are signed integer minor units. Ratios are percentage points, rounded for display only. */
  openingMinor: number | null; closingMinor: number | null; capitalAddedMinor: number | null;
  operatingMinor: number | null; netProceedsMinor: number | null; totalMinor: number | null;
  operatingYield: number | null; simpleReturn: number | null; gaps: string[];
};
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
  if (book.rows.some((r) => !r.assetId && inPeriod(r.date))) gap("Unassigned account transactions require review");
  const metadata = registry.metadata.filter((m) => m.actualAccountId === asset.actualAccountId);
  const actual = (id: string, accountId: string) => [...all.rows, ...external.rows].find((r) => r.id === id && r.accountId === accountId);
  let operatingKnown = true;
  const operating: number[] = [], capital: number[] = [], proceeds: number[] = [];
  const companions = new Set([...metadata, ...links].flatMap((m) => m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId ? [m.context.data.bookAdjustmentTransactionId] : []));
  for (const row of own.filter((r) => inPeriod(r.date))) {
    const m = metadata.find((m) => m.actualTransactionId === row.id);
    if (!Object.hasOwn(BOOK_TYPES, row.classification ?? "")) gap("Unclassified account transactions");
    if (["opening-balance", "acquisition", "capital-expenditure", "ownership-adjustment"].includes(row.classification ?? "")) capital.push(row.amountMinor);
    if (row.classification === "disposal" && !m?.context && !companions.has(row.id)) gap("Disposal treatment is missing");
  }
  // One plain finding for any capitalization whose expense and asset adjustment do not match. Only an expense dated within
  // the period (or earlier) matters here: a later one cannot make an earlier period incomplete.
  if (capitalizationIssues(asset, registry, snapshot, external).some((issue) => issue.date <= to)) gap("Capitalization needs review");
  for (const link of links) {
    const row = actual(link.actualTransactionId, link.actualAccountId);
    const type = link.classification ?? "";
    if (!row) {
      gap("Linked source is missing or moved");
      if (!link.context && !["capital-expenditure", "disposal-proceeds", "other-excluded"].includes(type)) operatingKnown = false;
      continue;
    }
    if (link.context?.data.kind === "selling-cost") {
      const disposalId = link.context.data.disposalTransactionId;
      const target = [...metadata, ...links].find((m) => m.actualTransactionId === disposalId);
      if (type !== "other-excluded" || row.amountMinor >= 0 || row.transferId || target?.context?.data.kind !== "disposal" || target.assetId !== asset.id || !actual(target.actualTransactionId, target.actualAccountId)) gap("Selling cost disposal anchor is missing or changed");
      continue;
    }
    if (!inPeriod(row.date)) continue;
    if (!Object.hasOwn(CASHFLOW_TYPES, type)) { gap("Unclassified linked cashflow"); operatingKnown = false; continue; }
    if (row.transferId || registry.assets.some((a) => a.actualAccountId === row.accountId)) { gap("Cashflow duplicates a transfer or asset account"); operatingKnown = false; continue; }
    if (["rental-income", "dividends-distributions", "interest-yield", "other-income"].includes(type)) {
      if (row.amountMinor <= 0) { gap("Operating income sign changed"); operatingKnown = false; } else operating.push(row.amountMinor);
    } else if (["operating-expense", "taxes-insurance-service-charges", "financing-interest"].includes(type)) {
      if (row.amountMinor >= 0) { gap("Operating expense sign changed"); operatingKnown = false; } else operating.push(row.amountMinor);
    }
    if (type === "disposal-proceeds" && link.context?.data.kind !== "disposal") gap("Disposal proceeds need carrying-value context");
  }
  for (const anchor of [...metadata.filter((m) => m.assetId === asset.id), ...links].filter((m) => m.context?.data.kind === "disposal")) {
    const context = anchor.context!.data;
    if (context.kind !== "disposal") continue;
    const row = actual(anchor.actualTransactionId, anchor.actualAccountId);
    if (!row) { gap("Disposal anchor is missing/moved"); continue; }
    if (!inPeriod(row.date)) continue;
    const p = context.representation === "external-receipt" ? row.amountMinor : context.representation === "asset-transfer" ? -row.amountMinor : 0;
    const delta = context.representation === "asset-transfer" ? p - context.carryingRemovedMinor : -context.carryingRemovedMinor;
    if (p < 0 || (context.representation === "asset-transfer" ? !row.transferId : !!row.transferId) || anchor.classification !== (context.representation === "external-receipt" ? "disposal-proceeds" : "disposal")) gap("Disposal representation changed");
    if (context.representation === "write-off") {
      if (row.amountMinor !== delta) gap("Write-off carrying amount changed");
    } else if (context.bookAdjustmentTransactionId) {
      const pair = own.find((r) => r.id === context.bookAdjustmentTransactionId);
      if (!pair || pair.amountMinor !== delta || pair.date !== row.date || pair.classification !== "disposal" || [...metadata, ...links].filter((m) => m.context?.data.kind === "disposal" && m.context.data.bookAdjustmentTransactionId === pair.id).length !== 1) gap("Disposal companion is missing/changed");
    } else if (delta !== 0) gap("Disposal companion is missing");
    const costs = links.filter((m) => m.context?.data.kind === "selling-cost" && m.context.data.disposalTransactionId === row.id);
    const fees: number[] = [];
    for (const fee of costs) {
      const source = actual(fee.actualTransactionId, fee.actualAccountId);
      if (!source || source.amountMinor >= 0 || source.transferId || fee.classification !== "other-excluded") gap("Selling cost is missing/changed");
      else fees.push(-source.amountMinor);
    }
    if (context.representation !== "write-off" && !context.proceedsBasis) gap("Disposal proceeds basis is unknown");
    proceeds.push(context.representation === "write-off" || context.proceedsBasis === "gross" ? sumMinor([p, -sumMinor(fees)]) : p);
  }
  const op = operatingKnown ? sumMinor(operating) : null;
  const added = sumMinor(capital), withdrawn = sumMinor(proceeds);
  const complete = gaps.size === 0 && opening !== null && closing !== null && op !== null;
  const total = complete ? sumMinor([closing!, -opening!, -added, withdrawn, op!]) : null;
  const base = opening === null ? 0 : sumMinor([opening, added]);
  const ratio = (value: number | null) => value === null || !complete || base <= 0 ? null : Number(divRoundInt(BigInt(value) * BigInt(10000), BigInt(base), "half-even")) / 100;
  return { openingMinor: opening, closingMinor: closing, capitalAddedMinor: complete ? added : null, operatingMinor: op, netProceedsMinor: complete ? withdrawn : null, totalMinor: total, operatingYield: ratio(op), simpleReturn: ratio(total), gaps: [...gaps] };
}
