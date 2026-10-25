import { normalizeActivity } from "@/features/credit-cards/lib/activity";
import { attributeBook, type BookSnapshot } from "./ledger";
import type { ExternalSnapshot } from "./cashflows";
import type { Asset, Registry } from "./models";

/**
 * A linked expense classified as CapEx is expected to have exactly one asset-account row of the same amount that adds it to
 * the asset's value (its companion), recorded by the Capitalize action or matched by the owner. This lists every expense
 * where that relationship is missing or no longer holds, in plain terms, with candidate companions to match.
 */
export type CapitalizationIssue = {
  sourceId: string; sourceAccountId: string; date: string; label: string;
  /** What the asset-account adjustment should be: the expense's amount with its sign reversed. */ expectedMinor: number;
  reason: "no-companion" | "companion-missing" | "mismatch" | "source-missing";
  /** Plain-language explanation of what is wrong. */ detail: string;
  companion: { id: string; date: string; amountMinor: number } | null;
  candidates: { id: string; date: string; amountMinor: number; label: string }[];
};

export function capitalizationIssues(asset: Asset, registry: Registry, snapshot: BookSnapshot, external: ExternalSnapshot): CapitalizationIssue[] {
  const all = normalizeActivity(snapshot.source);
  const fullBook = attributeBook({ ...snapshot, rows: all.rows }, registry.assets, registry.metadata);
  const own = fullBook.rows.filter((r) => r.assetId === asset.id);
  const links = (registry.cashflows ?? []).filter((m) => m.assetId === asset.id && m.classification === "capital-expenditure");
  const metadata = registry.metadata.filter((m) => m.actualAccountId === asset.actualAccountId);
  const actual = (id: string, accountId: string) => [...all.rows, ...external.rows].find((r) => r.id === id && r.accountId === accountId);
  const pairs = metadata.filter((m) => m.capitalizedFromTransactionId);
  const usedCompanions = new Set(pairs.map((m) => m.actualTransactionId));
  const issues: CapitalizationIssue[] = [];
  for (const link of links) {
    const source = actual(link.actualTransactionId, link.actualAccountId);
    if (!source) continue; // a missing or moved source is reported on its own
    const expectedMinor = -source.amountMinor;
    const base = { sourceId: source.id, sourceAccountId: source.accountId, date: source.date, label: source.label, expectedMinor };
    const sourceValid = source.amountMinor < 0 && !source.transferId && !!source.categoryId;
    const pair = pairs.find((m) => m.capitalizedFromTransactionId === link.actualTransactionId);
    if (!pair) {
      const candidates = own.filter((r) => r.classification === "capital-expenditure" && r.amountMinor === expectedMinor && !r.transferId && !usedCompanions.has(r.id))
        .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(source.date)) - Math.abs(Date.parse(b.date) - Date.parse(source.date)))
        .map((r) => ({ id: r.id, date: r.date, amountMinor: r.amountMinor, label: r.label }));
      issues.push({ ...base, reason: "no-companion", companion: null, candidates,
        detail: candidates.length ? "The expense is marked as capital expenditure, but no asset adjustment is recorded as its companion. A matching adjustment exists." : "The expense is marked as capital expenditure, but the asset has no adjustment for it, so the asset's value is understated." });
      continue;
    }
    const companion = own.find((r) => r.id === pair.actualTransactionId);
    if (!companion) { issues.push({ ...base, reason: "companion-missing", companion: null, candidates: [], detail: "The asset adjustment recorded for this expense is no longer in the asset account." }); continue; }
    const shown = { id: companion.id, date: companion.date, amountMinor: companion.amountMinor };
    if (!sourceValid) issues.push({ ...base, reason: "mismatch", companion: shown, candidates: [], detail: "The expense no longer qualifies as capital expenditure (it must be money out, not a transfer, and have a category)." });
    else if (companion.amountMinor !== expectedMinor || pair.classification !== "capital-expenditure") issues.push({ ...base, reason: "mismatch", companion: shown, candidates: [], detail: "The asset adjustment no longer equals the expense." });
  }
  for (const pair of pairs.filter((m) => !links.some((l) => l.actualTransactionId === m.capitalizedFromTransactionId))) {
    const companion = own.find((r) => r.id === pair.actualTransactionId);
    if (!companion) continue;
    issues.push({ sourceId: pair.capitalizedFromTransactionId!, sourceAccountId: "", date: companion.date, label: companion.label, expectedMinor: companion.amountMinor, reason: "source-missing", companion: { id: companion.id, date: companion.date, amountMinor: companion.amountMinor }, candidates: [],
      detail: "The expense behind this asset adjustment is no longer linked to the asset." });
  }
  return issues.sort((a, b) => a.date.localeCompare(b.date));
}
